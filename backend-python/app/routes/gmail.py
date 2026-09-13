"""Gmail routes — OAuth URL, callback, status, booking search, disconnect."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.config import settings
from app.deps import get_current_user
from app.models import User
from app.services import google_oauth
from app.services.gmail_service import gmail_service

router = APIRouter()


@router.get("/gmail/oauth/url")
async def get_gmail_oauth_url(user: User = Depends(get_current_user)):
    """Get Gmail OAuth URL for the user to authorize."""
    try:
        url = gmail_service.get_oauth_url(str(user.id))
        return {"url": url}
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/gmail/oauth/callback")
async def gmail_oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
):
    """Handle Gmail OAuth callback — state is a short-lived signed nonce."""
    try:
        user_id, code_verifier = google_oauth.verify_connect_state(state, "gmail_connect")
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    await gmail_service.exchange_code_and_store_tokens(code, user_id, code_verifier)
    return RedirectResponse(
        url=f"{settings.frontend_url}/new?tab=bookings&gmail=connected",
        status_code=302,
    )


@router.get("/gmail/status")
async def gmail_status(user: User = Depends(get_current_user)):
    """Check if Gmail is connected."""
    connected = await gmail_service.is_connected(str(user.id))
    return {"connected": connected}


@router.get("/gmail/bookings")
async def get_gmail_bookings(user: User = Depends(get_current_user)):
    """Search Gmail for booking confirmations."""
    try:
        bookings = await gmail_service.search_bookings(str(user.id))
        return {"bookings": bookings, "count": len(bookings)}
    except ValueError as e:
        # Not a 401 — the frontend axios interceptor logs out on 401. A missing
        # or expired Google grant is a 400-level client state issue instead.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/gmail/disconnect")
async def gmail_disconnect(user: User = Depends(get_current_user)):
    """Revoke the Google grant and clear stored tokens (also disconnects Calendar)."""
    disconnected = await gmail_service.disconnect(str(user.id))
    return {"disconnected": True, "hadConnection": disconnected}
