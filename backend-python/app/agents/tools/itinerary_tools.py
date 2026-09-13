"""Itinerary tools — build_itinerary and edit_itinerary."""

from langchain_core.tools import tool, InjectedToolCallId
from langchain_core.messages import ToolMessage
from langgraph.prebuilt import InjectedState, ToolRuntime
from langgraph.types import Command
from typing import Annotated

from app.agents.state import resolve_build_cities
from app.services.itinerary_builder import itinerary_builder
from app.services.itinerary_editor import itinerary_editor
from app.services import progress_bus
from app.utils.logger import logger


def _resolve_conversation_id(runtime: ToolRuntime | None) -> str:
    """Pull the conversation id off the injected RunnableConfig.

    chat_stream sets config["metadata"]["conversation_id"] and
    config["configurable"]["thread_id"]; either works. Falls back to
    langgraph's get_config() contextvar when runtime isn't injected.
    """
    cfg = getattr(runtime, "config", None) or {}
    cid = (cfg.get("metadata") or {}).get("conversation_id") \
        or (cfg.get("configurable") or {}).get("thread_id")
    if cid:
        return cid
    try:
        from langgraph.config import get_config
        cfg = get_config() or {}
        cid = (cfg.get("metadata") or {}).get("conversation_id") \
            or (cfg.get("configurable") or {}).get("thread_id")
        if cid:
            return cid
    except Exception:
        pass
    # Last resort: the progress-bus contextvar set by chat_stream's register()
    # — tool coroutines inherit it from the parent task.
    return progress_bus.current()


def _resolve_user_id(runtime: ToolRuntime | None):
    """Pull the user id off the injected RunnableConfig.

    chat_stream sets config["configurable"]["user_id"] and mirrors it in
    config["metadata"]["user_id"]. Falls back to langgraph's get_config()
    contextvar when runtime isn't injected.
    """
    cfg = getattr(runtime, "config", None) or {}
    uid = (cfg.get("configurable") or {}).get("user_id") \
        or (cfg.get("metadata") or {}).get("user_id")
    if uid:
        return uid
    try:
        from langgraph.config import get_config
        cfg = get_config() or {}
        return (cfg.get("configurable") or {}).get("user_id") \
            or (cfg.get("metadata") or {}).get("user_id")
    except Exception:
        return None


async def _get_user_interests(user_id) -> list[str]:
    """Read preferences.interests off the user's profile (set on ProfilePage)."""
    try:
        from sqlalchemy import select
        from app.database import async_session
        from app.models import User

        async with async_session() as db:
            result = await db.execute(
                select(User.preferences).where(User.id == int(user_id))
            )
            prefs = result.scalar_one_or_none() or {}
    except Exception as e:
        logger.warning(f"[BUILD_ITINERARY] user interests lookup failed: {e}")
        return []
    interests = prefs.get("interests")
    return list(interests) if isinstance(interests, list) else []


@tool
async def build_itinerary(
    state: Annotated[dict, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId],
    runtime: ToolRuntime,
) -> Command:
    """Build a complete day-by-day itinerary from the current trip state.
    Call this immediately after the user confirms the route proposal.
    Searches for real places (hotels, restaurants, attractions) and assembles
    a day-by-day plan with time slots. No arguments needed — reads from trip state.
    """
    trip_state = state.get("trip_state") or {}
    build_cities = resolve_build_cities(trip_state)
    if not build_cities:
        return Command(
            update={
                "messages": [ToolMessage(content="Cannot build itinerary: no cities in trip state.", tool_call_id=tool_call_id)],
            }
        )

    total_days = sum(c["days"] for c in build_cities)
    # travelers may be a dict ({"adults": n, ...}) or a plain string like
    # "couple" (used as travelerType below) — guard before .get().
    travelers = trip_state.get("travelers")
    ctx = {
        "destination": build_cities[0]["name"],
        "duration": total_days,
        "cities": build_cities,
        "totalDays": total_days,
        "travelType": trip_state.get("pace", "moderate"),
        "numberOfPeople": travelers.get("adults", 1) if isinstance(travelers, dict) else 1,
        "preferences": trip_state.get("preferences", []),
        "tripStyle": trip_state.get("tripStyle", "balanced"),
        "helpWith": trip_state.get("helpWith", []),
    }

    # Pass startLocation for flight search if available
    start_location = trip_state.get("startLocation")
    if start_location:
        ctx["startLocation"] = start_location

    dates = trip_state.get("dates")
    if dates and dates.get("start"):
        ctx["startDate"] = dates["start"]

    travel_mode = trip_state.get("travelMode")
    if travel_mode:
        ctx["travelMode"] = travel_mode

    # Personalization — mirror _auto_build_itinerary: traveler type plus the
    # user's long-term memories and profile interests feed the builder's
    # generate_personalized_queries branch. Without this, model-invoked
    # builds (the primary path) silently lost all personalization.
    if isinstance(travelers, str) and travelers:
        ctx["travelerType"] = travelers

    user_id = _resolve_user_id(runtime)
    if user_id:
        try:
            from app.services.memory import get_user_memories
            memories = await get_user_memories(user_id)
            if memories:
                ctx["userMemories"] = memories
        except Exception as e:
            logger.warning(f"[BUILD_ITINERARY] get_user_memories failed: {e}")
        interests = await _get_user_interests(user_id)
        if interests:
            ctx["userInterests"] = interests

    # Stream builder progress to the UI via the per-conversation progress bus.
    # (get_stream_writer custom events are dropped for async tools under
    # astream_events(v3), so we push straight onto chat_stream's queue.)
    conversation_id = _resolve_conversation_id(runtime)
    _progress_counter = [0]

    async def _status_cb(update: dict):
        if not conversation_id:
            return
        try:
            for event in progress_bus.builder_update_events(update, _progress_counter):
                progress_bus.emit(conversation_id, event)
        except Exception as e:
            logger.warning(f"[BUILD_ITINERARY] progress emit failed: {e}")

    result = await itinerary_builder.build(ctx, status_cb=_status_cb)
    if not result:
        return Command(
            update={
                "messages": [ToolMessage(content="Failed to build itinerary.", tool_call_id=tool_call_id)],
            }
        )

    itinerary = result["itinerary"]
    logger.info(f"[BUILD_ITINERARY] Built itinerary with {len(itinerary.get('days', []))} days")

    # Write back ONLY the itinerary key — returning the whole snapshot could
    # clobber keys another tool set in the same step (merge is right-wins).
    new_trip_state = {"itinerary": itinerary}

    tool_msg = (
        f"Itinerary built successfully!\n"
        f"Days: {len(itinerary.get('days', []))}\n"
        f"Cities: {', '.join(c['name'] for c in build_cities)}"
    )

    return Command(
        update={
            "trip_state": new_trip_state,
            "messages": [ToolMessage(content=tool_msg, tool_call_id=tool_call_id)],
        }
    )


