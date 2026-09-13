"""Travel agent — LangGraph Python create_agent with InjectedState tools.

LLM-driven flow: the agent reads trip_state via InjectedState and decides
what to ask (via ask_question) or when to build (via plan_trip + build_itinerary).
No fixed slot order, no interrupt-based route confirmation.
"""


import re

from langchain_openai import ChatOpenAI
from langchain.agents import create_agent
from langchain.agents.middleware import (
    ToolErrorMiddleware,
    ModelCallLimitMiddleware,
    SummarizationMiddleware,
    wrap_model_call,
    ModelRequest,
    ModelResponse,
)
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command, Interrupt

from app.agents.prompts import DEEP_AGENT_SYSTEM_PROMPT
from app.agents.state import create_default_trip_state, resolve_build_cities
from app.agents.state_schema import TravelAgentState
from app.agents.tools.plan_tools import plan_trip, ask_question
from app.agents.tools.search_tools import web_search
from app.agents.tools.itinerary_tools import build_itinerary, edit_itinerary
from app.agents.tools.calendar_tools import create_calendar_event
from app.agents.tools.gmail_tools import get_email_bookings, import_email_booking
from app.agents.tools.memory_tools import remember_user_preference
from app.agents.tools.flight_tools import search_flights, book_flight
from app.agents.tools.mcp_tools import (
    mcp_search_places, mcp_resolve_names, mcp_compute_routes, mcp_lookup_weather, mcp_find_nearby,
    init_search_results, get_search_results,
)
from app.services.itinerary_builder import itinerary_builder
from app.services import progress_bus
from app.utils.logger import logger


async def _aon_tool_error(exc: Exception) -> str:
    """Async error handler for ToolErrorMiddleware."""
    return f"Tool error: {type(exc).__name__}. Please try a different approach."


# --- First-step tool forcing helpers -----------------------------------------
# tool_choice="required" on the first model step keeps the model from asking
# planning questions in plain text during onboarding — but applied blindly it
# also forces a pointless tool call for "thanks!" or "what's the weather in
# Paris?". These helpers exempt clearly-non-planning input.

_CHITCHAT_RE = re.compile(
    r"^\W*(hi+|hello|hey|yo|sup|thanks?|thank\s*you|thx|ty|ok(ay)?|k|cool|"
    r"great|nice|perfect|awesome|amazing|sure|yes|yeah|yep|nope?|bye|"
    r"good\s*bye|sounds\s+good|got\s+it|never\s*mind|lol|haha)\W*$",
    re.IGNORECASE,
)
_PLANNING_HINT_RE = re.compile(
    r"\b(trips?|travels?|travel(?:ing|ling)|vacations?|holidays?|itinerar\w*|"
    r"plan(?:ning|ned)?s?|visit(?:ing)?|fly(?:ing)?|flights?|hotels?|weekend|"
    r"getaway|honeymoon|road\s?trips?|backpack\w*|cruise|destinations?|"
    r"sightseeing|beach(?:es)?|days?\s+in|weeks?\s+in|nights?\s+in)\b",
    re.IGNORECASE,
)


def _requires_tool_call(text: str) -> bool:
    """Whether a fresh user turn should force a tool call.

    Keeps forcing for anything that could be trip planning (including answers
    to our own questions typed as free text); skips it for greetings/acks and
    for pure questions with no planning vocabulary.
    """
    t = (text or "").strip()
    if not t:
        return False
    if _CHITCHAT_RE.match(t):
        return False
    if "?" in t and not _PLANNING_HINT_RE.search(t):
        return False
    return True


