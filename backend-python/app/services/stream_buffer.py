"""Redis stream buffer — decouples stream production from Socket.IO delivery.

Writes every agent event to a Redis stream keyed by conversation ID so that
disconnected clients can replay missed events on reconnect.

Key patterns:
  stream:{conv_id}         — Redis Stream of buffered events (TTL: 1h)
  active:{conv_id}         — String key: "streaming" while agent is running (TTL: 1h)
"""

import json
from datetime import datetime, timezone

import redis.asyncio as aioredis

from app.config import settings
from app.utils.logger import logger

STREAM_TTL = 3600  # 1 hour


class StreamBuffer:
    def __init__(self):
        self._redis: aioredis.Redis | None = None

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        return self._redis

    async def close(self):
        if self._redis:
            await self._redis.close()
            self._redis = None

    # --- Stream key helpers ---

    @staticmethod
    def _stream_key(conv_id: str) -> str:
        return f"stream:{conv_id}"

    @staticmethod
    def _active_key(conv_id: str) -> str:
        return f"active:{conv_id}"

    # --- Write operations ---

    async def mark_active(self, conv_id: str):
        """Mark a conversation as having an active stream."""
        try:
            r = await self._get_redis()
            await r.set(self._active_key(conv_id), "streaming", ex=STREAM_TTL)
        except Exception as e:
            logger.warning(f"[STREAM_BUFFER] mark_active failed for {conv_id}: {e}")

    async def mark_done(self, conv_id: str):
        """Mark a conversation's stream as complete."""
        try:
            r = await self._get_redis()
            await r.delete(self._active_key(conv_id))
        except Exception as e:
            logger.warning(f"[STREAM_BUFFER] mark_done failed for {conv_id}: {e}")

    async def is_active(self, conv_id: str) -> bool:
        """Check if a conversation has an active stream. Returns False on
        Redis failure — the in-process task registry is authoritative anyway."""
        try:
            r = await self._get_redis()
            val = await r.get(self._active_key(conv_id))
            return val == "streaming"
        except Exception as e:
            logger.warning(f"[STREAM_BUFFER] is_active failed for {conv_id}: {e}")
            return False

    async def clear_all_active(self) -> int:
        """Delete every active:* flag — used at startup, where no run can
        legitimately be live (in-process tasks die with the process)."""
        try:
            r = await self._get_redis()
            keys = [k async for k in r.scan_iter("active:*")]
            if keys:
                return await r.delete(*keys)
            return 0
        except Exception as e:
            logger.warning(f"[STREAM_BUFFER] clear_all_active failed: {e}")
            return 0

    async def push_event(self, conv_id: str, event_type: str, data: dict) -> str | None:
        """Append an event to the Redis stream. Returns the entry ID or None on failure.

        Each entry stores: {type, data(JSON), timestamp}.
        """
        try:
            r = await self._get_redis()
            entry = {
                "type": event_type,
                "data": json.dumps(data, default=str),
                "ts": datetime.now(timezone.utc).isoformat(),
            }
            entry_id = await r.xadd(self._stream_key(conv_id), entry)
            await r.expire(self._stream_key(conv_id), STREAM_TTL)
            return entry_id
        except Exception as e:
            logger.warning(f"[STREAM_BUFFER] Failed to push event for {conv_id}: {e}")
            return None

    # --- Read operations ---

    # Safety cap on total events returned by one replay call.
    MAX_REPLAY_EVENTS = 2000

    async def read_events(self, conv_id: str, after_id: str = "0", count: int = 500) -> list[dict]:
        """Read events from the stream after a given entry ID.

        Returns list of {id, type, data, timestamp}.
        Use after_id="0" to get all events.

        Paginates internally — a single xread is capped at `count` entries,
        but streams accumulate hundreds of token events per turn, so we keep
        reading until the stream is exhausted (or MAX_REPLAY_EVENTS hit).
        """
        try:
            r = await self._get_redis()
            events: list[dict] = []
            last_id = after_id
            while len(events) < self.MAX_REPLAY_EVENTS:
                entries = await r.xread(
                    {self._stream_key(conv_id): last_id}, count=count
                )
                batch = []
                for _stream_key, stream_entries in entries:
                    for entry_id, fields in stream_entries:
                        batch.append({
                            "id": entry_id,
                            "type": fields.get("type", ""),
                            "data": json.loads(fields.get("data", "{}")),
                            "timestamp": fields.get("ts", ""),
                        })
                if not batch:
                    break
                events.extend(batch)
                last_id = batch[-1]["id"]
                if len(batch) < count:
                    break  # stream exhausted
            return events[: self.MAX_REPLAY_EVENTS]
        except Exception as e:
            logger.warning(f"[STREAM_BUFFER] Failed to read events for {conv_id}: {e}")
            return []

    async def clear_stream(self, conv_id: str):
        """Delete all stream data for a conversation."""
        try:
            r = await self._get_redis()
            await r.delete(self._stream_key(conv_id))
            await r.delete(self._active_key(conv_id))
        except Exception as e:
            logger.warning(f"[STREAM_BUFFER] Failed to clear stream for {conv_id}: {e}")


stream_buffer = StreamBuffer()
