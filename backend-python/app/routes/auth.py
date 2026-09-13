"""Auth routes — register, login, me, update profile, Google OAuth."""

import jwt
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas.auth import (
    RegisterRequest, LoginRequest, AuthResponse,
    UserResponse, UpdateProfileRequest,
)
import bcrypt

router = APIRouter()


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("utf-8"))


def _create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=settings.jwt_expires_in_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        bio=user.bio,
        avatar_url=user.avatar_url,
        preferences=user.preferences or {},
    )


@router.post("/register", response_model=AuthResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already exists")

    user = User(
        name=req.name,
        email=req.email,
        password=_hash_password(req.password),
        preferences=req.preferences or {},
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = _create_token(user.id)
    return AuthResponse(token=token, user=_user_response(user))


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user or not _verify_password(req.password, user.password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    token = _create_token(user.id)
    return AuthResponse(token=token, user=_user_response(user))


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return {"user": _user_response(user)}


@router.put("/profile")
async def update_profile(
    req: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.name is not None:
        user.name = req.name
    if req.bio is not None:
        user.bio = req.bio
    if req.avatar_url is not None:
        user.avatar_url = req.avatar_url
    if req.preferences is not None:
        current = user.preferences or {}
        current.update(req.preferences)
        user.preferences = current

    await db.commit()
    await db.refresh(user)
    return {"message": "Profile updated successfully", "user": _user_response(user)}


# ── Google OAuth for signup/login ──

# Full scope URIs — Google echoes back canonical URIs and oauthlib raises the
# scope-change Warning as an error if they don't set-match the request.
_GOOGLE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]


def _google_auth_redirect_uri() -> str:
    """Return the redirect URI for Google auth signup/login."""
    base = settings.frontend_url.rstrip("/")
    return f"{base}/api/auth/google/callback"


@router.get("/google")
async def google_auth_start(redirect: str = Query("/trips")):
    """Redirect the user to Google's consent screen for signup/login."""
    if not settings.google_client_id:
        raise HTTPException(status_code=500, detail="Google OAuth is not configured")

    from google_auth_oauthlib.flow import Flow

    # PKCE: the callback rebuilds a fresh Flow, so we generate the verifier
    # ourselves and round-trip it through the signed state token — otherwise
    # fetch_token runs without it → invalid_grant "Missing code verifier".
    code_verifier = secrets.token_urlsafe(64)
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [_google_auth_redirect_uri()],
            }
        },
        scopes=_GOOGLE_SCOPES,
        redirect_uri=_google_auth_redirect_uri(),
        code_verifier=code_verifier,
    )

    state_payload = {
        "redirect": redirect,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        "cv": code_verifier,
    }
    state_token = jwt.encode(state_payload, settings.jwt_secret, algorithm="HS256")

    url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        state=state_token,
    )
    return RedirectResponse(url=url, status_code=302)


@router.get("/google/callback")
async def google_auth_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Handle the Google OAuth callback — create or log in the user."""
    from google_auth_oauthlib.flow import Flow
    from googleapiclient.discovery import build
    import json

    # Verify state
    try:
        state_payload = jwt.decode(state, settings.jwt_secret, algorithms=["HS256"])
        redirect = state_payload.get("redirect", "/trips")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid state token")

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [_google_auth_redirect_uri()],
            }
        },
        scopes=_GOOGLE_SCOPES,
        redirect_uri=_google_auth_redirect_uri(),
        code_verifier=state_payload.get("cv"),
    )

    flow.fetch_token(code=code)
    credentials = flow.credentials

    # Get user info from Google
    userinfo_service = build("oauth2", "v2", credentials=credentials)
    userinfo = userinfo_service.userinfo().get().execute()
    google_email = userinfo.get("email", "")
    google_name = userinfo.get("name", google_email.split("@")[0] if google_email else "Traveler")
    google_picture = userinfo.get("picture")

    if not google_email:
        raise HTTPException(status_code=400, detail="Could not retrieve email from Google")

    # Find or create user
    result = await db.execute(select(User).where(User.email == google_email))
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            name=google_name,
            email=google_email,
            password=_hash_password(google_email + settings.jwt_secret),  # random password
            avatar_url=google_picture,
            preferences={},
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif google_picture and not user.avatar_url:
        user.avatar_url = google_picture
        await db.commit()

    token = _create_token(user.id)

    # Redirect to frontend with token
    frontend_base = settings.frontend_url.rstrip("/")
    redirect_clean = redirect.lstrip("/")
    return RedirectResponse(
        url=f"{frontend_base}/auth/google/success?token={token}&redirect={redirect_clean}",
        status_code=302,
    )