def _message_text(msg) -> str:
    content = getattr(msg, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            b.get("text", "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return str(content)


def _is_interrupt_error(err) -> bool:
    """True when a tool-call error slot actually holds pending Interrupts.

    On an interrupted run, `call.error` carries the tuple of Interrupt objects
    raised inside the tool — not a real failure.
    """
    if err is None:
        return False
    items = err if isinstance(err, (list, tuple)) else (err,)
    return any(isinstance(e, Interrupt) or type(e).__name__ == "Interrupt" for e in items)


def _interrupt_to_widget(intr) -> dict | None:
    """Convert a pending LangGraph Interrupt into a question_card widget.

    ask_question passes the raw card payload ({question, options, ...}) as the
    interrupt value; the frontend widget shape wraps it as {type, data}.
    """
    payload = getattr(intr, "value", intr)
    if isinstance(payload, dict):
        if payload.get("type") == "question_card":
            return payload
        if payload.get("question"):
            return {"type": "question_card", "data": payload}
    return None


class TravelAgent:
    """LangGraph-based travel agent with proper state persistence."""

    def __init__(self):
        self.model_name = "gpt-4o-mini"
        self.checkpointer = MemorySaver()
        self.store = None
        self._agent = None
        self._tools = [
            plan_trip,
            ask_question,
            web_search,
            build_itinerary,
            edit_itinerary,
            create_calendar_event,
            get_email_bookings,
            import_email_booking,
            search_flights,
            book_flight,
            remember_user_preference,
            mcp_search_places,
            mcp_resolve_names,
            mcp_compute_routes,
            mcp_lookup_weather,
            mcp_find_nearby,
        ]

    def set_persistence(self, checkpointer, store) -> None:
        """Wire in persistent checkpointer/store (called once from app lifespan)."""
        self.checkpointer = checkpointer
        self.store = store
        self._agent = None  # force agent rebuild with new persistence

    def _build_middleware(self) -> list:
        """Build the middleware stack for the agent."""
        onboarding_model = ChatOpenAI(model="gpt-4o", temperature=0.7)
        post_onboarding_model = ChatOpenAI(model=self.model_name, temperature=0.7)

        @wrap_model_call
        async def dynamic_model_selection(request: ModelRequest, handler) -> ModelResponse:
            """Route to the appropriate model + inject prefs + force tool calls.

            - Use gpt-4o when no itinerary exists yet (stronger reasoning for
              parsing and flow decisions). Use gpt-4o-mini once the itinerary
              is built (cost-optimized for editing/chat).
            - Append the user's prefs/memories to the system message via
              request.override(system_message=...). The data arrives per-call
              through astream_events(context=...) → request.runtime.context,
              so it's always fresh and never persisted into checkpointed
              message history.
            - Force tool_choice="required" on the first LLM step of each turn
              while onboarding (no itinerary) AND the input looks like
              planning — this prevents the model from asking planning
              questions in plain text. Clearly non-planning input
              (greetings, info questions) is exempt so the model can simply
              answer. After the first tool call, the model can respond in
              text naturally.
            """
            trip_state = request.state.get("trip_state") or {}
            has_itinerary = bool(trip_state.get("itinerary"))

            model = onboarding_model if not has_itinerary else post_onboarding_model
            overrides: dict = {"model": model}

            # --- Per-call prefs/memories via system_message override ---
            run_ctx = getattr(request.runtime, "context", None) or {}
            if isinstance(run_ctx, dict):
                prefs_text = self._build_preferences_context(
                    run_ctx.get("userPreferences"), run_ctx.get("userMemories")
                )
            else:
                prefs_text = self._build_preferences_context(
                    getattr(run_ctx, "userPreferences", None),
                    getattr(run_ctx, "userMemories", None),
                )
            if prefs_text:
                base_msg = request.system_message
                base_text = base_msg.text if base_msg is not None else ""
                overrides["system_message"] = SystemMessage(
                    content=f"{base_text}\n\n{prefs_text}" if base_text else prefs_text
                )

            if not has_itinerary:
                # Onboarding mode — force tool calls on the first LLM step
                # (latest message is a HumanMessage) unless the input is
                # clearly not planning (chitchat, info questions).
                msgs = request.messages
                is_first_step = (
                    len(msgs) > 0
                    and isinstance(msgs[-1], HumanMessage)
                )

                if is_first_step and _requires_tool_call(_message_text(msgs[-1])):
                    # OpenAI uses "required" to force a tool call.
                    # LangChain's "any" should map to this, but we use
                    # "required" directly to be safe.
                    overrides["tool_choice"] = "required"
                    overrides["model_settings"] = {"parallel_tool_calls": False}
                    logger.info("[MIDDLEWARE] Forcing tool_choice=required (onboarding, first step)")

            return await handler(request.override(**overrides))

        return [
            # Bounds checkpointed message history: summarize when the
            # conversation gets long, keeping the most recent messages.
            SummarizationMiddleware(
                model=ChatOpenAI(model=self.model_name, temperature=0),
                trigger=[("tokens", 8000), ("messages", 40)],
                keep=("messages", 20),
            ),
            dynamic_model_selection,
            ToolErrorMiddleware(aon_error=lambda exc, request: _aon_tool_error(exc)),
            ModelCallLimitMiddleware(run_limit=10),
        ]

    @property
    def agent(self):
        if self._agent is None:
            self._agent = create_agent(
                model=ChatOpenAI(model=self.model_name, temperature=0.7),
                tools=self._tools,
                system_prompt=DEEP_AGENT_SYSTEM_PROMPT,
                state_schema=TravelAgentState,
                middleware=self._build_middleware(),
                checkpointer=self.checkpointer,
                store=self.store,
            )
        return self._agent

    # ------------------------------------------------------------------
    # Tool activity helpers — produce human-readable labels and result
    # summaries for the frontend's tool activity bar.
    # ------------------------------------------------------------------

    _TOOL_LABELS: dict[str, str] = {
        "plan_trip": "Planning your trip",
        "ask_question": "Preparing a question",
        "web_search": "Searching the web",
        "build_itinerary": "Building itinerary",
        "edit_itinerary": "Editing itinerary",
        "create_calendar_event": "Adding calendar event",
        "get_email_bookings": "Searching Gmail for bookings",
        "import_email_booking": "Importing email booking",
        "remember_user_preference": "Saving your preference",
        "mcp_search_places": "Searching places",
        "mcp_resolve_names": "Resolving place names",
        "mcp_compute_routes": "Computing routes",
        "mcp_lookup_weather": "Checking weather",
        "mcp_find_nearby": "Finding nearby places",
    }

    @classmethod
    def _tool_label(cls, tool_name: str, tool_input: dict | None) -> str:
        """Generate a dynamic, human-readable label for a tool call."""
        base = cls._TOOL_LABELS.get(tool_name, tool_name.replace("_", " ").title())
        if not tool_input:
            return base

        # Enrich with input context for the most user-facing tools
        if tool_name == "mcp_search_places":
            query = tool_input.get("text_query") or tool_input.get("query") or ""
            city = tool_input.get("city") or tool_input.get("location") or ""
            parts = [p for p in [query, city] if p]
            return f"Searching {': '.join(parts)}" if parts else base
        elif tool_name == "mcp_find_nearby":
            place = tool_input.get("place_name") or tool_input.get("place_id") or ""
            kind = tool_input.get("place_type") or tool_input.get("type") or "places"
            return f"Finding {kind} near {place}" if place else base
        elif tool_name == "mcp_compute_routes":
            origin = tool_input.get("origin") or ""
            dest = tool_input.get("destination") or ""
            if origin and dest:
                return f"Computing route: {origin} → {dest}"
            return base
        elif tool_name == "mcp_lookup_weather":
            city = tool_input.get("city") or tool_input.get("location") or ""
            return f"Checking weather in {city}" if city else base
        elif tool_name == "web_search":
            query = tool_input.get("query") or ""
            return f"Searching the web: {query}" if query else base
        elif tool_name == "plan_trip":
            dest = tool_input.get("destination") or ""
            if isinstance(dest, list):
                dest = ", ".join(str(d) for d in dest)
            return f"Planning trip to {dest}" if dest else base
        elif tool_name == "build_itinerary":
            city = tool_input.get("city") or ""
            return f"Building itinerary for {city}" if city else base
        return base

    @staticmethod
    def _tool_result_summary(tool_name: str, tool_input: dict | None, output: any) -> str:
        """Generate a short summary of a tool's result for the collapsed bar."""
        if output is None:
            return ""

        # Tool outputs can be strings (most tools), dicts (some MCP tools),
        # or message-like objects (ToolMessage) with a .content attribute —
        # which may itself be a list of content blocks (dicts like
        # {"type": "text", "text": "..."} or objects with a .text attr).
        # Extract the text instead of falling back to str(), which leaks
        # reprs like "{'text': ...}" or "content=[TextContent(...)]".
        raw = getattr(output, "content", output)
        if isinstance(raw, dict) and isinstance(raw.get("text"), str):
            raw = raw["text"]
        if isinstance(raw, list):
            parts: list[str] = []
            for b in raw:
                if isinstance(b, str):
                    parts.append(b)
                elif isinstance(b, dict) and isinstance(b.get("text"), str):
                    parts.append(b["text"])
                else:
                    block_text = getattr(b, "text", None)
                    if isinstance(block_text, str):
                        parts.append(block_text)
            raw = " ".join(p for p in parts if p)

        if isinstance(raw, str):
            text = raw.strip()
        elif isinstance(raw, dict):
            # MCP search tools may return a dict with 'places' or 'results'
            if "places" in raw:
                count = len(raw["places"]) if isinstance(raw["places"], list) else 0
                return f"{count} places found"
            if "results" in raw:
                count = len(raw["results"]) if isinstance(raw["results"], list) else 0
                return f"{count} results found"
            if "routes" in raw:
                count = len(raw["routes"]) if isinstance(raw["routes"], list) else 0
                return f"{count} routes found"
            text = str(raw)
        elif isinstance(raw, (int, float, bool)):
            text = str(raw)
        else:
            # Unrecognized object (Command, ToolMessage w/o text, etc.) — a
            # repr like "Command(update={'trip_state': ...})" is never a
            # useful summary. Show nothing rather than leaking it.
            return ""

        # Clean for one-line display: collapse newlines/extra whitespace and
        # drop markdown emphasis markers that would render literally.
        text = re.sub(r"\s+", " ", text).replace("**", "").replace("__", "").strip()

        # Try to extract a count from string output
        if "found" in text.lower():
            # e.g. "Found 10 hotels" → use as-is
            return text[:80]
        # Truncate long outputs
        return text[:80] + ("…" if len(text) > 80 else "")

    async def chat_stream(self, message: str, conversation_id: str, context: dict | None = None):
        """Stream agent responses token-by-token, yielding structured events.

        Yields dicts with "type" key:
          - {"type": "token", "text": "..."} — LLM token delta
          - {"type": "status", "status": "..."} — progress update
          - {"type": "widget", "widget": {...}} — widget to render (e.g., question_card)
          - {"type": "tripState", "tripState": {...}} — partial state update
          - {"type": "complete", "payload": {...}} — final result

        HITL: ask_question suspends the run via langgraph.types.interrupt().
        A pending interrupt in the checkpoint means `message` is the user's
        answer — we resume the run with Command(resume=message) instead of
        starting a new one.
        """
        context = context or {}
        trip_state = context.get("tripState")

        logger.info(f"[AGENT_STREAM] Processing: {message!r} (conv={conversation_id})")

        final_trip_state = trip_state or create_default_trip_state()
        response_text = ""
        pending_widget = None

        # Reset the search results buffer
        init_search_results()

        config = {
            "configurable": {"thread_id": conversation_id, "user_id": context.get("userId")},
            "metadata": {
                "conversation_id": conversation_id,
                "user_id": context.get("userId", ""),
                "app": "tripwhat",
            },
        }
        # Runtime context for middleware — user prefs/memories are appended to
        # the system prompt per model call (see dynamic_model_selection), so
        # they stay fresh and are never persisted into checkpointed history.
        runtime_context = {
            "userPreferences": context.get("userPreferences") or {},
            "userMemories": context.get("userMemories") or [],
        }

        # The Postgres checkpointer is the multi-turn source of truth for
        # trip_state. Re-injecting the persisted conversation.trip_state
        # wholesale would overwrite live checkpoint keys via the right-wins
        # merge reducer (e.g. a stale cities=[] clobbering cities plan_trip
        # just wrote — that emptied cities mid-flow once and crashed
        # _build_widgets). Instead, seed ONLY keys the checkpoint lacks a
        # meaningful value for (covers first turn / checkpoint reset / keys
        # written externally, e.g. imported bookings).
        #
        # This state read ALSO detects a pending interrupt: if ask_question
        # suspended the previous turn, the checkpoint holds the interrupt and
        # this message is the user's answer → resume instead of a new run.
        prior_ts: dict = {}
        pending_interrupts: list = []
        try:
            existing_state = await self.agent.aget_state(config)
            prior_ts = (existing_state.values or {}).get("trip_state") or {}
            seen_ids: set = set()
            candidates = list(getattr(existing_state, "interrupts", None) or ())
            for task in getattr(existing_state, "tasks", None) or ():
                candidates.extend(getattr(task, "interrupts", None) or ())
            for intr in candidates:
                iid = getattr(intr, "id", id(intr))
                if iid not in seen_ids:
                    seen_ids.add(iid)
                    pending_interrupts.append(intr)
        except Exception:
            pass

        if pending_interrupts:
            # Resume the suspended run: the user's message becomes the return
            # value of the interrupt() call inside ask_question (surfaced to
            # the model as its ToolMessage). Do NOT inject a HumanMessage here —
            # it would land between the AI tool_call message and its ToolMessage,
            # which the OpenAI API rejects.
            graph_input = Command(resume=message)
            logger.info(f"[AGENT_STREAM] Resuming pending interrupt (conv={conversation_id})")
        else:
            clean_trip_state: dict = {}
            for k, v in (final_trip_state or {}).items():
                # _pendingWidget is a legacy key from the pre-interrupt design —
                # never seed it; the checkpoint's pending interrupt is the state.
                if k == "_pendingWidget":
                    continue
                if v not in (None, [], {}, "") and not prior_ts.get(k):
                    clean_trip_state[k] = v
            graph_input = {
                "messages": [{"role": "user", "content": message}],
                "trip_state": clean_trip_state,
            }

        # Progress bus — lets tool code (e.g. itinerary_builder running inside
        # build_itinerary) push progress events that are merged into the yield
        # loop below. get_stream_writer events are unreliable for async tools
        # under astream_events(v3), so we use a plain queue instead.
        bus_queue = progress_bus.register(conversation_id)

        try:
            stream = await self.agent.astream_events(
                graph_input,
                config=config,
                context=runtime_context,
                version="v3",
                durability="async",
            )

            # Consume messages and tool_calls concurrently.
            # We use a queue so the generator can yield events from both
            # projections in the order they arrive.
            import asyncio as _aio
            event_queue: _aio.Queue = _aio.Queue()

            async def _consume_messages():
                """Consume LLM token deltas from stream.messages."""
                try:
                    async for message_event in stream.messages:
                        if message_event.node != "model":
                            async for _ in message_event.text:
                                pass
                            continue
                        async for delta in message_event.text:
                            if delta:
                                await event_queue.put({"type": "token", "text": delta})
                except Exception as e:
                    await event_queue.put({"type": "_error", "error": e})

            async def _consume_tool_calls():
                """Consume tool execution lifecycle from stream.tool_calls."""
                try:
                    async for call in stream.tool_calls:
                        label = self._tool_label(call.tool_name, call.input if isinstance(call.input, dict) else None)
                        await event_queue.put({
                            "type": "tool_start",
                            "tool_name": call.tool_name,
                            "label": label,
                            "call_id": getattr(call, "call_id", None) or getattr(call, "id", None) or "",
                            "input": call.input if isinstance(call.input, dict) else None,
                        })
                        # Consume output deltas (we don't stream these to the
                        # frontend, but we must drain them to drive the
                        # projection forward)
                        async for _ in call.output_deltas:
                            pass
                        # Get final output and error
                        output = None
                        error = None
                        summary = None
                        try:
                            output = call.output
                        except Exception as e:
                            error = str(e)
                        call_error = getattr(call, "error", None)
                        if not error and call_error:
                            if _is_interrupt_error(call_error):
                                # The tool suspended on an interrupt() — not a
                                # failure; mark the activity row done.
                                summary = "Waiting for your answer"
                            else:
                                error = str(call_error)
                        if summary is None:
                            summary = self._tool_result_summary(
                                call.tool_name,
                                call.input if isinstance(call.input, dict) else None,
                                output,
                            )
                        await event_queue.put({
                            "type": "tool_end",
                            "tool_name": call.tool_name,
                            "label": label,
                            "call_id": getattr(call, "call_id", None) or getattr(call, "id", None) or "",
                            "summary": summary,
                            "error": error,
                        })
                except Exception as e:
                    await event_queue.put({"type": "_error", "error": e})

            async def _consume_progress_bus():
                """Forward tool-emitted progress events into the main queue."""
                while True:
                    bus_event = await bus_queue.get()
                    if not isinstance(bus_event, dict) or bus_event.get("type") == "_bus_stop":
                        return
                    await event_queue.put(bus_event)

            # Run both consumers concurrently; we collect into a done flag.
            # The progress-bus forwarder runs until we push the stop sentinel.
            consumers = _aio.gather(_consume_messages(), _consume_tool_calls())
            bus_consumer = _aio.create_task(_consume_progress_bus())

            async with stream:
                try:
                    # Yield events from the queue as they arrive
                    while True:
                        try:
                            event = await _aio.wait_for(event_queue.get(), timeout=0.1)
                        except _aio.TimeoutError:
                            # Check if both consumers are done
                            if consumers.done():
                                # Drain any remaining events
                                while not event_queue.empty():
                                    event = event_queue.get_nowait()
                                    if event.get("type") == "_error":
                                        raise event["error"]
                                    if event["type"] == "token":
                                        response_text += event["text"]
                                    yield event
                                break
                            continue
                        if event.get("type") == "_error":
                            raise event["error"]
                        if event["type"] == "token":
                            response_text += event["text"]
                        yield event

                    # Await the gather to surface any exceptions
                    await consumers
                finally:
                    # Stop the progress-bus forwarder on ALL exit paths —
                    # normal completion, errors and early generator close.
                    bus_queue.put_nowait(progress_bus.STOP_EVENT)
                    try:
                        await _aio.wait_for(bus_consumer, timeout=1.0)
                    except Exception:
                        bus_consumer.cancel()

                # Drain anything left behind
                while not event_queue.empty():
                    event = event_queue.get_nowait()
                    if event.get("type") == "_error":
                        raise event["error"]
                    if event["type"] == "token":
                        response_text += event["text"]
                    yield event
                while not bus_queue.empty():
                    bus_event = bus_queue.get_nowait()
                    if isinstance(bus_event, dict) and bus_event.get("type") != "_bus_stop":
                        yield bus_event

                # A suspended run ends with a pending interrupt — surface the
                # ask_question payload as the question_card widget (same shape
                # the old _pendingWidget channel produced, so the frontend is
                # unchanged).
                try:
                    for intr in await stream.interrupts():
                        pending_widget = _interrupt_to_widget(intr)
                        if pending_widget:
                            break
                except Exception:
                    pending_widget = None
                if pending_widget:
                    yield {"type": "widget", "widget": pending_widget}

                # Read the authoritative final state from the checkpointer —
                # stream.output() reflects the last step's output, which can lag
                # the merged channel state (tool Command updates). aget_state
                # returns the persisted checkpoint values.
                try:
                    final_snapshot = await self.agent.aget_state(config)
                    updated_trip_state = (final_snapshot.values or {}).get("trip_state")
                except Exception:
                    updated_trip_state = None
                if not updated_trip_state:
                    final_output = await stream.output()
                    if final_output and isinstance(final_output, dict):
                        updated_trip_state = final_output.get("trip_state")
                if updated_trip_state:
                    final_trip_state = updated_trip_state

        except Exception as e:
            # No ainvoke retry: re-running would re-append the user message to
            # the checkpointed messages channel and re-pass a stale trip_state
            # that clobbers live checkpoint keys. Propagate — _process_agent_stream
            # emits a complete-with-error agent:response upstream.
            logger.error(f"[AGENT_STREAM] Streaming failed: {e}")
            raise
        finally:
            progress_bus.unregister(conversation_id)

        if not response_text and not pending_widget:
            response_text = "I apologize, but I had trouble processing your request."

        # Auto-build itinerary when plan_trip has set a route but no itinerary yet.
        # Skip when a question is pending — the turn ends awaiting the user's
        # answer; building now would stall the question card behind the build
        # and produce an itinerary for input the user hasn't confirmed.
        if final_trip_state.get("routeProposal") and not final_trip_state.get("itinerary") and not pending_widget:
            yield {"type": "status", "status": "Building your itinerary..."}

            import asyncio as _aio
            status_queue: _aio.Queue = _aio.Queue()
            _build_call_counter = [0]

            async def _build_status_cb(update: dict):
                # Shared translator handles both the lifecycle contract
                # (state:"start"/"end" + task_id + group — parallel tasks show
                # as running) and legacy phase-only updates (paired
                # tool_start/tool_end emitted immediately).
                for event in progress_bus.builder_update_events(update, _build_call_counter):
                    await status_queue.put(event)

            build_task = _aio.create_task(
                self._auto_build_itinerary(
                    final_trip_state,
                    status_cb=_build_status_cb,
                    user_memories=context.get("userMemories"),
                    traveler_type=self._traveler_type(final_trip_state),
                    user_interests=context.get("userInterests"),
                )
            )
            while not build_task.done():
                try:
                    event = await _aio.wait_for(status_queue.get(), timeout=0.5)
                    yield event
                except _aio.TimeoutError:
                    pass
            while not status_queue.empty():
                yield await status_queue.get()
            final_trip_state = await build_task
            if final_trip_state.get("itinerary"):
                response_text = "I've put together your itinerary! Check it out on the right — you can ask me to adjust anything."
            yield {"type": "tripState", "tripState": final_trip_state}

        itinerary = None
        if final_trip_state and final_trip_state.get("itinerary"):
            itinerary = final_trip_state["itinerary"]

        search_results = get_search_results()
        # Emit the itinerary summary only on the turn the itinerary was built
        # or changed — otherwise every unrelated chat turn re-attaches the card.
        itinerary_changed = itinerary is not None and itinerary != prior_ts.get("itinerary")
        widgets = self._build_widgets(final_trip_state, search_results, include_itinerary=itinerary_changed)
        # Include the pending question widget in the complete payload so the
        # frontend can know this turn called ask_question (and not clear
        # activeWidget). The agent:widget event already fired above, but
        # including it here lets processResponse make the right decision.
        if pending_widget:
            widgets = [pending_widget] + widgets
        suggestions = self._build_suggestions(final_trip_state)

        yield {
            "type": "complete",
            "payload": {
                "response": response_text,
                "tripState": final_trip_state,
                "itinerary": itinerary,
                "widgets": widgets,
                "suggestions": suggestions,
                "classification": None,
                "changeSummary": [],
            },
        }

    def _build_preferences_context(self, preferences: dict | None, memories: list[str] | None) -> str:
        """Build a system context string with the user's long-term profile/preferences."""
        parts = []
        if preferences:
            pref_strs = [f"{k}: {v}" for k, v in preferences.items() if v]
            if pref_strs:
                parts.append("User profile preferences: " + "; ".join(pref_strs))
        if memories:
            parts.append("Remembered user preferences (from past trips):")
            parts.extend(f"  - {m}" for m in memories)
        if not parts:
            return ""
        parts.append("Use these to personalize recommendations. When the user reveals a new "
                     "durable preference, save it with remember_user_preference.")
        return "\n".join(parts)

    @staticmethod
    def _destination_name(trip_state: dict) -> str:
        """Best-effort destination label for widgets — cities first, then
        routeProposal, then the itinerary's first day city."""
        cities = trip_state.get("cities") or []
        if cities:
            return cities[0].get("name", "")
        rp_cities = (trip_state.get("routeProposal") or {}).get("cities") or []
        if rp_cities:
            return rp_cities[0].get("name", "")
        days = (trip_state.get("itinerary") or {}).get("days") or []
        if days:
            return days[0].get("city", "")
        return ""

    def _build_widgets(self, trip_state: dict | None, search_results: list | None = None, include_itinerary: bool = True) -> list[dict]:
        """Build UI widgets based on current state.

        `include_itinerary=False` suppresses the itinerary_summary + flight
        widgets — callers pass it when the itinerary didn't change this turn,
        so unrelated chat turns don't re-emit the card.
        """
        widgets = []
        trip_state = trip_state or {}

        # Show itinerary summary widget when the itinerary was built or changed
        itinerary = trip_state.get("itinerary")
        if itinerary and include_itinerary:
            hotels = itinerary.get("hotelRecommendations", [])
            best_hotel = hotels[0] if hotels else None

            # Collect top attractions with photos from the itinerary days
            attractions = []
            seen_names = set()
            for day in itinerary.get("days", []):
                for slot in day.get("timeSlots", []):
                    for act in slot.get("activities", [slot.get("activity")]):
                        if not act:
                            continue
                        name = act.get("name", "")
                        img = act.get("imageUrl") or (act.get("photos") or [None])[0]
                        if name and img and name not in seen_names:
                            seen_names.add(name)
                            attractions.append({
                                "name": name,
                                "imageUrl": img,
                                "type": act.get("type", ""),
                                "placeId": act.get("placeId", ""),
                                "rating": act.get("rating"),
                            })
                        if len(attractions) >= 6:
                            break
                    if len(attractions) >= 6:
                        break
                if len(attractions) >= 6:
                    break

            widgets.append({
                "type": "itinerary_summary",
                "data": {
                    "hotel": {
                        "name": best_hotel.get("name", ""),
                        "imageUrl": best_hotel.get("imageUrl", ""),
                        "images": best_hotel.get("images", []),
                        "rating": best_hotel.get("rating"),
                        "ratePerNight": best_hotel.get("ratePerNight"),
                        "totalRate": best_hotel.get("totalRate"),
                        "currency": best_hotel.get("currency", "USD"),
                        "whyPicked": best_hotel.get("whyPicked", ""),
                        "bookingLink": best_hotel.get("bookingLink", ""),
                        "placeId": best_hotel.get("placeId", ""),
                        "address": best_hotel.get("address", ""),
                    } if best_hotel else None,
                    "attractions": attractions,
                    "destination": self._destination_name(trip_state),
                    "duration": trip_state.get("duration", 0),
                    "dates": trip_state.get("dates", {}),
                    "preferences": trip_state.get("preferences", []),
                    "highlights": [
                        h for day in itinerary.get("days", [])[:4]
                        for h in (day.get("highlights") or [])[:2]
                    ][:6],
                },
            })

            # Emit flight cards as separate widgets for inline chat rendering
            flights = itinerary.get("flightOptions", [])
            if flights:
                for flight in flights[:2]:  # top 2 flights
                    widgets.append({
                        "type": "flight_card",
                        "data": flight,
                    })

        # Show search results widget when places were found via mcp_search_places
        # but no itinerary was built (i.e., search/recommendation turns).
        if search_results and not trip_state.get("itinerary"):
            places = []
            seen_ids = set()
            for p in search_results:
                pid = p.get("placeId") or p.get("id") or ""
                name = p.get("name", "")
                if not name or pid in seen_ids:
                    continue
                seen_ids.add(pid)
                places.append({
                    "name": name,
                    "placeId": pid,
                    "imageUrl": p.get("photo_url") or p.get("imageUrl") or "",
                    "rating": p.get("rating"),
                    "type": ", ".join((p.get("types") or [])[:2]),
                    "address": p.get("address", ""),
                })
                if len(places) >= 8:
                    break
            if places:
                widgets.append({
                    "type": "search_results",
                    "data": {"places": places},
                })

        return widgets

    @staticmethod
    def _traveler_type(trip_state: dict) -> str | None:
        """Derive a traveler-type label from trip_state.travelers.

        plan_trip writes travelers as a dict ({"adults": N, "children": M});
        map it to the query-generator vocabulary (solo/couple/family/group).
        Accepts a legacy plain string too.
        """
        t = (trip_state or {}).get("travelers")
        if isinstance(t, str):
            return t or None
        if isinstance(t, dict):
            adults = t.get("adults") or 1
            children = t.get("children") or 0
            if children:
                return "family"
            if adults >= 3:
                return "group"
            if adults == 2:
                return "couple"
            return "solo"
        return None

    async def _auto_build_itinerary(self, trip_state: dict, status_cb=None, user_memories=None, traveler_type=None, user_interests=None) -> dict:
        """Auto-build itinerary directly using the itinerary builder service."""
        build_cities = resolve_build_cities(trip_state)
        if not build_cities:
            return trip_state

        total_days = sum(c["days"] for c in build_cities)
        ctx = {
            "destination": build_cities[0]["name"],
            "duration": total_days,
            "cities": build_cities,
            "totalDays": total_days,
            "travelType": trip_state.get("pace", "moderate"),
            "numberOfPeople": (trip_state.get("travelers") if isinstance(trip_state.get("travelers"), dict) else {}).get("adults", 1),
            "preferences": trip_state.get("preferences", []),
            "tripStyle": trip_state.get("tripStyle", "balanced"),
            "helpWith": trip_state.get("helpWith", []),
        }

        if user_memories:
            ctx["userMemories"] = user_memories
        if traveler_type:
            ctx["travelerType"] = traveler_type
        if user_interests:
            ctx["userInterests"] = user_interests

        start_location = trip_state.get("startLocation")
        if start_location:
            ctx["startLocation"] = start_location

        dates = trip_state.get("dates")
        if dates and dates.get("start"):
            ctx["startDate"] = dates["start"]

        travel_mode = trip_state.get("travelMode")
        if travel_mode:
            ctx["travelMode"] = travel_mode

        try:
            result = await itinerary_builder.build(ctx, status_cb=status_cb)
            if result and result.get("itinerary"):
                trip_state = dict(trip_state)
                trip_state["itinerary"] = result["itinerary"]
                logger.info(f"[AUTO_ITINERARY] Built {len(result['itinerary'].get('days', []))} days")
        except Exception as e:
            logger.error(f"[AUTO_ITINERARY] Failed: {e}")

        return trip_state

    def _build_suggestions(self, trip_state: dict | None) -> list[str]:
        """Build suggestion chips based on current state."""
        if not trip_state:
            return ["Plan a 5-day Japan trip", "Weekend in Paris", "Beach vacation in Bali"]

        if not trip_state.get("routeProposal"):
            return ["Plan a route", "Tell me more about these cities"]

        if trip_state.get("routeProposal") and not trip_state.get("itinerary"):
            return ["Build the itinerary", "I want to change the route"]

        if trip_state.get("itinerary"):
            return ["Add an activity", "Remove a day", "Tell me about the food scene"]

        return []


travel_agent = TravelAgent()
