"""Itinerary edit routes — direct manual editing of itinerary items.

These endpoints bypass the LLM agent and call itinerary_editor directly,
allowing the frontend to add/remove/edit-time/caption/move/reorder activities
without a chat round-trip. All edits use Google Places search for genuine places.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.deps import get_current_user
from app.models import Conversation, User
from app.services.itinerary_editor import itinerary_editor
from app.services.checkpoint_sync import sync_trip_state_to_checkpoint
from app.services.google_places import google_places
from app.schemas.itinerary import Activity, ActivityLocation
from app.utils.logger import logger

router = APIRouter(prefix="/api/chat/{conversation_id}/itinerary", tags=["itinerary"])


# --- Request models ---

class AddItemRequest(BaseModel):
    place_name: str
    city: str
    day: int
    time_slot: str = "morning"


class RemoveItemRequest(BaseModel):
    day: int
    activity_id: str


class EditTimeRequest(BaseModel):
    day: int
    slot_id: str
    start_time: str
    end_time: str


class CaptionRequest(BaseModel):
    day: int
    activity_id: str
    caption: str


class MoveItemRequest(BaseModel):
    from_day: int
    activity_id: str
    to_day: int
    to_slot: str = "morning"


class ReorderRequest(BaseModel):
    day: int
    activity_id: str
    new_position: int


# --- Helpers ---

async def _get_conversation_state(db: AsyncSession, conversation_id: str, user: User) -> dict:
    """Load conversation and return its trip_state."""
    result = await db.execute(
        select(Conversation).where(
            Conversation.conversation_id == conversation_id,
            Conversation.user_id == user.id,
        )
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation, conversation.trip_state or {}


async def _sync_itinerary_to_checkpoint(conversation_id: str, itinerary: dict | None):
    """Push a manual itinerary edit into the LangGraph checkpoint.

    The Postgres checkpointer (thread_id = conversation_id) is the source of
    truth for the agent's trip_state — chat_stream only seeds keys the
    checkpoint lacks, so without this the next edit_itinerary tool call would
    read the pre-edit itinerary and clobber the user's manual edits on
    write-back. Only the "itinerary" key is pushed — the shallow right-wins
    merge reducer leaves everything else untouched.
    """
    await sync_trip_state_to_checkpoint(
        conversation_id, {"itinerary": itinerary} if itinerary is not None else None
    )


async def _save_state(db: AsyncSession, conversation, trip_state: dict):
    """Save trip_state back to conversation + sync itinerary to the checkpoint."""
    conversation.trip_state = trip_state
    flag_modified(conversation, "trip_state")
    await db.commit()
    await _sync_itinerary_to_checkpoint(
        conversation.conversation_id, trip_state.get("itinerary")
    )


# --- Endpoints ---

@router.post("/add")
async def add_item(
    conversation_id: str,
    req: AddItemRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a place to a day. Uses Google Places search to find genuine place data."""
    conversation, trip_state = await _get_conversation_state(db, conversation_id, user)
    itinerary = trip_state.get("itinerary")
    if not itinerary:
        raise HTTPException(status_code=400, detail="No itinerary found. Build an itinerary first.")

    # Search for the place via Google Places
    place_data = None
    try:
        results = await google_places.search_places(req.place_name, req.city)
        if results:
            place_data = results[0]
            # Resolve photo URL if it's a reference
            photo_ref = place_data.get("photo_url", "")
            if photo_ref and not photo_ref.startswith("http"):
                place_data["photo_url"] = await google_places.resolve_photo_url(photo_ref)
    except Exception as e:
        logger.warning(f"[ITINERARY_EDIT] Place search failed for '{req.place_name}': {e}")

    # Build the action for itinerary_editor
    action = {
        "target": {
            "day": req.day,
            "timeSlot": req.time_slot,
            "activityName": req.place_name,
        },
        "details": {
            "placeName": req.place_name,
        },
    }

    # If we found real place data, inject it into the action so itinerary_editor
    # can use it directly instead of searching again
    if place_data:
        # itinerary_editor.add_activity searches by name, but we can pre-build
        # the activity here to avoid a duplicate search
        import uuid as _uuid
        coords = place_data.get("coordinates", {})
        activity = Activity(
            id=str(_uuid.uuid4()),
            title=place_data.get("name", req.place_name),
            name=place_data.get("name", req.place_name),
            type=", ".join(place_data.get("types", [])[:2]) if place_data.get("types") else "attraction",
            description=place_data.get("description", ""),
            rating=place_data.get("rating"),
            placeId=place_data.get("placeId"),
            address=place_data.get("address", ""),
            coordinates=coords,
            imageUrl=place_data.get("photo_url"),
            photos=[place_data["photo_url"]] if place_data.get("photo_url") else None,
            location=ActivityLocation(
                name=place_data.get("name", req.place_name),
                address=place_data.get("address", ""),
                coordinates=coords if coords else {"lat": 0, "lng": 0},
            ),
            websiteUrl=place_data.get("website"),
            phoneNumber=place_data.get("phone"),
            metadata={"addedBy": "user", "source": "manual_edit"},
        )

        # Add directly to the itinerary — always create a new time slot
        # so the new activity is visible (the frontend reads slot.activity,
        # not slot.activities). Insert before any generic/placeholder slots.
        days = itinerary.get("days", [])
        if req.day and 1 <= req.day <= len(days):
            day = days[req.day - 1]
            from app.schemas.itinerary import create_time_slot
            new_slot = create_time_slot(req.time_slot, activity).model_dump()
            day["timeSlots"].append(new_slot)

        result = {
            "itinerary": itinerary,
            "message": f"Added {place_data.get('name', req.place_name)} to Day {req.day}",
        }
    else:
        # Fall back to itinerary_editor's search (may also fail, but tries OTM)
        result = await itinerary_editor.add_activity(itinerary, action, req.city)

    new_trip_state = dict(trip_state)
    new_trip_state["itinerary"] = result["itinerary"]
    await _save_state(db, conversation, new_trip_state)

    return {"tripState": new_trip_state, "message": result["message"]}


