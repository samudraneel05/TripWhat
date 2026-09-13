"""Sync externally-written trip_state into the LangGraph checkpoint.

The Postgres checkpointer (thread_id = conversation_id) is the source of
truth for the agent's trip_state — chat_stream only seeds keys the
checkpoint lacks, so writes made outside the agent run (manual itinerary
edits, saved-trip updates, booking imports) must be pushed via
aupdate_state or the next agent turn reads stale state and clobbers them.

The trip_state channel has a shallow right-wins merge reducer, so passing
only the keys that changed leaves everything else untouched.
"""

from app.utils.logger import logger


async def sync_trip_state_to_checkpoint(conversation_id: str | None, update: dict | None) -> None:
    """Push a partial trip_state update into the LangGraph checkpoint.

    `update` should contain ONLY the keys being written — the right-wins
    merge reducer overwrites those keys and preserves all others.

    Failures are logged but never propagate — the caller's DB write already
    succeeded, so the value is still correct for non-agent readers.
    """
    if not conversation_id or not update:
        return
    try:
        from app.agents.travel_agent import travel_agent
        config = {"configurable": {"thread_id": conversation_id}}
        await travel_agent.agent.aupdate_state(config, {"trip_state": dict(update)})
    except Exception as e:
        logger.warning(
            f"[CHECKPOINT_SYNC] failed for {conversation_id}: {e}"
        )
