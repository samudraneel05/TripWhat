"""Import visitable places from shared social links into Saved Places.

Cascade (cheapest first):
  Tier 0  yt-dlp metadata only -> LLM place extraction          (~free, seconds)
  Tier 1  yt-dlp download -> Gemini video understanding         (video+audio in one call)
          fallback: Whisper transcript when no Gemini key and ffmpeg exists
  Tier 2  Apify reel scraper                                    (when yt-dlp is IP/login blocked)
  Tail    specificity filter -> Google Places (top-3 + re-rank) -> caller persists
"""

import asyncio
import json
import re
import shutil
import tempfile
import time
from pathlib import Path

import httpx

from app.config import settings
from app.utils.logger import logger

PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.location,"
    "places.rating,places.userRatingCount,places.types,places.photos"
)

# Geo/entity types that are useless as saved places (too broad).
_DROP_TYPES = {"country", "continent"}

_GEO_TYPES = {
    "locality", "administrative_area_level_1", "administrative_area_level_2",
    "sublocality", "neighborhood", "political", "country",
}

_PLACE_TYPES = (
    "attraction|restaurant|cafe|hotel|beach|viewpoint|neighborhood|"
    "city|natural_feature|other"
)

EXTRACT_PROMPT = """You extract visitable real-world places from social-media link metadata.

Given the metadata JSON below, return a JSON object:
{
  "destination_context": "<best guess for city/region/country, or null>",
  "candidates": [
    {"name": "<place name>", "locationHint": "<city/region/country to disambiguate>", "type": "<TYPE_LIST>"}
  ]
}

Rules:
- Only real, visitable places a traveler could go to: named POIs, restaurants,
  cafes, bars, hotels, beaches, temples, parks, viewpoints, neighborhoods,
  towns/cities (only when they are actual stops on an itinerary).
- Skip generic words ("beaches", "local cafes"), activities, transport,
  sponsor mentions (Klook, airlines), and hashtag-only noise.
- Skip countries and continents entirely — too broad to save.
- Use the uploader's caption, video title, location tag, hashtags and top
  comments. Preserve location-marked items — they are usually explicit stops.
- Prefer the exact proper name a Google Places search would match
  (e.g. "Shiraito Falls" not "the falls"; "Buza Bar" not "sunset drinks").
- locationHint should come from destination_context unless the caption says
  otherwise. Never invent places not present in the metadata.
- Order candidates by prominence in the metadata. Cap at 25.
- Return JSON only.

METADATA:
{metadata}
""".replace("TYPE_LIST", _PLACE_TYPES)

VIDEO_PROMPT = """You extract visitable real-world places from a travel video.

Watch and listen to the video. Places may appear as: spoken names in the
voiceover, on-screen text overlays, captions, signage, or recognizable
landmarks.

Return a JSON object:
{
  "destination_context": "<best guess for city/region/country, or null>",
  "candidates": [
    {"name": "<place name>", "locationHint": "<city/region/country to disambiguate>", "type": "<TYPE_LIST>"}
  ]
}

Rules:
- Only real, visitable places a traveler could go to: named POIs, restaurants,
  cafes, bars, hotels, beaches, temples, parks, viewpoints, neighborhoods,
  towns/cities (only when they are actual stops on an itinerary).
- Prefer the exact proper name a Google Places search would match.
- Skip generic scenery, activities, sponsor mentions, countries and continents.
- Use any caption metadata provided to disambiguate. Never invent places.
- Order by prominence. Cap at 25.
- Return JSON only.
""".replace("TYPE_LIST", _PLACE_TYPES)


def detect_platform(url: str) -> str:
    host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
    for name in ("tiktok", "instagram"):
        if name in host:
            return name
    if "youtu" in host:
        return "youtube"
    return host.split(".")[0]


# ------------------------------------------------------------------ yt-dlp

_YDL_META_OPTS = {
    "skip_download": True,
    "quiet": True,
    "noprogress": True,
    "extract_flat": False,
    "getcomments": True,
    "extractor_args": {"youtube": {"max_comments": ["10"]}},
}


