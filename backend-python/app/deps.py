"""Dependency injection for FastAPI routes."""

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""

    if not token:
        raise HTTPException(status_code=401, detail="Access denied")

    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        user_id = payload.get("sub") or payload.get("userId")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def user_id_from_token(token: str) -> int:
    """Decode a JWT and return its user id; raises jwt.InvalidTokenError if unusable."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    user_id = payload.get("sub") or payload.get("userId")
    try:
        return int(user_id)
    except (TypeError, ValueError):
        raise jwt.InvalidTokenError("Token has no user id")
