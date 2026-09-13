"""Per-conversation progress event bus.

`chat_stream` registers an asyncio.Queue per conversation so code running
inside agent tool calls (e.g. `itinerary_builder` invoked by the
`build_itinerary` tool) can push UI progress events that get merged into the
agent:* socket stream in real time.

This exists because LangGraph's `get_stream_writer` custom events are not
reliably surfaced for async tools when consuming `astream_events(version="v3")`
projections — writes from inside tool coroutines are dropped. The bus is a
plain in-process queue: emit() never raises and returns False when no queue
is registered (non-streaming callers), so producers can call it
unconditionally.

Also hosts `builder_update_events`, the shared translator that converts
`itinerary_builder` status_cb updates into chat_stream events. It handles both
the lifecycle contract

    {"phase": ..., "state": "start"|"end", "task_id": ..., "city": ...,
     "day": ..., "group": "place_search"|"day_build"|"extras",
     "detail": ..., "timeSlots": [...], "totalDays": N}

and the legacy phase-only updates ({"phase": "activities"|"day_complete"|...}
with no "state").
"""

import asyncio
import contextvars

_queues: dict[str, asyncio.Queue] = {}

# Sentinel pushed onto a queue to tell its consumer task to stop.
STOP_EVENT: dict = {"type": "_bus_stop"}

# Conversation id for the in-flight stream, as a contextvar. Tool coroutines
# run in child tasks of chat_stream so they inherit this — a reliable fallback
# when ToolRuntime config injection doesn't carry metadata through.
_current_conversation: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "progress_bus_conversation", default=None
)


def set_current(conversation_id: str) -> None:
    _current_conversation.set(conversation_id)


def current() -> str:
    return _current_conversation.get() or ""


def register(conversation_id: str) -> asyncio.Queue:
    """Create (or replace) the progress queue for a conversation."""
    queue: asyncio.Queue = asyncio.Queue()
    _queues[conversation_id] = queue
    set_current(conversation_id)
    return queue


def unregister(conversation_id: str) -> None:
    """Drop the progress queue for a conversation."""
    _queues.pop(conversation_id, None)


def emit(conversation_id: str, event: dict) -> bool:
    """Push an event onto the conversation's progress queue.

    Returns False when no queue is registered or the event is malformed.
    Never raises — safe to call from inside tool calls.
    """
    queue = _queues.get(conversation_id)
    if queue is None or not isinstance(event, dict):
        return False
    try:
        queue.put_nowait(event)
        return True
    except Exception:
        return False


# ------------------------------------------------------------------
# itinerary_builder status_cb update -> chat_stream event translation
# ------------------------------------------------------------------


def _phase_label(
    phase: str,
    city: str = "",
    cities: list | None = None,
    day: int | None = None,
    total: int = 0,
) -> str:
    """Human-readable label for a build phase."""
    if phase == "search_places":
        return f"Searching places in {city}" if city else "Searching places"
    if phase == "curate_day":
        if city:
            return f"Curating day {day} in {city}"
        return f"Curating day {day}" if day else "Curating day"
    if phase == "travel_times":
        return f"Computing travel times in {city}" if city else "Computing travel times"
    if phase == "hotels_restaurants":
        names = ", ".join(c for c in (cities or ([city] if city else [])) if c)
        return f"Searching hotels & restaurants in {names}" if names else "Searching hotels & restaurants"
    if phase == "flights":
        return "Searching flights"
    if phase == "build_start":
        return "Building your itinerary"
    if phase == "build_complete":
        return "Finalizing your itinerary"
    if phase == "day_complete":
        return f"Day {day} of {total} ready in {city}"
    if phase == "activities":  # legacy alias
        return f"Finding activities in {city}" if city else "Finding activities"
    return phase.replace("_", " ").capitalize() or "Working"


def builder_update_events(update: dict, counter: list[int]) -> list[dict]:
    """Translate one itinerary_builder status_cb update into chat_stream events.

    Returns a list of event dicts (status / tool_start / tool_end /
    itinerary_day) ready to be yielded by chat_stream or pushed onto the
    progress bus.

    `counter` is a single-element list used to mint call_ids for legacy
    phase-only updates (which pair tool_start+tool_end immediately).
    """
    events: list[dict] = []
    phase = update.get("phase", "")
    state = update.get("state")
    task_id = update.get("task_id")
    group = update.get("group")
    detail = update.get("detail") or ""
    city = update.get("city") or ""
    cities = update.get("cities")
    day = update.get("day")
    total = update.get("totalDays") or 0

    label = _phase_label(phase, city=city, cities=cities, day=day, total=total)

    if state in ("start", "end"):
        # New lifecycle contract — start/end arrive as separate events so
        # parallel work shows as in-progress in the UI.
        tool_name = f"itinerary_build_{phase}"
        # task_id is the stable call id. When absent (e.g. build_start /
        # build_complete bracketing the whole build), key on the group so the
        # pair still resolves to the same row.
        call_id = task_id or f"build_{group or phase}"
        if state == "start":
            start_label = f"{label} — {detail}" if detail else label
            events.append({"type": "status", "status": start_label})
            events.append({
                "type": "tool_start",
                "tool_name": tool_name,
                "label": start_label,
                "call_id": call_id,
                "input": update,
                "group": group,
            })
        else:
            events.append({
                "type": "tool_end",
                "tool_name": tool_name,
                "label": label,
                "call_id": call_id,
                "summary": detail,
                "error": None,
                "group": group,
            })
            if phase == "day_complete":
                events.append({"type": "status", "status": label})
    else:
        # Legacy phase-only updates — preserve existing behavior: a status
        # line plus an immediately paired tool_start/tool_end.
        msg = ""
        if phase == "activities":
            msg = f"Finding activities in {city}..."
        elif phase == "search_places":
            msg = f"Searching places in {city}..."
        elif phase == "curate_day":
            msg = f"Curating day {day} in {city}..."
        elif phase == "travel_times":
            msg = f"Computing travel times{f' in {city}' if city else ''}..."
        elif phase == "hotels_restaurants":
            cities_str = ", ".join(c for c in (cities or [city]) if c)
            msg = f"Searching hotels & restaurants in {cities_str}..."
        elif phase == "flights":
            msg = "Searching flights..."
        elif phase == "day_complete":
            msg = f"Day {day} of {total} ready in {city}"
        elif phase == "build_complete":
            msg = "Finalizing your itinerary..."
        elif phase == "build_start":
            msg = "Building your itinerary..."
        if msg:
            events.append({"type": "status", "status": msg})
            counter[0] += 1
            call_id = f"build_{counter[0]}"
            events.append({
                "type": "tool_start",
                "tool_name": f"itinerary_build_{phase}",
                "label": msg.rstrip("."),
                "call_id": call_id,
                "input": update,
                "group": group,
            })
            events.append({
                "type": "tool_end",
                "tool_name": f"itinerary_build_{phase}",
                "label": msg.rstrip("."),
                "call_id": call_id,
                "summary": f"Day {day} of {total}" if phase == "day_complete" else "",
                "error": None,
                "group": group,
            })

    # Progressive day rendering — day_complete carries timeSlots. Skipped for
    # a hypothetical state:"start" day_complete (nothing to render yet).
    if phase == "day_complete" and state != "start":
        events.append({
            "type": "itinerary_day",
            "day": day,
            "city": city,
            "timeSlots": update.get("timeSlots"),
            "totalDays": total,
        })

    return events
