"""Tests for trip_state write discipline.

Covers:
- Partial-write Commands: tools must only write back the trip_state keys they
  own (stale full snapshots clobber concurrent writes under the right-wins
  shallow merge reducer).
- Manual itinerary edits syncing to the LangGraph checkpoint via aupdate_state
  (the checkpointer — not conversation.trip_state — is the agent's source of
  truth, and chat_stream never re-seeds keys the checkpoint already has).
- build_itinerary injecting personalization (userMemories / userInterests /
  travelerType) into the builder ctx.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.booking_import import merge_booking_into_trip_state


def _flight_booking(booking_id: str = "msg-1") -> dict:
    return {
        "id": booking_id,
        "type": "flight",
        "subject": "Your flight confirmation",
        "confirmationCode": "ABC123",
        "details": {
            "airline": "UA",
            "flightNumber": "UA123",
            "departureTime": "2026-10-10T09:00:00Z",
            "departureAirport": {"name": "San Francisco", "iata": "SFO"},
            "arrivalAirport": {"name": "Tokyo Haneda", "iata": "HND"},
        },
    }


# ---------------------------------------------------------------------------
# merge_booking_into_trip_state — partial update contract
# ---------------------------------------------------------------------------

def test_merge_returns_only_owned_keys():
    trip_state = {
        "cities": [{"name": "Tokyo"}],
        "dates": {"start": "2026-10-10"},
        "itinerary": {"days": [], "flightOptions": []},
        "bookings": [],
    }
    update, _msg = merge_booking_into_trip_state(trip_state, _flight_booking())

    assert set(update.keys()) <= {"bookings", "itinerary"}
    assert "cities" not in update
    assert "dates" not in update
    assert update["bookings"][0]["id"] == "msg-1"
    assert update["bookings"][0]["importedAt"]
    # Flight attached into the itinerary
    assert update["itinerary"]["flightOptions"][0]["id"] == "email-msg-1"


def test_merge_without_itinerary_only_writes_bookings():
    update, msg = merge_booking_into_trip_state(
        {"cities": [{"name": "Tokyo"}]}, _flight_booking()
    )
    assert set(update.keys()) == {"bookings"}
    assert "no itinerary" in msg


def test_merge_dedupes_booking_by_id():
    trip_state = {"bookings": [{"id": "msg-1", "importedAt": "2000-01-01"}]}
    update, _ = merge_booking_into_trip_state(trip_state, _flight_booking())
    assert len(update["bookings"]) == 1
    assert update["bookings"][0]["importedAt"] != "2000-01-01"


def test_merge_unknown_booking_type_keeps_itinerary_untouched():
    trip_state = {"itinerary": {"days": []}}
    booking = {"id": "msg-9", "type": "train", "details": {}}
    update, _ = merge_booking_into_trip_state(trip_state, booking)
    assert set(update.keys()) == {"bookings"}


# ---------------------------------------------------------------------------
# import_email_booking — Command update carries only owned keys
# ---------------------------------------------------------------------------

async def test_import_email_booking_partial_command_update():
    from app.agents.tools.gmail_tools import import_email_booking

    state = {
        "trip_state": {
            "cities": [{"name": "Tokyo"}],
            "dates": {"start": "2026-10-10"},
            "itinerary": {"days": [], "flightOptions": []},
            "bookings": [_flight_booking()],
        }
    }
    cmd = await import_email_booking.coroutine(
        booking_id="msg-1",
        state=state,
        config={"configurable": {"user_id": "1"}},
        tool_call_id="call-1",
    )

    ts_update = cmd.update["trip_state"]
    assert set(ts_update.keys()) <= {"bookings", "itinerary"}
    # The stale-snapshot keys must NOT be echoed back.
    assert "cities" not in ts_update
    assert "dates" not in ts_update
    assert ts_update["itinerary"]["flightOptions"][0]["id"] == "email-msg-1"


async def test_import_email_booking_missing_booking_writes_nothing():
    from app.agents.tools.gmail_tools import import_email_booking

    state = {"trip_state": {"bookings": []}}
    cmd = await import_email_booking.coroutine(
        booking_id="nope",
        state=state,
        config=None,  # no user_id → no fresh Gmail re-fetch
        tool_call_id="call-2",
    )
    assert "trip_state" not in cmd.update


# ---------------------------------------------------------------------------
# itinerary_edit._save_state — DB write + LangGraph checkpoint sync
# ---------------------------------------------------------------------------

async def test_save_state_syncs_itinerary_to_checkpoint(monkeypatch):
    from app.agents.travel_agent import travel_agent
    from app.models import Conversation
    from app.routes import itinerary_edit

    fake_agent = MagicMock()
    fake_agent.aupdate_state = AsyncMock()
    monkeypatch.setattr(travel_agent, "_agent", fake_agent)

    conversation = Conversation(
        conversation_id="conv-123", user_id=1, messages=[]
    )
    db = AsyncMock()
    new_state = {
        "cities": [{"name": "Tokyo"}],
        "itinerary": {"days": [{"day": 1, "timeSlots": []}]},
    }

    await itinerary_edit._save_state(db, conversation, new_state)

    db.commit.assert_awaited_once()
    fake_agent.aupdate_state.assert_awaited_once()
    config, values = fake_agent.aupdate_state.await_args.args[:2]
    assert config == {"configurable": {"thread_id": "conv-123"}}
    # Only the itinerary key is synced — the merge reducer fills in the rest.
    assert values == {"trip_state": {"itinerary": new_state["itinerary"]}}


async def test_save_state_survives_checkpoint_sync_failure(monkeypatch):
    """A checkpoint-sync failure must not fail the request — the DB write
    already succeeded and remains correct for non-agent readers."""
    from app.agents.travel_agent import travel_agent
    from app.models import Conversation
    from app.routes import itinerary_edit

    fake_agent = MagicMock()
    fake_agent.aupdate_state = AsyncMock(side_effect=RuntimeError("boom"))
    monkeypatch.setattr(travel_agent, "_agent", fake_agent)

    conversation = Conversation(conversation_id="conv-err", user_id=1, messages=[])
    db = AsyncMock()

    await itinerary_edit._save_state(
        db, conversation, {"itinerary": {"days": []}}
    )  # must not raise
    db.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# build_itinerary — personalization ctx
# ---------------------------------------------------------------------------

def _patch_builder(monkeypatch):
    """Patch itinerary_builder.build to capture the ctx it receives."""
    from app.agents.tools import itinerary_tools

    captured = {}

    async def fake_build(ctx, status_cb=None):
        captured["ctx"] = ctx
        return {"itinerary": {"days": [{"day": 1, "timeSlots": []}]}}

    monkeypatch.setattr(itinerary_tools.itinerary_builder, "build", fake_build)
    return captured


def _tool_state():
    return {
        "trip_state": {
            "cities": [{"name": "Tokyo", "nights": 4}],
            "duration": 5,
            "travelers": "couple",
            "tripStyle": "culture",
        }
    }


async def test_build_itinerary_injects_personalization(monkeypatch):
    from app.agents.tools import itinerary_tools

    captured = _patch_builder(monkeypatch)
    monkeypatch.setattr(
        "app.services.memory.get_user_memories",
        AsyncMock(return_value=["dietary: vegetarian"]),
    )
    monkeypatch.setattr(
        itinerary_tools, "_get_user_interests",
        AsyncMock(return_value=["photography"]),
    )

    runtime = SimpleNamespace(
        config={"configurable": {"user_id": 7, "thread_id": "conv-x"}}
    )
    cmd = await itinerary_tools.build_itinerary.coroutine(
        state=_tool_state(), tool_call_id="call-9", runtime=runtime,
    )

    ctx = captured["ctx"]
    assert ctx["userMemories"] == ["dietary: vegetarian"]
    assert ctx["userInterests"] == ["photography"]
    assert ctx["travelerType"] == "couple"
    # The tool still writes back only the itinerary key.
    assert set(cmd.update["trip_state"].keys()) == {"itinerary"}


async def test_build_itinerary_without_user_id_has_no_personalization(monkeypatch):
    from app.agents.tools import itinerary_tools

    captured = _patch_builder(monkeypatch)
    get_memories = AsyncMock(return_value=["dietary: vegetarian"])
    monkeypatch.setattr("app.services.memory.get_user_memories", get_memories)
    get_interests = AsyncMock(return_value=["photography"])
    monkeypatch.setattr(itinerary_tools, "_get_user_interests", get_interests)

    runtime = SimpleNamespace(config={"configurable": {"thread_id": "conv-y"}})
    await itinerary_tools.build_itinerary.coroutine(
        state=_tool_state(), tool_call_id="call-10", runtime=runtime,
    )

    ctx = captured["ctx"]
    assert "userMemories" not in ctx
    assert "userInterests" not in ctx
    get_memories.assert_not_awaited()
    get_interests.assert_not_awaited()
