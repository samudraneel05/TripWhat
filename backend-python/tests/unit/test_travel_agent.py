"""Tests for the travel agent — LLM-driven flow and streaming.

These tests verify the new architecture where the agent uses plan_trip and
ask_question tools instead of the old slot-filling state machine.
Tests use chat_stream() — the streaming async generator.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.agents.travel_agent import TravelAgent
from app.agents.state import create_default_trip_state, normalize_dates, distribute_nights
from app.config import settings


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


async def test_middleware_falls_back_on_rate_limit(agent, monkeypatch):
    """A rate-limited primary model retries once on the fallback model."""
    import openai
    from langchain_core.messages import HumanMessage

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    middleware = agent._build_middleware()[1]  # dynamic_model_selection

    calls = []

    class FakeRequest:
        state = {"trip_state": {}}
        system_message = None
        messages = [HumanMessage(content="plan a trip to tokyo")]

        class runtime:
            context = {}

        def override(self, **kw):
            calls.append(kw)
            return self

    def _rate_limit():
        import httpx as hx
        req = hx.Request("POST", "https://api.openai.com/v1/chat/completions")
        resp = hx.Response(429, request=req, json={"error": {"message": "rate limited"}})
        return openai.RateLimitError("rate limited", response=resp, body=None)

    async def handler(request):
        if len(calls) == 1:
            raise _rate_limit()
        return "ok"

    result = await middleware.awrap_model_call(FakeRequest(), handler)
    assert result == "ok"
    assert len(calls) == 2
    assert calls[1]["model"].model_name == settings.fallback_model


async def test_middleware_does_not_retry_other_errors(agent, monkeypatch):
    from langchain_core.messages import HumanMessage

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    middleware = agent._build_middleware()[1]

    class FakeRequest:
        state = {"trip_state": {}}
        system_message = None
        messages = [HumanMessage(content="plan a trip to tokyo")]

        class runtime:
            context = {}

        def override(self, **kw):
            return self

    async def handler(request):
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await middleware.awrap_model_call(FakeRequest(), handler)


def test_interrupt_error_detection_covers_graph_interrupt():
    from app.agents.travel_agent import _is_interrupt_error
    from langgraph.errors import GraphInterrupt
    from langgraph.types import Interrupt

    intr = Interrupt(value={"question": "when?"})
    assert _is_interrupt_error(GraphInterrupt((intr,))) is True
    assert _is_interrupt_error(RuntimeError("boom")) is False
    assert _is_interrupt_error(None) is False


# --- Progressive tool disclosure --------------------------------------------

def test_active_tool_names_core_only_for_plain_planning(agent):
    from langchain_core.messages import HumanMessage
    from app.agents.travel_agent import _active_tool_names

    names = _active_tool_names(
        [HumanMessage(content="plan a 3-day trip to Paris")], agent._tools
    )
    assert {"plan_trip", "ask_question", "search_tools"} <= names
    assert "get_email_bookings" not in names
    assert "book_flight" not in names
    assert "mcp_lookup_weather" not in names


def test_active_tool_names_unlocks_domains_on_signal(agent):
    from langchain_core.messages import HumanMessage
    from app.agents.travel_agent import _active_tool_names

    assert "get_email_bookings" in _active_tool_names(
        [HumanMessage(content="check my email for hotel bookings")], agent._tools
    )
    assert "mcp_lookup_weather" in _active_tool_names(
        [HumanMessage(content="what's the weather in Tokyo in November")], agent._tools
    )
    assert "search_flights" in _active_tool_names(
        [HumanMessage(content="find flights from NYC")], agent._tools
    )
    assert "create_calendar_event" in _active_tool_names(
        [HumanMessage(content="add this to my calendar")], agent._tools
    )


def test_search_tools_meta_tool_discovers_hidden_tools(agent):
    from langchain_core.messages import AIMessage, HumanMessage
    from app.agents.travel_agent import _active_tool_names

    msgs = [
        HumanMessage(content="import my bookings"),
        AIMessage(content="", tool_calls=[
            {"name": "search_tools", "args": {"query": "email bookings"}, "id": "1"}
        ]),
    ]
    names = _active_tool_names(msgs, agent._tools)
    assert "get_email_bookings" in names
    assert "import_email_booking" in names


def test_active_tool_names_keeps_previously_called_tools(agent):
    from langchain_core.messages import AIMessage, HumanMessage
    from app.agents.travel_agent import _active_tool_names

    msgs = [
        HumanMessage(content="check my email for bookings"),
        AIMessage(content="", tool_calls=[
            {"name": "get_email_bookings", "args": {}, "id": "1"}
        ]),
        HumanMessage(content="import it"),
    ]
    # "import it" alone wouldn't match email keywords — but the earlier call
    # to get_email_bookings keeps it active.
    assert "get_email_bookings" in _active_tool_names(msgs, agent._tools)


async def test_search_tools_tool_returns_catalog_matches(agent):
    search_tool = next(t for t in agent._tools if t.name == "search_tools")
    out = await search_tool.ainvoke({"query": "email bookings"})
    assert "get_email_bookings" in out


def test_search_results_widget_includes_normalized_coordinates(agent):
    trip_state = create_default_trip_state()
    search_results = [
        {
            "placeId": "p1",
            "name": "Brandenburg Gate",
            "address": "Pariser Platz, Berlin",
            "rating": 4.7,
            "types": ["tourist_attraction"],
            "coordinates": {"lat": 52.5163, "lon": 13.3777},
        },
        {
            "placeId": "p2",
            "name": "Berlin TV Tower",
            "address": "Panoramastraße, Berlin",
            "rating": 4.4,
            "types": ["point_of_interest"],
            "coordinates": {"lat": 52.5208, "lng": 13.4094},
        },
        {
            "placeId": "p3",
            "name": "Some coord-less place",
            "rating": 4.0,
        },
    ]
    widgets = agent._build_widgets(trip_state, search_results)
    sr = next(w for w in widgets if w["type"] == "search_results")
    places = {p["placeId"]: p for p in sr["data"]["places"]}
    assert places["p1"]["coordinates"] == {"lat": 52.5163, "lng": 13.3777}
    assert places["p2"]["coordinates"] == {"lat": 52.5208, "lng": 13.4094}
    assert places["p3"]["coordinates"] is None


def test_viator_normalize_maps_product_shape():
    from app.services.viator_service import ViatorService

    product = {
        "productCode": "100AA1",
        "title": "Berlin Highlights Walking Tour",
        "images": [{"variants": [{"url": "https://x/s.jpg", "width": 100},
                                 {"url": "https://x/l.jpg", "width": 800}]}],
        "reviews": {"combinedAverageRating": 4.8, "totalReviews": 1320},
        "pricing": {"summary": {"fromPrice": 29.0, "currencyCode": "USD"}},
        "productUrl": "https://www.viator.com/tours/x/100AA1",
    }
    out = ViatorService._normalize(product)
    assert out["productCode"] == "100AA1"
    assert out["imageUrl"] == "https://x/l.jpg"
    assert out["rating"] == 4.8
    assert out["reviewCount"] == 1320
    assert out["fromPrice"] == 29.0
    assert out["currency"] == "USD"


async def test_viator_search_activities_empty_without_key():
    from app.services.viator_service import ViatorService

    svc = ViatorService()
    with patch("app.services.viator_service.settings") as s:
        s.viator_api_key = ""
        assert await svc.search_activities("Brandenburg Gate", "Berlin") == []
