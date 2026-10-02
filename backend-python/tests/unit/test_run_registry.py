"""Run registry — in-memory fallback path (conftest disables Redis)."""

import time

from app.services import run_registry


async def test_acquire_is_exclusive_per_conversation():
    assert await run_registry.acquire("conv-1", 1) is True
    assert await run_registry.acquire("conv-1", 2) is False


async def test_acquire_allows_different_conversations():
    assert await run_registry.acquire("conv-1", 1) is True
    assert await run_registry.acquire("conv-2", 1) is True
    assert await run_registry.active_count(1) == 2
    assert await run_registry.active_count(2) == 0


async def test_release_frees_the_slot():
    await run_registry.acquire("conv-1", 1)
    await run_registry.release("conv-1", 1)
    assert await run_registry.is_active("conv-1") is False
    assert await run_registry.acquire("conv-1", 2) is True


async def test_is_active_and_active_for_user():
    assert await run_registry.is_active("nope") is False
    await run_registry.acquire("conv-a", 7)
    await run_registry.acquire("conv-b", 7)
    assert await run_registry.is_active("conv-a") is True
    assert await run_registry.active_for_user(7) == {"conv-a", "conv-b"}


async def test_expired_claim_is_pruned():
    run_registry._mem_conv["stale"] = (1, time.monotonic() - 1)
    run_registry._mem_user[1] = {"stale"}
    assert await run_registry.is_active("stale") is False
    assert await run_registry.active_count(1) == 0
    assert await run_registry.acquire("stale", 2) is True


async def test_heartbeat_refreshes_claim():
    await run_registry.acquire("conv-1", 1)
    run_registry._mem_conv["conv-1"] = (1, time.monotonic() + 5)
    await run_registry.heartbeat("conv-1", 1)
    _uid, exp = run_registry._mem_conv["conv-1"]
    assert exp - time.monotonic() > 60
