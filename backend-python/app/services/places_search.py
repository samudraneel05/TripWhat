"""Places search service — cache-first with fallback chain.

Flow:
  1. Check search_cache for the query → if hit, fetch from places_cache
  2. If miss, try MCP search_places (Google Maps Grounding Lite)
  3. If MCP unavailable, try Google Places API directly
  4. If no API key, try OpenTripMap
  5. If all fail, return empty (LLM fallback handled by caller)
  6. Cache results in places_cache + search_cache
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.database import async_session
from app.models.places_cache import PlacesCache, SearchCache
from app.services.mcp_client import maps_mcp
from app.services.google_places import google_places
from app.services.places_service import places_service
from app.utils.logger import logger

import asyncio

CACHE_TTL_DAYS = 30


def _utcnow_naive() -> datetime:
    """Naive UTC datetime for DB columns that are TIMESTAMP WITHOUT TIME ZONE."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class PlacesSearchService:
    """Cache-first places search with MCP → Google Places → OpenTripMap fallback."""

    async def search(
        self,
        query: str,
        city: str,
        limit: int = 10,
        skip_cache: bool = False,
    ) -> list[dict]:
        """Search for places with cache-first strategy.

        Args:
            query: Search query (e.g., "top attractions in Tokyo")
            city: City name for caching
            limit: Max results
            skip_cache: If True, bypass cache and fetch fresh

        Returns:
            List of normalized place dicts
        """
        if not skip_cache:
            cached = await self._get_cached(query)
            if cached:
                logger.info(f"[PLACES_SEARCH] Cache hit for '{query}' → {len(cached)} places")
                return cached[:limit]

        # Fallback chain: MCP → Google Places API → OpenTripMap. A provider
        # that returns a non-empty but sparse result set (e.g. 1 hit for a
        # country-level query) is supplemented by the next provider — broad
        # queries like "attractions in Australia" often yield few results
        # from a single source.
        min_useful = min(4, limit)
        places = await self._search_mcp(query, city, limit)
        if len(places) < min_useful:
            places = self._merge_places(places, await self._search_google_places(query, city, limit))
        if len(places) < min_useful:
            places = self._merge_places(places, await self._search_opentripmap(query, city, limit))

        if places:
            await self._cache_results(query, city, places)

        return places[:limit]

    @staticmethod
    def _merge_places(base: list[dict], extra: list[dict]) -> list[dict]:
        """Merge provider results, deduped by placeId then lowercase name."""
        seen = {(p.get("placeId") or p.get("id") or p.get("name", "")).lower() if isinstance(p.get("placeId") or p.get("id") or p.get("name", ""), str) else (p.get("placeId") or p.get("id") or "") for p in base}
        merged = list(base)
        for p in extra:
            key = p.get("placeId") or p.get("id") or p.get("name", "")
            key_l = key.lower() if isinstance(key, str) else key
            if key_l and key_l not in seen:
                seen.add(key_l)
                merged.append(p)
        return merged

    async def search_with_photos(
        self,
        query: str,
        city: str,
        limit: int = 10,
        skip_cache: bool = False,
    ) -> list[dict]:
        """Search for places and resolve photo references to direct image URLs.

        After the standard search, any place with a photo_url that isn't already
        a direct http URL gets resolved via the Google Places Photo API.
        Resolved URLs are cached back into places_cache.
        """
        places = await self.search(query, city, limit, skip_cache)

        if not places:
            return places

        # Resolve photo references in parallel
        tasks = [self._resolve_place_photo(p) for p in places if p.get("photo_url")]
        await asyncio.gather(*tasks, return_exceptions=True)

        return places

    async def _resolve_place_photo(self, place: dict) -> None:
        """Resolve a single place's photo_url reference to a direct image URL.

        Mutates the place dict in-place and updates the cache if needed.
        """
        photo_url = place.get("photo_url", "")
        if not photo_url:
            logger.debug(f"[PLACES_SEARCH] No photo_url for '{place.get('name', '?')}'")
            return
        if photo_url.startswith("http"):
            logger.debug(f"[PLACES_SEARCH] Photo already resolved for '{place.get('name', '?')}'")
            return

        try:
            resolved = await google_places.resolve_photo_url(photo_url)
            if resolved:
                place["photo_url"] = resolved
                logger.info(f"[PLACES_SEARCH] Resolved photo for '{place.get('name', '?')}' → {resolved[:80]}...")
                # Update cache with resolved URL
                async with async_session() as db:
                    await db.execute(
                        update(PlacesCache)
                        .where(PlacesCache.place_id == place.get("placeId", ""))
                        .values(photo_url=resolved)
                    )
                    await db.commit()
            else:
                logger.warning(f"[PLACES_SEARCH] Photo resolution returned None for '{place.get('name', '?')}' (ref: {photo_url[:50]})")
        except Exception as e:
            logger.warning(f"[PLACES_SEARCH] Photo resolution failed for '{place.get('name', '?')}': {e}")

    async def search_by_name(self, name: str, city: str) -> dict | None:
        """Search for a specific place by name (for edit commands).

        First checks places_cache by name, then falls back to search.
        """
        # Check cache first
        cached = await self._get_cached_by_name(name, city)
        if cached:
            logger.info(f"[PLACES_SEARCH] Name cache hit for '{name}' in {city}")
            return cached

        # Search via MCP
        query = f"{name} in {city}"
        places = await self._search_mcp(query, city, limit=1)
        if not places:
            places = await self._search_google_places(query, city, limit=1)

        if places:
            await self._cache_results(query, city, places)
            return places[0]

        return None

    async def search_multiple(
        self,
        queries: list[str],
        city: str,
        limit_per_query: int = 5,
    ) -> list[dict]:
        """Run multiple queries and merge results, resolving photo references."""
        tasks = [self.search_with_photos(q, city, limit_per_query) for q in queries]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        merged: list[dict] = []
        seen_ids: set[str] = set()
        for r in results:
            if isinstance(r, list):
                for p in r:
                    pid = p.get("placeId") or p.get("id") or p.get("name", "")
                    if pid and pid not in seen_ids:
                        seen_ids.add(pid)
                        merged.append(p)

        return merged

    async def _get_cached(self, query: str) -> list[dict] | None:
        """Get cached search results."""
        async with async_session() as db:
            # Check search_cache
            result = await db.execute(
                select(SearchCache).where(
                    SearchCache.query == query,
                    SearchCache.expires_at > _utcnow_naive(),
                )
            )
            search_entry = result.scalar_one_or_none()
            if not search_entry:
                return None

            # Fetch places from places_cache
            place_ids = search_entry.place_ids or []
            if not place_ids:
                return None

            result = await db.execute(
                select(PlacesCache).where(PlacesCache.place_id.in_(place_ids))
            )
            places = result.scalars().all()
            if not places:
                return None

            # Update access stats
            await db.execute(
                update(PlacesCache)
                .where(PlacesCache.place_id.in_(place_ids))
                .values(access_count=PlacesCache.access_count + 1, last_accessed=_utcnow_naive())
            )
            await db.commit()

            return [self._orm_to_dict(p) for p in places]

    async def _get_cached_by_name(self, name: str, city: str) -> dict | None:
        """Get a cached place by name (fuzzy match)."""
        async with async_session() as db:
            result = await db.execute(
                select(PlacesCache).where(
                    PlacesCache.city.ilike(f"%{city}%"),
                    PlacesCache.name.ilike(f"%{name}%"),
                ).limit(1)
            )
            place = result.scalar_one_or_none()
            if not place:
                return None

            await db.execute(
                update(PlacesCache)
                .where(PlacesCache.id == place.id)
                .values(access_count=PlacesCache.access_count + 1, last_accessed=_utcnow_naive())
            )
            await db.commit()

            return self._orm_to_dict(place)

    async def _cache_results(self, query: str, city: str, places: list[dict]) -> None:
        """Cache search results in places_cache + search_cache."""
        if not places:
            return

        place_ids = []
        async with async_session() as db:
            for p in places:
                pid = p.get("placeId") or p.get("id") or ""
                if not pid:
                    pid = f"place_{hash(p.get('name', ''))}"

                place_ids.append(pid)

                # Upsert into places_cache
                existing = await db.execute(
                    select(PlacesCache).where(PlacesCache.place_id == pid)
                )
                existing_place = existing.scalar_one_or_none()

                coords = p.get("coordinates", {})
                if existing_place:
                    existing_place.access_count += 1
                    existing_place.last_accessed = _utcnow_naive()
                else:
                    db.add(PlacesCache(
                        place_id=pid,
                        name=p.get("name", ""),
                        address=p.get("address", ""),
                        city=city,
                        lat=coords.get("lat") or coords.get("latitude"),
                        lng=coords.get("lng") or coords.get("longitude"),
                        rating=p.get("rating"),
                        types=p.get("types", []),
                        description=p.get("description", ""),
                        photo_url=p.get("photo_url", ""),
                        website=p.get("website", ""),
                        phone=p.get("phone", ""),
                        search_query=query,
                        last_accessed=_utcnow_naive(),
                    ))

            # Upsert search_cache
            existing_search = await db.execute(
                select(SearchCache).where(SearchCache.query == query)
            )
            search_entry = existing_search.scalar_one_or_none()
            if search_entry:
                search_entry.place_ids = place_ids
                search_entry.expires_at = _utcnow_naive() + timedelta(days=CACHE_TTL_DAYS)
                search_entry.result_count = len(places)
            else:
                db.add(SearchCache(
                    query=query,
                    city=city,
                    result_count=len(places),
                    place_ids=place_ids,
                    expires_at=_utcnow_naive() + timedelta(days=CACHE_TTL_DAYS),
                ))

            await db.commit()

        logger.info(f"[PLACES_SEARCH] Cached {len(places)} places for '{query}'")

    async def _search_mcp(self, query: str, city: str, limit: int) -> list[dict]:
        """Search via Google Maps MCP (Grounding Lite)."""
        try:
            results = await maps_mcp.search_places(query, language_code="en")
            if results:
                for r in results:
                    if not r.get("city"):
                        r["city"] = city
                return results
        except Exception as e:
            logger.warning(f"[PLACES_SEARCH] MCP search failed: {e}")
        return []

    async def _search_google_places(self, query: str, city: str, limit: int) -> list[dict]:
        """Search via Google Places API directly."""
        try:
            results = await google_places.search_places(query)
            if results:
                for r in results:
                    r["city"] = city
                return results
        except Exception as e:
            logger.warning(f"[PLACES_SEARCH] Google Places API failed: {e}")
        return []

    async def _search_opentripmap(self, query: str, city: str, limit: int) -> list[dict]:
        """Search via OpenTripMap API.

        OpenTripMap's /geoname endpoint is a geocoder — it expects a city
        name like "Tokyo", not a full query like "best attractions in Tokyo".
        We geocode using the city parameter, then fetch places in radius.
        """
        try:
            # Use the city name for geocoding, not the full text query.
            # If city is empty, fall back to extracting it from the query.
            geoname = city or query
            results = await places_service.search_places(geoname, limit=limit)
            if results:
                for r in results:
                    coords = r.get("coordinates", {})
                    r["placeId"] = r.get("id", "")
                    r["coordinates"] = {"lat": coords.get("lat", 0), "lng": coords.get("lon", 0)}
                    r["city"] = city
                return results
        except Exception as e:
            logger.warning(f"[PLACES_SEARCH] OpenTripMap failed: {e}")
        return []

    def _orm_to_dict(self, place: PlacesCache) -> dict:
        """Convert PlacesCache ORM to dict."""
        return {
            "placeId": place.place_id,
            "name": place.name,
            "address": place.address or "",
            "city": place.city,
            "coordinates": {"lat": place.lat or 0, "lng": place.lng or 0},
            "rating": place.rating,
            "types": place.types or [],
            "description": place.description or "",
            "photo_url": place.photo_url or "",
            "website": place.website or "",
            "phone": place.phone or "",
        }


places_search = PlacesSearchService()
