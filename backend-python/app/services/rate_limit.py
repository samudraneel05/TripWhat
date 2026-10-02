"""Fixed-window rate limiter backed by Redis, with an in-process fallback."""

import time

from app.services.stream_buffer import stream_buffer
from app.utils.logger import logger

_memory: dict[str, tuple[int, float]] = {}


async def _redis():
    return await stream_buffer._get_redis()


async def hit(key: str, limit: int, window_s: int) -> bool:
    """Record one attempt for `key`; return True while within `limit` per window."""
    try:
        r = await _redis()
        redis_key = f"ratelimit:{key}"
        count = await r.incr(redis_key)
        if count == 1:
            await r.expire(redis_key, window_s)
        return count <= limit
    except Exception as e:
        logger.warning(f"[RATE_LIMIT] Redis unavailable, using in-memory counter: {e}")

    now = time.monotonic()
    count, reset_at = _memory.get(key, (0, now + window_s))
    if now >= reset_at:
        count, reset_at = 0, now + window_s
    count += 1
    _memory[key] = (count, reset_at)
    return count <= limit
