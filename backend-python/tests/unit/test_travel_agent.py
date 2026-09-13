"""Tests for the travel agent — LLM-driven flow and streaming.

These tests verify the new architecture where the agent uses plan_trip and
ask_question tools instead of the old slot-filling state machine.
Tests use chat_stream() — the streaming async generator.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.agents.travel_agent import TravelAgent
from app.agents.state import create_default_trip_state, normalize_dates, distribute_nights


@pytest.fixture
def agent():
    return TravelAgent()


async def _collect_stream(gen):
    """Collect all events from chat_stream async generator, return final payload."""
    events = []
    async for event in gen:
        events.append(event)
        if event.get("type") == "complete":
            return event.get("payload", {}), events
    return {}, events


def _build_state_with_route():
    """Build a trip state with route proposal (simulating plan_trip output)."""
    state = create_default_trip_state()
    state["cities"] = [{"name": "Tokyo", "order": 0, "nights": 6}]
    state["duration"] = 7
    state["dates"] = {"start": "2026-10-10", "end": "2026-10-16", "assumed": False}
    state["travelers"] = {"adults": 1}
    state["tripStyle"] = "culture"
    state["helpWith"] = ["everything"]
    state["startLocation"] = "San Francisco"
    state["routeProposal"] = {
        "cities": [{"name": "Tokyo", "nights": 6, "order": 0}],
        "totalNights": 6,
        "rationale": "Single city stay.",
    }
    state["version"] = 1
    return state


class _MockTextProjection:
    """Mock for the AsyncProjection returned by message_event.text."""
    def __init__(self, tokens):
        self._tokens = tokens

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for t in self._tokens:
            yield t


class _MockStreamMessages:
    """Mock for the stream.messages projection from astream_events v3."""
    def __init__(self, tokens):
        self._tokens = tokens

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for t in self._tokens:
            msg = MagicMock()
            msg.text = _MockTextProjection([t])
            msg.node = "model"
            yield msg


class _MockStreamToolCalls:
    """Mock for the stream.tool_calls projection — empty by default."""
    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        return
        yield  # make it an async generator


class _MockInterrupt:
    """Minimal stand-in for langgraph.types.Interrupt."""
    def __init__(self, value, id="i1"):
        self.value = value
        self.id = id


class _MockStream:
    """Mock for the AsyncGraphRunStream returned by astream_events(version='v3')."""
    def __init__(self, tokens, final_state=None, interrupts=None):
        self.messages = _MockStreamMessages(tokens)
        self.tool_calls = _MockStreamToolCalls()
        self._final_state = final_state or {}
        self._interrupts = interrupts or []

    async def interrupted(self):
        return bool(self._interrupts)

    async def interrupts(self):
        return self._interrupts

    async def output(self):
        return self._final_state

    async def abort(self):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        await self.abort()
        return False


@pytest.mark.asyncio
async def test_agent_always_invoked(agent):
    """The agent is ALWAYS invoked — it decides what to ask or build."""
    mock_stream = _MockStream(
        tokens=["Where would you like to go?"],
        final_state={"trip_state": create_default_trip_state(), "messages": []},
    )
    agent._agent = MagicMock()
    agent._agent.astream_events = AsyncMock(return_value=mock_stream)

    result, events = await _collect_stream(
        agent.chat_stream("I want to plan a trip", "conv-1")
    )

    agent._agent.astream_events.assert_called_once()
    assert result.get("response") == "Where would you like to go?"


@pytest.mark.asyncio
async def test_agent_invoked_with_user_message(agent):
    """The agent receives the user message in the input dict."""
    trip_state = create_default_trip_state()

    mock_stream = _MockStream(
        tokens=["When are you planning to travel?"],
        final_state={"trip_state": trip_state, "messages": []},
    )
    agent._agent = MagicMock()
    agent._agent.astream_events = AsyncMock(return_value=mock_stream)

    await _collect_stream(
        agent.chat_stream("Tokyo", "conv-2", context={"tripState": trip_state})
    )

    call_args = agent._agent.astream_events.call_args
    input_arg = call_args[0][0]
    assert "messages" in input_arg
    assert any(m.get("content") == "Tokyo" for m in input_arg["messages"])


@pytest.mark.asyncio
async def test_agent_reads_updated_trip_state_from_stream_output(agent):
    """When plan_trip updates trip_state, chat_stream reads it from stream.output()."""
    updated_state = _build_state_with_route()

    mock_stream = _MockStream(
        tokens=["Great! Let me build your itinerary."],
        final_state={"trip_state": updated_state, "messages": []},
    )
    agent._agent = MagicMock()
    agent._agent.astream_events = AsyncMock(return_value=mock_stream)
    agent._auto_build_itinerary = AsyncMock(return_value=updated_state)

    result, events = await _collect_stream(
        agent.chat_stream("Plan a trip to Tokyo in October for 7 days", "conv-3")
    )

    ts = result.get("tripState", {})
    assert ts.get("routeProposal") is not None


@pytest.mark.asyncio
async def test_auto_build_triggers_when_route_proposed(agent):
    """When plan_trip sets a routeProposal, auto-build itinerary should trigger."""
    state_with_route = _build_state_with_route()

    mock_stream = _MockStream(
        tokens=["All set! Let me build your trip."],
        final_state={"trip_state": state_with_route, "messages": []},
    )
    agent._agent = MagicMock()
    agent._agent.astream_events = AsyncMock(return_value=mock_stream)
    agent._auto_build_itinerary = AsyncMock(return_value=state_with_route)

    result, events = await _collect_stream(
        agent.chat_stream("Plan a 7-day trip to Tokyo in October, solo, culture", "conv-4")
    )

    agent._auto_build_itinerary.assert_called_once()


@pytest.mark.asyncio
async def test_no_auto_build_when_itinerary_exists(agent):
    """When an itinerary already exists, auto-build should NOT trigger."""
    full_state = _build_state_with_route()
    full_state["itinerary"] = {"days": [{"day": 1}]}

    mock_stream = _MockStream(
        tokens=["Your itinerary looks good."],
        final_state={"trip_state": full_state, "messages": []},
    )
    agent._agent = MagicMock()
    agent._agent.astream_events = AsyncMock(return_value=mock_stream)
    agent._auto_build_itinerary = AsyncMock()

    await _collect_stream(
        agent.chat_stream("looks good", "conv-5", context={"tripState": full_state})
    )

    agent._auto_build_itinerary.assert_not_called()


@pytest.mark.asyncio
async def test_stream_failure_propagates_without_reinvoke(agent):
    """No ainvoke fallback — a failed stream raises (re-invoking would
    duplicate the user message in the checkpointed messages channel and
    clobber checkpoint trip_state with a stale snapshot). The upstream
    complete-with-error path in _process_agent_stream handles the user-facing
    error response."""
    full_state = _build_state_with_route()

    agent._agent = MagicMock()
    agent._agent.astream_events = AsyncMock(side_effect=Exception("stream error"))
    agent._agent.ainvoke = AsyncMock()

    with pytest.raises(Exception, match="stream error"):
        async for _ in agent.chat_stream("edit day 1", "conv-6", context={"tripState": full_state}):
            pass

    agent._agent.ainvoke.assert_not_called()


@pytest.mark.asyncio
async def test_pending_interrupt_resumes_with_command(agent):
    """A checkpointed pending interrupt means the user message is an answer —
    chat_stream must resume the run via Command(resume=...) instead of
    starting a new run with a fresh HumanMessage."""
    from types import SimpleNamespace
    from langgraph.types import Command

    intr = _MockInterrupt({"question": "When are you traveling?"})
    task = SimpleNamespace(name="tools", interrupts=(intr,))
    state = SimpleNamespace(
        values={"trip_state": create_default_trip_state()},
        tasks=(task,),
        interrupts=(intr,),
    )

    mock_stream = _MockStream(
        tokens=["Great — planning now."],
        final_state={"trip_state": create_default_trip_state(), "messages": []},
    )
    agent._agent = MagicMock()
    agent._agent.aget_state = AsyncMock(return_value=state)
    agent._agent.astream_events = AsyncMock(return_value=mock_stream)

    result, events = await _collect_stream(
        agent.chat_stream("October", "conv-resume-1")
    )

    call_args = agent._agent.astream_events.call_args
    input_arg = call_args[0][0]
    assert isinstance(input_arg, Command)
    assert input_arg.resume == "October"
    assert result.get("response") == "Great — planning now."


@pytest.mark.asyncio
async def test_interrupt_surfaces_question_card_widget(agent):
    """When the run suspends on interrupt(), chat_stream emits a widget event
    with the question_card shape and includes it in the complete payload."""
    intr = _MockInterrupt({"question": "When are you traveling?", "options": []})
    mock_stream = _MockStream(
        tokens=["I need one detail."],
        final_state={"trip_state": create_default_trip_state(), "messages": []},
        interrupts=[intr],
    )
    agent._agent = MagicMock()
    agent._agent.astream_events = AsyncMock(return_value=mock_stream)

    result, events = await _collect_stream(
        agent.chat_stream("Plan a trip to Japan", "conv-intr-1")
    )

    widget_events = [e for e in events if e.get("type") == "widget"]
    assert widget_events, "expected a widget event for the pending interrupt"
    assert widget_events[0]["widget"] == {
        "type": "question_card",
        "data": {"question": "When are you traveling?", "options": []},
    }
    assert any(
        w.get("type") == "question_card" for w in result.get("widgets", [])
    )
    # Streamed text survives alongside the card — the interrupt doesn't eat it
    assert result.get("response") == "I need one detail."
    # A pending question suppresses the "I apologize" fallback text
    # (no response_text fabrication when a widget is pending) — covered above.


@pytest.mark.asyncio
async def test_no_auto_build_when_question_pending(agent):
    """A turn that suspends on ask_question must not trigger auto-build even
    if a routeProposal already exists."""
    state = _build_state_with_route()
    intr = _MockInterrupt({"question": "Confirm the route?"})
    mock_stream = _MockStream(
        tokens=[],
        final_state={"trip_state": state, "messages": []},
        interrupts=[intr],
    )
    agent._agent = MagicMock()
    agent._agent.astream_events = AsyncMock(return_value=mock_stream)
    agent._auto_build_itinerary = AsyncMock()

    result, events = await _collect_stream(
        agent.chat_stream("build it", "conv-intr-2", context={"tripState": state})
    )

    agent._auto_build_itinerary.assert_not_called()
    assert result.get("response") == ""


@pytest.mark.asyncio
async def test_no_interrupt_events(agent):
    """The new architecture has no interrupt events (no route confirmation)."""
    state_with_route = _build_state_with_route()

    mock_stream = _MockStream(
        tokens=["Building your itinerary..."],
        final_state={"trip_state": state_with_route, "messages": []},
    )
    agent._agent = MagicMock()
    agent._agent.astream_events = AsyncMock(return_value=mock_stream)
    agent._auto_build_itinerary = AsyncMock(return_value=state_with_route)

    result, events = await _collect_stream(
        agent.chat_stream("build it", "conv-7", context={"tripState": state_with_route})
    )

    # No interrupt events should be emitted
    assert not any(e.get("type") == "interrupt" for e in events)
