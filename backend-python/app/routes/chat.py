"""Chat routes — conversation management + agent chat."""

import uuid
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db, async_session
from app.deps import get_current_user
from app.models import Conversation, User
from app.schemas.chat import SendMessageRequest
from app.services.memory import get_user_memories
from app.services.stream_buffer import stream_buffer
from app.utils.logger import logger

router = APIRouter()

# Cap persisted conversation history to keep the JSONB column bounded
MAX_CONVERSATION_MESSAGES = 100

# Per-conversation stream guard — one in-flight agent run per thread_id.
# Two rapid send_message calls must not spawn two concurrent graph runs on the
# same checkpoint thread. In-process set is race-free (check+add with no await
# between); the Redis stream_buffer "active" flag is a cross-process backstop.
_active_conversations: set[str] = set()

# Strong refs for background stream tasks — asyncio.create_task results must
# be held or the task can be garbage-collected mid-run.
_background_tasks: set[asyncio.Task] = set()


def _interrupt_to_widget(intr) -> dict | None:
    """Convert a pending LangGraph Interrupt into a question_card widget."""
    payload = getattr(intr, "value", intr)
    if isinstance(payload, dict):
        if payload.get("type") == "question_card":
            return payload
        if payload.get("question"):
            return {"type": "question_card", "data": payload}
    return None


async def _pending_widget_for(conversation_id: str) -> dict | None:
    """Read the conversation's checkpoint for a pending ask_question interrupt.

    Returns the question_card widget to surface in the UI, or None.
    """
    try:
        from app.agents.travel_agent import travel_agent

        config = {"configurable": {"thread_id": conversation_id}}
        state = await travel_agent.agent.aget_state(config)
        candidates = list(getattr(state, "interrupts", None) or ())
        for task in getattr(state, "tasks", None) or ():
            candidates.extend(getattr(task, "interrupts", None) or ())
        for intr in candidates:
            widget = _interrupt_to_widget(intr)
            if widget:
                return widget
    except Exception as e:
        logger.warning(f"[CHAT] pending-interrupt lookup failed for {conversation_id}: {e}")
    return None


