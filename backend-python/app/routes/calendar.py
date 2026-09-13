"""Calendar routes — Google OAuth + event management."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.config import settings
from app.deps import get_current_user
from app.models import User
from app.services import google_oauth
from app.services.calendar_service import calendar_service

router = APIRouter()


@router.get("/oauth/url")
async def get_oauth_url(user: User = Depends(get_current_user)):
    url = calendar_service.get_oauth_url(str(user.id))
    return {"url": url}


@router.get("/oauth/callback")
async def oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
):
    try:
        user_id, code_verifier = google_oauth.verify_connect_state(state, "calendar_connect")
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    await calendar_service.exchange_code_and_store_tokens(code, user_id, code_verifier)
    return RedirectResponse(
        url=f"{settings.frontend_url}/trips?gcal=connected",
        status_code=302,
    )


@router.post("/disconnect")
async def disconnect(user: User = Depends(get_current_user)):
    """Revoke the Google grant and clear stored tokens (Calendar + Gmail)."""
    disconnected = await calendar_service.disconnect(str(user.id))
    return {"disconnected": True, "hadConnection": disconnected}


@router.get("/calendar/upcoming")
async def upcoming_events(user: User = Depends(get_current_user)):
    try:
        events = await calendar_service.list_upcoming_events(str(user.id))
        return {"events": events}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/calendar/events")
async def create_event(
    payload: dict,
    user: User = Depends(get_current_user),
):
    required = ["summary", "start", "end"]
    for field in required:
        if field not in payload:
            raise HTTPException(status_code=400, detail=f"{field} is required")
    try:
        event = await calendar_service.create_event(str(user.id), payload)
        return {"event": event}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
