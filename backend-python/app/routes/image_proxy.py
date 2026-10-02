"""Image proxy route — caches image blobs in DB for stable, fast serving."""

import asyncio
import hashlib
import ipaddress
import socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import APIRouter, Query, Response, HTTPException
from sqlalchemy import delete, select, update

from app.database import async_session
from app.models.image_cache import ImageCache
from app.utils.logger import logger

router = APIRouter()

# Cap TTL cleanup to run at most once per minute
_last_cleanup: datetime | None = None
CLEANUP_INTERVAL = timedelta(seconds=60)
MAX_IMAGE_SIZE = 2 * 1024 * 1024  # 2 MB
MAX_REDIRECTS = 3
ALLOWED_HOST_SUFFIXES = (
    "googleusercontent.com",
    "ggpht.com",
    "googleapis.com",
    "gstatic.com",
    "serpapi.com",
    "images.unsplash.com",
    "upload.wikimedia.org",
)
RESPONSE_HEADERS = {
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
}


def _host_allowed(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == s or host.endswith("." + s) for s in ALLOWED_HOST_SUFFIXES)


async def _validate_url(url: str) -> None:
    """Raise 400 unless the URL is https, allowlisted and resolves only to public IPs."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
        port = parts.port or 443
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid url parameter")
    if parts.scheme != "https" or not host or not _host_allowed(host):
        raise HTTPException(status_code=400, detail="URL not allowed")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        raise HTTPException(status_code=400, detail="URL not allowed")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise HTTPException(status_code=400, detail="URL not allowed")


async def _fetch_image(url: str) -> httpx.Response:
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await _validate_url(url)
            resp = await client.get(url)
            if resp.is_redirect and resp.headers.get("location"):
                url = urljoin(url, resp.headers["location"])
                continue
            return resp
    raise HTTPException(status_code=400, detail="Too many redirects")


async def _cleanup_expired():
    """Delete image_cache rows older than TTL. Runs at most once per minute."""
    global _last_cleanup
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if _last_cleanup and (now - _last_cleanup) < CLEANUP_INTERVAL:
        return
    _last_cleanup = now
    cutoff = now - ImageCache.ttl()
    try:
        async with async_session() as db:
            await db.execute(delete(ImageCache).where(ImageCache.last_accessed < cutoff))
            await db.commit()
    except Exception as e:
        logger.warning(f"[IMAGE_PROXY] TTL cleanup failed: {e}")


@router.get("/api/image")
async def proxy_image(url: str = Query(..., description="Full image URL to proxy and cache")):
    """Serve an image from DB cache, or fetch+cache on miss.

    Returns the raw image bytes with immutable Cache-Control headers so
    browsers and CDNs cache it indefinitely. The DB cache uses TTL-based
    eviction (7 days since last access).
    """
    if not url or not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid url parameter")
    await _validate_url(url)

    url_hash = hashlib.sha256(url.encode()).hexdigest()[:32]

    # Kick off TTL cleanup (no-op if ran recently)
    await _cleanup_expired()

    # Check DB cache
    async with async_session() as db:
        row = (await db.execute(
            select(ImageCache).where(ImageCache.url_hash == url_hash)
        )).scalar_one_or_none()

        if row:
            # Update last_accessed
            await db.execute(
                update(ImageCache)
                .where(ImageCache.id == row.id)
                .values(last_accessed=datetime.now(timezone.utc).replace(tzinfo=None))
            )
            await db.commit()
            return Response(
                content=row.blob,
                media_type=row.content_type,
                headers=RESPONSE_HEADERS,
            )

    # Cache miss — fetch from origin
    try:
        resp = await _fetch_image(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Origin returned {resp.status_code}")

        content_type = resp.headers.get("content-type", "")
        if not content_type.lower().startswith("image/"):
            raise HTTPException(status_code=415, detail="Origin did not return an image")

        blob = resp.content
        if len(blob) > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=413, detail="Image too large")

        async with async_session() as db:
            db.add(ImageCache(
                url_hash=url_hash,
                blob=blob,
                content_type=content_type,
                size_bytes=len(blob),
            ))
            await db.commit()

        return Response(
            content=blob,
            media_type=content_type,
            headers=RESPONSE_HEADERS,
        )

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Origin timed out")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"[IMAGE_PROXY] Fetch failed for {url[:80]}: {e}")
        raise HTTPException(status_code=502, detail="Image fetch failed")