def _sanitize_json(obj):
    """Recursively convert non-JSON-serializable values (datetime, etc.) to strings."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_json(v) for v in obj]
    return obj


@router.post("/conversation")
async def create_conversation():
    return {"conversationId": str(uuid.uuid4())}


@router.post("")
@router.post("/")
@router.post("/message")
async def send_message(
    req: SendMessageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not req.message:
        raise HTTPException(status_code=400, detail="Message is required")

    conv_id = req.conversationId or str(uuid.uuid4())

    # Concurrency guard — one in-flight agent run per conversation. The
    # check+add is atomic (no await between) so two rapid requests can't both
    # spawn a graph run on the same checkpoint thread. Must happen BEFORE we
    # persist the user message so a rejected send doesn't linger unanswered.
    if conv_id in _active_conversations or await stream_buffer.is_active(conv_id):
        raise HTTPException(
            status_code=409,
            detail="A response is already being generated for this conversation",
        )
    _active_conversations.add(conv_id)

    try:
        return await _start_stream(req, conv_id, user, db)
    except Exception:
        # Anything failing before the background task takes over must release
        # the guard or this conversation stays locked forever.
        _active_conversations.discard(conv_id)
        raise


async def _start_stream(req, conv_id: str, user, db: AsyncSession):
    """Persist the user message and launch the background agent stream."""
    result = await db.execute(select(Conversation).where(Conversation.conversation_id == conv_id))
    conversation = result.scalar_one_or_none()

    if not conversation:
        conversation = Conversation(
            conversation_id=conv_id,
            user_id=user.id,
            messages=[],
            meta={},
        )
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)

    messages = list(conversation.messages or [])

    # If the previous assistant turn ended on a question_card widget, this
    # user message is the answer to that question — mark it so reopened
    # chats can rebuild the completed-question row.
    answered_question = None
    if messages:
        last_msg = messages[-1]
        if last_msg.get("role") == "assistant":
            for w in last_msg.get("widgets") or []:
                if isinstance(w, dict) and w.get("type") == "question_card":
                    answered_question = (w.get("data") or {}).get("question")
                    break

    user_msg = {
        "role": "user",
        "content": req.message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if answered_question:
        user_msg["answeredQuestion"] = answered_question
    messages.append(user_msg)
    conversation.messages = messages[-MAX_CONVERSATION_MESSAGES:]
    flag_modified(conversation, "messages")

    await db.commit()

    # Load long-term user memories (LangGraph store) for personalization
    memories = await get_user_memories(user.id)

    agent_context = {
        "tripState": conversation.trip_state,
        "userId": user.id,
        "userPreferences": user.preferences or {},
        "userMemories": memories,
    }

    logger.info(f"Processing (streaming): {req.message!r}")

    # Mark stream as active and launch background task (strong-ref'd so it
    # can't be GC'd mid-run; removed from the guard set in its finally).
    await stream_buffer.mark_active(conv_id)
    task = asyncio.create_task(_process_agent_stream(
        conv_id, req.message, agent_context, user.id
    ))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return {
        "conversationId": conv_id,
        "status": "streaming",
    }


async def _process_agent_stream(
    conv_id: str,
    message: str,
    agent_context: dict,
    user_id: str,
):
    """Background task: stream agent events and relay via Socket.IO.

    Handles token streaming, status updates, widget events, tripState changes,
    and final DB persistence.
    """
    from app.agents.travel_agent import travel_agent
    from app.main import sio

    # Tool activities for this turn, keyed by call_id — persisted on the
    # assistant message so the collapsed ToolActivityBar survives reloads.
    tool_activities: dict[str, dict] = {}

    try:
        async for event in travel_agent.chat_stream(message, conv_id, agent_context):
            if event["type"] == "token":
                eid = await stream_buffer.push_event(conv_id, "token", {"text": event["text"]})
                await sio.emit("agent:token", {
                    "conversationId": conv_id,
                    "text": event["text"],
                    "eventId": eid,
                }, room=conv_id)

            elif event["type"] == "status":
                eid = await stream_buffer.push_event(conv_id, "status", {"status": event["status"]})
                await sio.emit("agent:status", {
                    "conversationId": conv_id,
                    "status": event["status"],
                    "eventId": eid,
                }, room=conv_id)

            elif event["type"] == "tool_start":
                payload = {
                    "conversationId": conv_id,
                    "toolName": event.get("tool_name", ""),
                    "label": event.get("label", ""),
                    "callId": event.get("call_id", ""),
                    "input": event.get("input"),
                    "group": event.get("group"),
                }
                tool_activities[payload["callId"]] = {
                    "callId": payload["callId"],
                    "toolName": payload["toolName"],
                    "label": payload["label"],
                    "status": "running",
                    "group": payload["group"],
                }
                eid = await stream_buffer.push_event(conv_id, "tool_start", payload)
                payload["eventId"] = eid
                await sio.emit("agent:tool_start", payload, room=conv_id)

            elif event["type"] == "tool_end":
                payload = {
                    "conversationId": conv_id,
                    "toolName": event.get("tool_name", ""),
                    "label": event.get("label", ""),
                    "callId": event.get("call_id", ""),
                    "summary": event.get("summary", ""),
                    "error": event.get("error"),
                    "group": event.get("group"),
                }
                act = tool_activities.get(payload["callId"])
                if act is None:
                    act = tool_activities[payload["callId"]] = {
                        "callId": payload["callId"],
                        "toolName": payload["toolName"],
                        "label": payload["label"],
                        "group": payload["group"],
                    }
                act["status"] = "error" if payload["error"] else "finished"
                act["summary"] = payload["summary"]
                act["error"] = payload["error"]
                eid = await stream_buffer.push_event(conv_id, "tool_end", payload)
                payload["eventId"] = eid
                await sio.emit("agent:tool_end", payload, room=conv_id)

            elif event["type"] == "itinerary_day":
                payload = {
                    "conversationId": conv_id,
                    "day": event.get("day"),
                    "city": event.get("city"),
                    "timeSlots": event.get("timeSlots"),
                    "totalDays": event.get("totalDays"),
                }
                eid = await stream_buffer.push_event(conv_id, "itinerary_day", payload)
                payload["eventId"] = eid
                await sio.emit("agent:itinerary_day", payload, room=conv_id)

            elif event["type"] == "widget":
                eid = await stream_buffer.push_event(conv_id, "widget", {"widget": event["widget"]})
                await sio.emit("agent:widget", {
                    "conversationId": conv_id,
                    "widget": event["widget"],
                    "eventId": eid,
                }, room=conv_id)

            elif event["type"] == "tripState":
                sanitized = _sanitize_json(event["tripState"])
                eid = await stream_buffer.push_event(conv_id, "tripState", {"tripState": sanitized})
                await sio.emit("agent:tripState", {
                    "conversationId": conv_id,
                    "tripState": sanitized,
                    "eventId": eid,
                }, room=conv_id)

            elif event["type"] == "complete":
                payload = event["payload"]
                ai_response = payload.get("response", "I apologize, but I had trouble processing your request.")

                # Persist to DB
                async with async_session() as db:
                    result = await db.execute(
                        select(Conversation).where(Conversation.conversation_id == conv_id)
                    )
                    conversation = result.scalar_one_or_none()
                    if conversation:
                        msgs = list(conversation.messages or [])
                        assistant_msg = {
                            "role": "assistant",
                            "content": ai_response,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                        # Persist widgets + tool activities + suggestions so a
                        # reopened chat can fully restore the turn's UI.
                        if payload.get("widgets"):
                            assistant_msg["widgets"] = _sanitize_json(payload["widgets"])
                        activities = list(tool_activities.values())
                        if activities:
                            assistant_msg["toolActivities"] = _sanitize_json(activities)
                        if payload.get("suggestions"):
                            assistant_msg["suggestions"] = payload["suggestions"]
                        msgs.append(assistant_msg)
                        conversation.messages = msgs[-MAX_CONVERSATION_MESSAGES:]
                        flag_modified(conversation, "messages")

                        if payload.get("tripState"):
                            conversation.trip_state = _sanitize_json(payload["tripState"])
                            flag_modified(conversation, "trip_state")
                            logger.info("Saved tripState to conversation")

                        await db.commit()

                # Emit final response
                final_payload = {
                    "message": ai_response,
                    "conversationId": conv_id,
                    "widgets": payload.get("widgets", []),
                    "suggestions": payload.get("suggestions", []),
                    "changeSummary": payload.get("changeSummary", []),
                    "classification": payload.get("classification"),
                    "tripState": _sanitize_json(payload.get("tripState")),
                }
                eid = await stream_buffer.push_event(conv_id, "response", final_payload)
                final_payload["eventId"] = eid
                await sio.emit("agent:response", final_payload, room=conv_id)

    except Exception as e:
        logger.error(f"[STREAM_TASK] Failed: {e}", exc_info=True)
        error_payload = {
            "message": "I'm sorry, I encountered an error processing your request.",
            "conversationId": conv_id,
            "widgets": [],
            "suggestions": [],
            "changeSummary": [],
            "classification": None,
            "tripState": None,
            "error": str(e),
        }
        eid = await stream_buffer.push_event(conv_id, "response", error_payload)
        error_payload["eventId"] = eid
        await sio.emit("agent:response", error_payload, room=conv_id)

    finally:
        _active_conversations.discard(conv_id)
        await stream_buffer.mark_done(conv_id)


@router.get("/history/{conversation_id}")
@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Conversation).where(Conversation.conversation_id == conversation_id))
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # If the graph checkpoint holds a pending interrupt (ask_question awaiting
    # an answer), surface the question payload so the reopened chat re-arms
    # the QuestionCard — parity with the pending-widget restore that used to
    # read _pendingWidget out of trip_state.
    pending_widget = await _pending_widget_for(conversation_id)

    messages = list(conversation.messages or [])
    if pending_widget:
        # The interrupt usually already persisted as a question_card widget on
        # the trailing assistant message. If it's missing (old rows, failed
        # persist), inject it so buildChatRestore picks it up naturally.
        if messages and messages[-1].get("role") == "assistant":
            widgets = list(messages[-1].get("widgets") or [])
            if not any(
                isinstance(w, dict) and w.get("type") == "question_card"
                for w in widgets
            ):
                messages[-1] = {**messages[-1], "widgets": widgets + [pending_widget]}
        else:
            messages.append({
                "role": "assistant",
                "content": "",
                "widgets": [pending_widget],
                "timestamp": None,
            })

    return {
        "conversationId": conversation.conversation_id,
        "messages": messages,
        "metadata": conversation.meta,
        "pendingWidget": pending_widget,
        "createdAt": conversation.created_at.isoformat() if conversation.created_at else None,
        "updatedAt": conversation.updated_at.isoformat() if conversation.updated_at else None,
    }


@router.get("/stream/{conversation_id}")
async def get_stream_events(
    conversation_id: str,
    after: str = "0",
    user: User = Depends(get_current_user),
):
    """Replay buffered stream events for a conversation.

    Used by the frontend on reconnect to catch up on missed events.
    `after` is the last seen Redis stream entry ID (default "0" = all).
    """
    events = await stream_buffer.read_events(conversation_id, after_id=after)
    is_active = await stream_buffer.is_active(conversation_id)
    last_id = events[-1]["id"] if events else after
    return {
        "conversationId": conversation_id,
        "events": events,
        "isActive": is_active,
        "lastEventId": last_id,
    }


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Conversation).where(Conversation.conversation_id == conversation_id))
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.delete(conversation)
    await db.commit()
    await stream_buffer.clear_stream(conversation_id)

    # Delete the LangGraph checkpoint thread too — otherwise checkpoint/
    # writes rows for this thread_id orphan forever.
    try:
        from app.agents.travel_agent import travel_agent

        checkpointer = getattr(travel_agent, "checkpointer", None)
        adelete = getattr(checkpointer, "adelete_thread", None)
        if adelete:
            await adelete(conversation_id)
    except Exception as e:
        logger.warning(f"[CHAT] checkpoint cleanup failed for {conversation_id}: {e}")

    return {"message": "Conversation deleted successfully"}
