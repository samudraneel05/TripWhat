"""Rate limits and run guards on POST /api/chat."""

import asyncio

import pytest

from app.config import settings
from app.services import run_registry


@pytest.fixture
def fast_stream(monkeypatch):
    """chat_stream stub that completes immediately."""
    from app.agents.travel_agent import travel_agent

    async def chat_stream(*args, **kwargs):
        yield {"type": "complete", "payload": {"response": "ok", "tripState": {}}}

    monkeypatch.setattr(travel_agent, "chat_stream", chat_stream)


async def test_messages_per_minute_limit(client, auth_headers, monkeypatch, fast_stream):
    monkeypatch.setattr(settings, "user_messages_per_minute", 3)
    monkeypatch.setattr(settings, "max_runs_per_user", 10)  # isolate the message limit
    for i in range(3):
        resp = await client.post("/api/chat", json={"message": f"hi {i}"}, headers=auth_headers)
        assert resp.status_code == 200
    resp = await client.post("/api/chat", json={"message": "hi again"}, headers=auth_headers)
    assert resp.status_code == 429
    assert "quickly" in resp.json()["detail"]


async def test_concurrent_runs_per_user(client, auth_headers, monkeypatch):
    from app.agents.travel_agent import travel_agent

    gate = asyncio.Event()
    monkeypatch.setattr(settings, "max_runs_per_user", 1)

    async def chat_stream(*args, **kwargs):
        await gate.wait()
        yield {"type": "complete", "payload": {"response": "ok", "tripState": {}}}

    monkeypatch.setattr(travel_agent, "chat_stream", chat_stream)
    try:
        r1 = await client.post("/api/chat", json={"message": "first"}, headers=auth_headers)
        assert r1.status_code == 200
        await asyncio.sleep(0)  # let the task acquire its slot
        r2 = await client.post("/api/chat", json={"message": "second"}, headers=auth_headers)
        assert r2.status_code == 429
        assert "other requests" in r2.json()["detail"]
    finally:
        gate.set()
        await asyncio.sleep(0)


async def test_same_conversation_409(client, auth_headers, monkeypatch):
    from app.agents.travel_agent import travel_agent

    gate = asyncio.Event()

    async def chat_stream(*args, **kwargs):
        await gate.wait()
        yield {"type": "complete", "payload": {"response": "ok", "tripState": {}}}

    monkeypatch.setattr(travel_agent, "chat_stream", chat_stream)
    try:
        r1 = await client.post("/api/chat", json={"message": "first"}, headers=auth_headers)
        conv = r1.json()["conversationId"]
        await asyncio.sleep(0)
        r2 = await client.post(
            "/api/chat", json={"message": "second", "conversationId": conv}, headers=auth_headers
        )
        assert r2.status_code == 409
    finally:
        gate.set()
        await asyncio.sleep(0)


async def test_run_released_after_stream(client, auth_headers, fast_stream):
    resp = await client.post("/api/chat", json={"message": "hello"}, headers=auth_headers)
    conv = resp.json()["conversationId"]
    for _ in range(50):
        await asyncio.sleep(0.02)
        if not await run_registry.is_active(conv):
            break
    assert not await run_registry.is_active(conv)
    # And a follow-up send on the same conversation is accepted again
    resp2 = await client.post(
        "/api/chat", json={"message": "again", "conversationId": conv}, headers=auth_headers
    )
    assert resp2.status_code == 200


async def test_ready_endpoint(client, monkeypatch):
    from app.services.stream_buffer import stream_buffer

    resp = await client.get("/ready")
    # DB check passes in tests (sqlite override); redis check depends on
    # whether local redis is up — assert only the response shape.
    assert resp.status_code in (200, 503)
    assert "postgres" in resp.json()
    assert "redis" in resp.json()

    async def no_redis():
        raise ConnectionError("down")

    monkeypatch.setattr(stream_buffer, "_get_redis", no_redis)
    resp = await client.get("/ready")
    assert resp.status_code == 503
    assert resp.json()["redis"] is False