@tool
async def edit_itinerary(
    action_type: str,
    day: int | None = None,
    time_slot: str | None = None,
    activity_name: str | None = None,
    activity_id: str | None = None,
    place_name: str | None = None,
    new_day: int | None = None,
    new_time_slot: str | None = None,
    state: Annotated[dict, InjectedState] = None,
    tool_call_id: Annotated[str, InjectedToolCallId] = None,
) -> Command:
    """Edit an existing itinerary by adding, removing, replacing, or moving activities.
    Only call this when an itinerary already exists.

    Args:
        action_type: What to do — 'add', 'remove', 'replace', 'move', 'add_day', 'remove_day'
        day: Target day number (1-indexed). Required for most actions.
        time_slot: Target time slot — 'morning', 'afternoon', or 'evening'
        activity_name: Name of the activity (for add/remove/replace)
        activity_id: ID of the activity (for remove/move — use if you have it)
        place_name: Real place name to add/replace (e.g., "Senso-ji Temple"). Search with mcp_search_places first.
        new_day: Destination day number for move operations
        new_time_slot: Destination time slot for move operations
    """
    trip_state = state.get("trip_state") or {}
    itinerary = trip_state.get("itinerary")

    if not itinerary:
        return Command(
            update={
                "messages": [ToolMessage(content="No itinerary found. Build an itinerary first.", tool_call_id=tool_call_id)],
            }
        )

    action = {
        "type": action_type,
        "target": {
            "day": day,
            "timeSlot": time_slot,
            "activityName": activity_name,
            "activityId": activity_id,
        },
        "details": {
            "placeName": place_name or activity_name,
            "newDay": new_day,
            "newTimeSlot": new_time_slot,
        },
    }

    destination = (trip_state.get("cities") or [{}])[0].get("name", "the destination")

    try:
        if action_type == "add":
            result = await itinerary_editor.add_activity(itinerary, action, destination)
        elif action_type == "remove":
            result = itinerary_editor.remove_activity(itinerary, action)
        elif action_type == "replace":
            result = await itinerary_editor.replace_activity(itinerary, action, destination)
        elif action_type == "move":
            result = itinerary_editor.move_activity(itinerary, action)
        elif action_type == "add_day":
            result = itinerary_editor.add_day(itinerary)
        elif action_type == "remove_day":
            result = itinerary_editor.remove_day(itinerary, day or 1)
        else:
            return Command(
                update={
                    "messages": [ToolMessage(content=f"Unknown action type: {action_type}", tool_call_id=tool_call_id)],
                }
            )

        logger.info(f"[EDIT_ITINERARY] {action_type}: {result['message']}")

        # Write back only the itinerary key — see build_itinerary above.
        new_trip_state = {"itinerary": result["itinerary"]}

        return Command(
            update={
                "trip_state": new_trip_state,
                "messages": [ToolMessage(content=result["message"], tool_call_id=tool_call_id)],
            }
        )
    except Exception as e:
        logger.error(f"[EDIT_ITINERARY] Error: {e}")
        return Command(
            update={
                "messages": [ToolMessage(content=f"Failed to edit itinerary: {e}", tool_call_id=tool_call_id)],
            }
        )