def _ytdlp_metadata(url: str) -> dict:
    import yt_dlp

    with yt_dlp.YoutubeDL(_YDL_META_OPTS) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise RuntimeError("yt-dlp returned no info")
    comments = [c.get("text", "") for c in (info.get("comments") or [])[:10] if c.get("text")]
    return {
        "id": info.get("id"),
        "title": info.get("title") or "",
        "caption": info.get("description") or "",
        "uploader": info.get("uploader") or info.get("channel") or "",
        "location": info.get("location"),
        "hashtags": info.get("tags") or [],
        "comments_preview": comments,
        "duration": info.get("duration"),
        "webpage_url": info.get("webpage_url") or url,
    }


def _download_video(url: str, out_dir: Path) -> Path:
    import yt_dlp

    opts = {
        "quiet": True,
        "noprogress": True,
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "format": "best[ext=mp4]/best",
        "merge_output_format": "mp4",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return Path(ydl.prepare_filename(info))


def _download_audio(url: str, out_dir: Path) -> Path:
    import yt_dlp

    opts = {
        "quiet": True,
        "noprogress": True,
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "format": "bestaudio/best",
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3"}],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return Path(ydl.prepare_filename(info)).with_suffix(".mp3")


# ------------------------------------------------------------------- LLM

def _openai_client():
    from openai import OpenAI

    return OpenAI(api_key=settings.openai_api_key)


def _llm_extract_from_meta(meta: dict) -> dict:
    payload = {
        "platform": detect_platform(meta["webpage_url"]),
        "title": meta["title"],
        "caption": meta["caption"],
        "location_tag": meta["location"],
        "hashtags": meta["hashtags"],
        "comments_preview": meta["comments_preview"][:5],
    }
    resp = _openai_client().chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        response_format={"type": "json_object"},
        messages=[{
            "role": "user",
            "content": EXTRACT_PROMPT.replace("{metadata}", json.dumps(payload, ensure_ascii=False)),
        }],
    )
    return json.loads(resp.choices[0].message.content)


def _gemini_extract(video_path: Path, meta: dict) -> dict:
    """Upload the video to Gemini Files API and ask it to extract places."""
    from google import genai

    client = genai.Client(api_key=settings.google_video_understanding_key)
    uploaded = client.files.upload(file=str(video_path))
    for _ in range(30):  # reels process in seconds; cap at ~60s
        if uploaded.state and uploaded.state.name == "ACTIVE":
            break
        if uploaded.state and uploaded.state.name == "FAILED":
            raise RuntimeError("Gemini file processing failed")
        time.sleep(2)
        uploaded = client.files.get(name=uploaded.name)

    hint = json.dumps({"title": meta.get("title"), "caption": meta.get("caption", "")[:1500]}, ensure_ascii=False)
    resp = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=[uploaded, VIDEO_PROMPT + f"\nCAPTION METADATA (may be empty):\n{hint}\n\nReturn JSON only."],
    )
    text = resp.text or ""
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise RuntimeError(f"Gemini returned no JSON: {text[:200]}")
    return json.loads(m.group(0))


def _whisper_extract(audio_path: Path, meta: dict) -> dict:
    """Fallback media path: Whisper transcript -> same LLM candidate shape."""
    client = _openai_client()
    with open(audio_path, "rb") as f:
        transcript = client.audio.transcriptions.create(model="whisper-1", file=f).text
    merged = dict(meta)
    merged["caption"] = (meta.get("caption") or "") + "\n\nTRANSCRIPT:\n" + (transcript or "")
    merged["comments_preview"] = []
    return _llm_extract_from_meta(merged)


# ------------------------------------------------------------------- Apify

