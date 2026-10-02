"""Run ownership registry — cross-process tracking of in-flight agent runs.

Backed by Redis so multiple workers share the same view; falls back to
in-process dicts when Redis is unavailable (tests, degraded mode).

Key patterns:
  run:conv:{conv_id}  — string: user_id owning the run (NX + TTL)
  run:user:{user_id}  — set of conv_ids with active runs
"""

import time

from app.services.stream_buffer import stream_buffer
from app.utils.logger import logger

RUN_TTL = 120  # seconds; refreshed by heartbeat while a run is live

_mem_conv: dict[str, tuple[int, float]] = {}
_mem_user: dict[int, set[str]] = {}


def _mem_prune() -> None:
    now = time.monotonic()
    for conv, (_uid, exp) in list(_mem_conv.items()):
        if now >= exp:
            del _mem_conv[conv]
    _mem_user.clear()
    for conv, (uid, _exp) in _mem_conv.items():
        _mem_user.setdefault(uid, set()).add(conv)


async def _redis():
    return await stream_buffer._get_redis()


async def acquire(conv_id: str, user_id: int) -> bool:
    """Claim a run slot for the conversation. False if one is already running."""
    try:
        r = await _redis()
        ok = await r.set(f"run:conv:{conv_id}", str(user_id), nx=True, ex=RUN_TTL)
        if not ok:
            return False
        user_key = f"run:user:{user_id}"
        await r.sadd(user_key, conv_id)
        await r.expire(user_key, RUN_TTL)
        return True
    except Exception as e:
        logger.warning(f"[RUN_REGISTRY] Redis unavailable, using in-memory registry: {e}")
    _mem_prune()
    if conv_id in _mem_conv:
        return False
    _mem_conv[conv_id] = (user_id, time.monotonic() + RUN_TTL)
    _mem_user.setdefault(user_id, set()).add(conv_id)
    return True


async def heartbeat(conv_id: str, user_id: int) -> None:
    """Refresh TTLs — call periodically while a run is live."""
    try:
        r = await _redis()
        await r.expire(f"run:conv:{conv_id}", RUN_TTL)
        await r.expire(f"run:user:{user_id}", RUN_TTL)
        return
    except Exception:
        pass
    if conv_id in _mem_conv:
        _mem_conv[conv_id] = (user_id, time.monotonic() + RUN_TTL)


async def release(conv_id: str, user_id: int) -> None:
    try:
        r = await _redis()
        await r.delete(f"run:conv:{conv_id}")
        await r.srem(f"run:user:{user_id}", conv_id)
    except Exception:
        pass
    _mem_conv.pop(conv_id, None)
    convs = _mem_user.get(user_id)
    if convs:
        convs.discard(conv_id)


async def is_active(conv_id: str) -> bool:
    try:
        r = await _redis()
        return bool(await r.exists(f"run:conv:{conv_id}"))
    except Exception:
        _mem_prune()
        return conv_id in _mem_conv


async def active_for_user(user_id: int) -> set[str]:
    """Conversation ids with active runs for a user; prunes stale entries."""
    try:
        r = await _redis()
        members = await r.smembers(f"run:user:{user_id}")
        if not members:
            return set()
        pipe = r.pipeline()
        for m in members:
            pipe.exists(f"run:conv:{m}")
        exists = await pipe.execute()
        stale = [m for m, ok in zip(members, exists) if not ok]
        if stale:
            await r.srem(f"run:user:{user_id}", *stale)
        return {m for m, ok in zip(members, exists) if ok}
    except Exception:
        _mem_prune()
        return set(_mem_user.get(user_id, ()))


async def active_count(user_id: int) -> int:
    return len(await active_for_user(user_id))
