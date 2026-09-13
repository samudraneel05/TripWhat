"""Shared Google OAuth helpers.

Centralizes the concerns that were previously duplicated (and buggy) across
calendar_service and gmail_service:

- Short-lived signed OAuth ``state`` nonces for connect flows — never the
  user's session JWT (which leaked a reusable credential into Google URLs,
  browser history, and server logs).
- Fernet encryption at rest for access/refresh tokens stored in
  ``user.google_tokens`` (values prefixed ``enc:v1:``; legacy plaintext values
  are still readable for migration).
- Merge-update token persistence so incremental authorization flows don't
  clobber scopes or refresh tokens granted by other connect flows.
- Refresh-token persistence: google-auth silently refreshes access tokens
  during ``.execute()``; we persist the new token + expiry afterwards.
- Revocation/disconnect helpers.

Docs:
- Incremental authorization: https://developers.google.com/identity/protocols/oauth2/web-server#incremental-authorization
- Revocation: https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
"""

import asyncio
import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from google.oauth2.credentials import Credentials

from app.config import settings
from app.utils.logger import logger

CONNECT_STATE_TTL_MINUTES = 10
_ENC_PREFIX = "enc:v1:"


# ---------------------------------------------------------------------------
# Token encryption at rest (Fernet)
# ---------------------------------------------------------------------------

