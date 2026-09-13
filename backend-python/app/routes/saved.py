"""Saved items API routes — save/unsave/list hotels, flights, places, restaurants."""


import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.saved_item import SavedItem
from app.deps import get_current_user
from app.utils.logger import logger


router = APIRouter(prefix="/api/saved", tags=["saved"])


class SaveItemRequest(BaseModel):
    itemType: str  # hotel | flight | place | restaurant
    name: str
    data: dict | None = None
    tripId: int | None = None


class SavedItemResponse(BaseModel):
    id: int
    itemType: str
    name: str
    data: dict | None
    tripId: int | None
    createdAt: str | None = None


@router.get("")
@router.get("/")
async def list_saved_items(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SavedItem)
        .where(SavedItem.user_id == user.id)
        .order_by(SavedItem.created_at.desc())
    )
    items = result.scalars().all()
    return [
        SavedItemResponse(
            id=item.id,
            itemType=item.item_type,
            name=item.name,
            data=item.data,
            tripId=item.trip_id,
            createdAt=item.created_at.isoformat() if item.created_at else None,
        ).model_dump()
        for item in items
    ]


@router.post("")
@router.post("/")
async def save_item(
    req: SaveItemRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.itemType not in {"hotel", "flight", "place", "restaurant"}:
        raise HTTPException(status_code=400, detail="Invalid itemType")
    item = SavedItem(
        user_id=user.id,
        trip_id=req.tripId,
        item_type=req.itemType,
        name=req.name,
        data=req.data or {},
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return SavedItemResponse(
        id=item.id,
        itemType=item.item_type,
        name=item.name,
        data=item.data,
        tripId=item.trip_id,
        createdAt=item.created_at.isoformat() if item.created_at else None,
    ).model_dump()


@router.delete("/{item_id}")
async def delete_saved_item(
    item_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SavedItem).where(SavedItem.id == item_id, SavedItem.user_id == user.id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Saved item not found")
    await db.delete(item)
    await db.commit()
    return {"ok": True}


class ImportLinkRequest(BaseModel):
    url: str


_URL_RE = re.compile(r"^https?://[^\s]+$", re.I)


@router.post("/import-link")
async def import_link(req: ImportLinkRequest, user: User = Depends(get_current_user)):
    """Extract places from a shared social link (IG reel / TikTok / YouTube).

    Runs async — results arrive via the 'saved:imported' socket event.
    """
    url = req.url.strip()
    if not _URL_RE.match(url):
        raise HTTPException(status_code=400, detail="Invalid URL")

    from app.services import link_import

    platform = link_import.detect_platform(url)
    if platform not in {"instagram", "tiktok", "youtube"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported platform: {platform}. Share an Instagram, TikTok, or YouTube link.",
        )

    task = asyncio.create_task(link_import.run_import(url, user.id))
    task.add_done_callback(
        lambda t: t.exception() and logger.error(f"[import-link] task failed: {t.exception()}")
    )
    return {"status": "processing", "platform": platform}