@router.post("/remove")
async def remove_item(
    conversation_id: str,
    req: RemoveItemRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove an activity by day + activity_id."""
    conversation, trip_state = await _get_conversation_state(db, conversation_id, user)
    itinerary = trip_state.get("itinerary")
    if not itinerary:
        raise HTTPException(status_code=400, detail="No itinerary found.")

    action = {
        "target": {
            "day": req.day,
            "activityId": req.activity_id,
        },
    }
    result = itinerary_editor.remove_activity(itinerary, action)

    new_trip_state = dict(trip_state)
    new_trip_state["itinerary"] = result["itinerary"]
    await _save_state(db, conversation, new_trip_state)

    return {"tripState": new_trip_state, "message": result["message"]}


@router.post("/edit-time")
async def edit_time(
    conversation_id: str,
    req: EditTimeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update start/end time for a time slot."""
    conversation, trip_state = await _get_conversation_state(db, conversation_id, user)
    itinerary = trip_state.get("itinerary")
    if not itinerary:
        raise HTTPException(status_code=400, detail="No itinerary found.")

    result = itinerary_editor.edit_time(itinerary, req.day, req.slot_id, req.start_time, req.end_time)

    new_trip_state = dict(trip_state)
    new_trip_state["itinerary"] = result["itinerary"]
    await _save_state(db, conversation, new_trip_state)

    return {"tripState": new_trip_state, "message": result["message"]}


@router.post("/caption")
async def update_caption(
    conversation_id: str,
    req: CaptionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the description/caption of an activity."""
    conversation, trip_state = await _get_conversation_state(db, conversation_id, user)
    itinerary = trip_state.get("itinerary")
    if not itinerary:
        raise HTTPException(status_code=400, detail="No itinerary found.")

    result = itinerary_editor.update_caption(itinerary, req.day, req.activity_id, req.caption)

    new_trip_state = dict(trip_state)
    new_trip_state["itinerary"] = result["itinerary"]
    await _save_state(db, conversation, new_trip_state)

    return {"tripState": new_trip_state, "message": result["message"]}


@router.post("/move")
async def move_item(
    conversation_id: str,
    req: MoveItemRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Move an activity to a different day."""
    conversation, trip_state = await _get_conversation_state(db, conversation_id, user)
    itinerary = trip_state.get("itinerary")
    if not itinerary:
        raise HTTPException(status_code=400, detail="No itinerary found.")

    action = {
        "target": {
            "day": req.from_day,
            "activityId": req.activity_id,
        },
        "details": {
            "newDay": req.to_day,
            "newTimeSlot": req.to_slot,
        },
    }
    result = itinerary_editor.move_activity(itinerary, action)

    new_trip_state = dict(trip_state)
    new_trip_state["itinerary"] = result["itinerary"]
    await _save_state(db, conversation, new_trip_state)

    return {"tripState": new_trip_state, "message": result["message"]}


@router.post("/reorder")
async def reorder_item(
    conversation_id: str,
    req: ReorderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reorder an activity within a day."""
    conversation, trip_state = await _get_conversation_state(db, conversation_id, user)
    itinerary = trip_state.get("itinerary")
    if not itinerary:
        raise HTTPException(status_code=400, detail="No itinerary found.")

    result = itinerary_editor.reorder_activity(itinerary, req.day, req.activity_id, req.new_position)

    new_trip_state = dict(trip_state)
    new_trip_state["itinerary"] = result["itinerary"]
    await _save_state(db, conversation, new_trip_state)

    return {"tripState": new_trip_state, "message": result["message"]}
