import httpx
import openai
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import main
from app.agents.travel_agent import travel_agent
from app.models import Conversation
from app.routes import chat


def _rate_limit_error():
    response = httpx.Response(429, request=httpx.Request("POST", "https://api.openai.com/v1/chat"))
    return openai.RateLimitError(
        "Error code: 429 - organization org-SECRET reached its limit", response=response, body=None
    )


def _connection_error():
    return openai.APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/chat"))


@pytest.fixture
async def stream_env(monkeypatch, test_engine):
    factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(chat, "async_session", factory)
    emitted, pushed = [], []

    async def emit(event, data=None, room=None, **kwargs):
        emitted.append((event, data))

    async def push_event(conv_id, kind, payload):
        pushed.append((kind, payload))
        return "1-0"

    async def mark_done(conv_id):
        return None

    monkeypatch.setattr(main.sio, "emit", emit)
    monkeypatch.setattr(chat.stream_buffer, "push_event", push_event)
    monkeypatch.setattr(chat.stream_buffer, "mark_done", mark_done)
    async with factory() as db:
        db.add(Conversation(conversation_id="c1", user_id=1, messages=[{"role": "user", "content": "hi"}]))
        await db.commit()
    return factory, emitted, pushed


def _raising(exc):
    async def chat_stream(*args, **kwargs):
        raise exc
        yield  # pragma: no cover

    return chat_stream


@pytest.mark.asyncio
async def test_rate_limit_error_is_sanitised(monkeypatch, stream_env):
    factory, emitted, pushed = stream_env
    monkeypatch.setattr(travel_agent, "chat_stream", _raising(_rate_limit_error()))

    await chat._process_agent_stream("c1", "hi", {}, 1)

    (event, payload), = emitted
    assert event == "agent:response"
    assert payload["error"] == "rate_limited"
    assert payload["message"] == "TripWhat is a bit busy right now — please try again in a moment."
    assert "org-SECRET" not in str(payload)
    assert "org-SECRET" not in str(pushed)

    async with factory() as db:
        conv = (await db.execute(select(Conversation))).scalar_one()
    last = conv.messages[-1]
    assert last["role"] == "assistant" and last["error"] is True
    assert last["content"] == payload["message"]
    assert "org-SECRET" not in str(conv.messages)


@pytest.mark.asyncio
async def test_connection_error_maps_to_upstream_unavailable(monkeypatch, stream_env):
    _, emitted, _ = stream_env
    monkeypatch.setattr(travel_agent, "chat_stream", _raising(_connection_error()))
    await chat._process_agent_stream("c1", "hi", {}, 1)
    assert emitted[0][1]["error"] == "upstream_unavailable"


@pytest.mark.asyncio
async def test_unknown_error_maps_to_internal(monkeypatch, stream_env):
    _, emitted, _ = stream_env
    monkeypatch.setattr(travel_agent, "chat_stream", _raising(RuntimeError("db password=hunter2")))
    await chat._process_agent_stream("c1", "hi", {}, 1)
    payload = emitted[0][1]
    assert payload["error"] == "internal"
    assert "hunter2" not in str(payload)


def _lc(name):
    from langchain_openai.chat_models import base

    return getattr(base, name)


@pytest.mark.parametrize("make,code", [
    (_rate_limit_error, "rate_limited"),
    (lambda: _lc("ModelRateLimitError")("slow down"), "rate_limited"),
    (_connection_error, "upstream_unavailable"),
    (lambda: openai.APITimeoutError(request=httpx.Request("POST", "https://x")), "upstream_unavailable"),
    (lambda: httpx.ReadTimeout("t"), "upstream_unavailable"),
    (lambda: httpx.ConnectError("c"), "upstream_unavailable"),
    (lambda: _lc("ModelConnectionError")("c"), "upstream_unavailable"),
    (lambda: _lc("ModelTimeoutError")("t"), "upstream_unavailable"),
    (lambda: ValueError("boom"), "internal"),
])
def test_classify_error(make, code):
    assert chat._classify_error(make())[0] == code