def _apify_reel(url: str) -> dict:
    """Tier 2: apify/instagram-reel-scraper for direct reel URLs."""
    if not settings.apify_token:
        raise RuntimeError("APIFY_TOKEN not configured")
    resp = httpx.post(
        "https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items",
        params={"token": settings.apify_token, "timeout": 120, "format": "json", "clean": "true"},
        json={"username": [url], "resultsLimit": 1},
        timeout=150,
    )
    resp.raise_for_status()
    items = resp.json()
    if not items:
        raise RuntimeError("Apify returned no items")
    item = items[0]
    hashtags = re.findall(r"#(\w+)", item.get("caption") or "")
    return {
        "id": item.get("shortCode") or item.get("id"),
        "title": "",
        "caption": item.get("caption") or "",
        "uploader": item.get("ownerUsername") or "",
        "location": item.get("locationName"),
        "hashtags": hashtags,
        "comments_preview": [],
        "duration": item.get("videoDuration"),
        "webpage_url": item.get("url") or url,
    }


# ----------------------------------------------------------- Places resolve

def _places_search_text(query: str) -> list[dict]:
    if not settings.google_places_api_key:
        return []
    resp = httpx.post(
        PLACES_URL,
        headers={
            "X-Goog-Api-Key": settings.google_places_api_key,
            "X-Goog-FieldMask": PLACES_FIELD_MASK,
        },
        json={"textQuery": query, "pageSize": 3},
        timeout=15,
    )
    if resp.status_code != 200:
        logger.warning(f"[link_import] Places {resp.status_code} for {query!r}: {resp.text[:200]}")
        return []
    return resp.json().get("places", [])


def _photo_url(place: dict, max_width: int = 400) -> str | None:
    photos = place.get("photos") or []
    name = photos[0].get("name") if photos else None
    if not name:
        return None
    return (
        f"https://places.googleapis.com/v1/{name}/media"
        f"?maxWidthPx={max_width}&key={settings.google_places_api_key}"
    )


def _token_overlap(a: str, b: str) -> int:
    ta = {t for t in re.split(r"\W+", a.lower()) if len(t) > 2}
    tb = {t for t in re.split(r"\W+", b.lower()) if len(t) > 2}
    return len(ta & tb)


def _best_match(results: list[dict], candidate_name: str, candidate_type: str = "") -> dict:
    """Text Search ranks by relevance, not name fidelity — re-rank by token
    overlap so 'Sorrento' doesn't resolve to 'Amalfi Coast'."""
    wants_geo = candidate_type in {"city", "neighborhood"}
    scored = sorted(
        results,
        key=lambda p: (
            _token_overlap(candidate_name, (p.get("displayName") or {}).get("text") or ""),
            bool(set(p.get("types") or []) & _GEO_TYPES) if wants_geo else False,
        ),
        reverse=True,
    )
    best = scored[0]
    if _token_overlap(candidate_name, (best.get("displayName") or {}).get("text") or "") == 0:
        return results[0]
    return best


def _resolve_candidates(candidates: list[dict], context: str | None) -> list[dict]:
    resolved, seen = [], set()
    for cand in candidates:
        name = (cand.get("name") or "").strip()
        ctype = (cand.get("type") or "").lower()
        if not name or ctype in _DROP_TYPES:
            continue
        hint = cand.get("locationHint") or context or ""
        if ctype in {"city", "neighborhood"} and "," in hint:
            hint = hint.split(",")[-1].strip()
        query = f"{name}, {hint}".strip(", ")
        results = _places_search_text(query)
        if not results:
            continue
        p = _best_match(results, name, ctype)
        ptypes = set(p.get("types") or [])
        if ptypes and ptypes <= {"country", "political"} | {"continent"}:
            continue  # resolved to a country/continent — too broad to save
        pid = p.get("id")
        if not pid or pid in seen:
            continue
        seen.add(pid)
        loc = p.get("location") or {}
        resolved.append({
            "name": (p.get("displayName") or {}).get("text"),
            "placeId": pid,
            "address": p.get("formattedAddress"),
            "rating": p.get("rating"),
            "userRatingCount": p.get("userRatingCount"),
            "coordinates": {"lat": loc.get("latitude"), "lng": loc.get("longitude")},
            "types": list(ptypes),
            "photoUrl": _photo_url(p),
            "candidateType": ctype,
        })
    return resolved


# ------------------------------------------------------------- orchestrator