def _fernet():
    """Build a Fernet keyed by GOOGLE_TOKEN_ENCRYPTION_KEY, or derived from JWT_SECRET."""
    from cryptography.fernet import Fernet

    key = getattr(settings, "google_token_encryption_key", "") or ""
    if key:
        # Accept either a raw 32-byte urlsafe-b64 key or an arbitrary passphrase.
        try:
            return Fernet(key.encode())
        except Exception:
            pass  # treat as passphrase, derive below
    material = key or settings.jwt_secret
    derived = hashlib.sha256(f"tripwhat:google-tokens:{material}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_secret(value: str | None) -> str | None:
    """Encrypt a token field for storage. No-op for already-encrypted values."""
    if not value or (isinstance(value, str) and value.startswith(_ENC_PREFIX)):
        return value
    return _ENC_PREFIX + _fernet().encrypt(str(value).encode()).decode()


def decrypt_secret(value: str | None) -> str | None:
    """Decrypt a stored token field. Passes through legacy plaintext values."""
    if not value or not isinstance(value, str):
        return value
    if value.startswith(_ENC_PREFIX):
        try:
            return _fernet().decrypt(value[len(_ENC_PREFIX):].encode()).decode()
        except Exception as e:
            logger.error(f"[GOOGLE_OAUTH] Failed to decrypt stored token: {e}")
            return None
    return value


# ---------------------------------------------------------------------------
# OAuth connect-state nonces (never the session JWT)
# ---------------------------------------------------------------------------

def build_connect_state(user_id: str, purpose: str, code_verifier: str | None = None) -> str:
    """Signed, short-lived OAuth state token carrying user_id internally.

    `code_verifier` is the PKCE verifier generated for the authorization
    request — the callback flow is a fresh object, so it must round-trip
    through the state token or token exchange fails with invalid_grant.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "uid": str(user_id),
        "purpose": purpose,
        "jti": secrets.token_urlsafe(16),
        "iat": now,
        "exp": now + timedelta(minutes=CONNECT_STATE_TTL_MINUTES),
    }
    if code_verifier:
        payload["cv"] = code_verifier
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def verify_connect_state(state: str, purpose: str) -> tuple[str, str | None]:
    """Validate a connect-state token; returns (user_id, code_verifier). Raises ValueError."""
    try:
        payload = jwt.decode(state, settings.jwt_secret, algorithms=["HS256"])
    except jwt.InvalidTokenError as e:
        raise ValueError(f"Invalid state token: {e}") from e
    if payload.get("purpose") != purpose:
        raise ValueError("State token purpose mismatch")
    user_id = payload.get("uid")
    if not user_id:
        raise ValueError("State token missing user id")
    return str(user_id), payload.get("cv")


# ---------------------------------------------------------------------------
# Token persistence (merge-update, encrypted, no client_secret in user row)
# ---------------------------------------------------------------------------

async def save_google_tokens(user_id: str, creds: Credentials) -> None:
    """Merge-update user.google_tokens from Credentials.

    - Unions scopes so incremental auth grants accumulate instead of clobbering.
    - Keeps the existing refresh token when the flow returns none.
    - Encrypts access/refresh tokens at rest.
    - Does NOT store client_secret (read from settings at load time instead).
    """
    from sqlalchemy import select
    from sqlalchemy.orm.attributes import flag_modified
    from app.database import async_session
    from app.models import User

    async with async_session() as db:
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if not user:
            return

        existing = dict(user.google_tokens or {})

        existing_scopes = set(str(existing.get("scope") or "").split())
        new_scopes = creds.scope or ""
        if isinstance(new_scopes, (list, tuple, set)):
            new_scopes = " ".join(new_scopes)
        merged_scopes = " ".join(sorted(existing_scopes | set(str(new_scopes).split())))

        refresh = creds.refresh_token or decrypt_secret(existing.get("refresh_token"))

        existing.update({
            "access_token": encrypt_secret(creds.token),
            "refresh_token": encrypt_secret(refresh) if refresh else None,
            "scope": merged_scopes,
            "token_uri": creds.token_uri or "https://oauth2.googleapis.com/token",
            "client_id": creds.client_id or settings.google_client_id,
            "expiry": creds.expiry.isoformat() if creds.expiry else existing.get("expiry"),
        })
        user.google_tokens = existing
        flag_modified(user, "google_tokens")
        await db.commit()


async def load_google_credentials(user_id: str) -> tuple[Credentials, str | None]:
    """Load decrypted Credentials for a user.

    Returns (creds, previous_access_token) — keep the previous token around so
    callers can detect a silent refresh via persist_if_refreshed().
    Raises ValueError("Google not connected") when nothing is stored.
    """
    from sqlalchemy import select
    from app.database import async_session
    from app.models import User

    async with async_session() as db:
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        tokens = (user.google_tokens or {}) if user else {}
        if not tokens.get("refresh_token") and not tokens.get("access_token"):
            raise ValueError("Google not connected")

        expiry = None
        raw_expiry = tokens.get("expiry")
        if raw_expiry:
            try:
                expiry = datetime.fromisoformat(str(raw_expiry).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                expiry = None

        prev_token = decrypt_secret(tokens.get("access_token"))
        creds = Credentials(
            token=prev_token,
            refresh_token=decrypt_secret(tokens.get("refresh_token")),
            token_uri=tokens.get("token_uri") or "https://oauth2.googleapis.com/token",
            client_id=tokens.get("client_id") or settings.google_client_id,
            client_secret=settings.google_client_secret,
            scopes=str(tokens.get("scope") or "").split(),
            expiry=expiry,
        )
        return creds, prev_token


async def persist_if_refreshed(user_id: str, creds: Credentials, previous_token: str | None) -> None:
    """Persist access token + expiry when google-auth silently refreshed them."""
    try:
        if creds.token and creds.token != previous_token:
            await save_google_tokens(user_id, creds)
    except Exception as e:
        logger.warning(f"[GOOGLE_OAUTH] Failed to persist refreshed token: {e}")


async def clear_google_tokens(user_id: str) -> None:
    """Clear stored Google tokens (revocation, expired grant, or disconnect)."""
    from sqlalchemy import select
    from app.database import async_session
    from app.models import User

    async with async_session() as db:
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if user and user.google_tokens:
            user.google_tokens = None
            await db.commit()


async def revoke_and_disconnect(user_id: str) -> bool:
    """Revoke the Google grant and clear stored tokens. Returns True if a token existed."""
    try:
        creds, _ = await load_google_credentials(user_id)
    except ValueError:
        return False

    token_to_revoke = creds.refresh_token or creds.token
    if token_to_revoke:
        try:
            import httpx

            async def _revoke():
                async with httpx.AsyncClient(timeout=10) as client:
                    return await client.post(
                        "https://oauth2.googleapis.com/revoke",
                        params={"token": token_to_revoke},
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    )

            resp = await _revoke()
            if resp.status_code != 200:
                logger.warning(f"[GOOGLE_OAUTH] Revocation returned {resp.status_code} for user {user_id}")
        except Exception as e:
            # Even if revocation fails (network, already revoked), clear locally.
            logger.warning(f"[GOOGLE_OAUTH] Revocation failed for user {user_id}: {e}")

    await clear_google_tokens(user_id)
    return True


def is_refresh_revoked(exc: Exception) -> bool:
    """True only when an API failure indicates the refresh token was
    revoked/expired (invalid_grant) — not for transient transport errors."""
    text = str(exc).lower()
    return (
        "invalid_grant" in text
        or "token has been revoked" in text
        or "token has been expired" in text
    )


async def handle_auth_failure(user_id: str, exc: Exception) -> None:
    """On revoked refresh tokens, clear stored tokens so status shows disconnected."""
    if is_refresh_revoked(exc):
        logger.warning(f"[GOOGLE_OAUTH] Refresh token invalid for user {user_id} — marking disconnected")
        await clear_google_tokens(user_id)


def run_sync(fn, *args, **kwargs):
    """Run a blocking googleapiclient call off the event loop."""
    return asyncio.to_thread(fn, *args, **kwargs)