async def extract_places(url: str) -> dict:
    """Run the cascade; returns {platform, source, context, places, errors}."""
    result = {"platform": detect_platform(url), "source": None,
              "context": None, "places": [], "errors": []}
    meta: dict = {}
    candidates: list[dict] = []

    # Tier 0 — metadata only
    try:
        meta = await asyncio.to_thread(_ytdlp_metadata, url)
        out = await asyncio.to_thread(_llm_extract_from_meta, meta)
        result["context"] = out.get("destination_context")
        candidates = out.get("candidates") or []
        result["source"] = "metadata"
    except Exception as e:
        result["errors"].append(f"metadata: {type(e).__name__}: {e}")
        logger.info(f"[link_import] metadata tier failed for {url}: {e}")

    # Tier 2 — Apify (when yt-dlp itself couldn't even fetch metadata)
    if not meta and settings.apify_token and result["platform"] == "instagram":
        try:
            meta = await asyncio.to_thread(_apify_reel, url)
            out = await asyncio.to_thread(_llm_extract_from_meta, meta)
            result["context"] = result["context"] or out.get("destination_context")
            candidates = out.get("candidates") or []
            result["source"] = "apify"
        except Exception as e:
            result["errors"].append(f"apify: {type(e).__name__}: {e}")
            logger.info(f"[link_import] apify tier failed for {url}: {e}")

    # Tier 1 — media analysis when metadata yielded little
    if len(candidates) < 2:
        with tempfile.TemporaryDirectory(prefix="tripwhat-import-") as tmp:
            tmpdir = Path(tmp)
            try:
                video = await asyncio.to_thread(_download_video, url, tmpdir)
                if settings.google_video_understanding_key:
                    out = await asyncio.to_thread(_gemini_extract, video, meta)
                elif shutil.which("ffmpeg"):
                    audio = await asyncio.to_thread(_download_audio, url, tmpdir)
                    out = await asyncio.to_thread(_whisper_extract, audio, meta)
                else:
                    out = None
                if out:
                    result["context"] = result["context"] or out.get("destination_context")
                    media_cands = out.get("candidates") or []
                    if len(media_cands) > len(candidates):
                        candidates = media_cands
                        result["source"] = "gemini" if settings.google_video_understanding_key else "whisper"
            except Exception as e:
                result["errors"].append(f"media: {type(e).__name__}: {e}")
                logger.info(f"[link_import] media tier failed for {url}: {e}")

    if candidates:
        places = await asyncio.to_thread(_resolve_candidates, candidates, result["context"])
        result["places"] = places
    return result


async def run_import(url: str, user_id: int) -> dict:
    """Full import: extract -> resolve -> persist SavedItems -> emit socket event."""
    from app.database import async_session
    from app.models.saved_item import SavedItem
    from sqlalchemy import select

    out = await extract_places(url)
    places = out["places"]

    saved = []
    if places:
        async with async_session() as db:
            existing = await db.execute(
                select(SavedItem).where(SavedItem.user_id == user_id)
            )
            have = {
                (it.data or {}).get("placeId") or it.name.lower()
                for it in existing.scalars().all()
            }
            for p in places:
                if p["placeId"] in have or (p["name"] or "").lower() in have:
                    continue
                item = SavedItem(
                    user_id=user_id,
                    item_type="place",
                    name=p["name"] or "",
                    data={
                        "placeId": p["placeId"],
                        "address": p["address"],
                        "rating": p["rating"],
                        "userRatingCount": p["userRatingCount"],
                        "coordinates": p["coordinates"],
                        "imageUrl": p["photoUrl"],
                        "source": url,
                        "sourcePlatform": out["platform"],
                    },
                )
                db.add(item)
                saved.append(p["name"])
            await db.commit()

    payload = {
        "userId": user_id,
        "url": url,
        "platform": out["platform"],
        "source": out["source"],
        "count": len(saved),
        "names": saved,
        "errors": out["errors"],
    }
    try:
        from app.main import sio

        await sio.emit("saved:imported", payload)
    except Exception as e:
        logger.warning(f"[link_import] socket emit failed: {e}")
    return payload
