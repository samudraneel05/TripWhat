"""Unified itinerary builder — replaces both enhancedItineraryBuilder.ts and itineraryBuilder.ts.

Uses a search → curate → enrich pipeline:
  1. Generate procedural queries (no LLM tokens for search)
  2. Search via places_search service (cache-first, MCP → Google Places → OpenTripMap)
  3. LLM curates the best 3 activities per day from real search results
  4. Build itinerary with real place data (coordinates, ratings, descriptions)
"""

import asyncio
import os
import re
from datetime import datetime, timedelta
from functools import partial
from typing import Any

from langchain_openai import ChatOpenAI

from app.config import settings
from app.schemas.itinerary import (
    TimeSlot, Activity, ActivityLocation, HotelRecommendation, RestaurantRecommendation, FlightOption,
    create_itinerary,
)
from app.services.places_search import places_search
from app.services.distance_matrix import distance_matrix
from app.services.llm_json import parse_json_robust
from app.services.query_generator import generate_queries, generate_hotel_queries, generate_restaurant_queries, generate_personalized_queries, generate_llm_queries
from app.utils.logger import logger


def _slugify(text: str) -> str:
    """Stable slug for progress-event task_ids (e.g. 'New York' → 'new_york')."""
    return re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_") or "task"


def _max_concurrency() -> int:
    """Max concurrent outbound calls/units — env ITINERARY_MAX_CONCURRENCY, default 5."""
    try:
        return max(1, int(os.getenv("ITINERARY_MAX_CONCURRENCY", "5")))
    except (TypeError, ValueError):
        return 5


ITINERARY_MAX_CONCURRENCY = _max_concurrency()

# Bounds concurrent outbound calls (LLM ainvoke, places searches,
# distance-matrix batches, photo resolution, SerpApi calls).
_API_SEMAPHORE = asyncio.Semaphore(ITINERARY_MAX_CONCURRENCY)

# Bounds concurrent units of work (per-day pipelines, per-city searches).
_UNIT_SEMAPHORE = asyncio.Semaphore(ITINERARY_MAX_CONCURRENCY)


async def _with_api_sem(call):
    """Run a zero-arg awaitable factory under the global outbound-call limit.

    Takes a callable (e.g. functools.partial) rather than a coroutine so the
    inner coroutine is only created once a semaphore permit is held.
    """
    async with _API_SEMAPHORE:
        return await call()


async def _bounded_gather(aws, return_exceptions: bool = False):
    """asyncio.gather where each awaitable runs under _UNIT_SEMAPHORE.

    Results are returned in the order of `aws`, not completion order.
    """
    async def _run(aw):
        async with _UNIT_SEMAPHORE:
            return await aw
    return await asyncio.gather(
        *(_run(aw) for aw in aws), return_exceptions=return_exceptions
    )


async def _emit(status_cb, event: dict) -> None:
    """Emit a structured progress event; no-op when status_cb is None or raises."""
    if not status_cb:
        return
    try:
        await status_cb(event)
    except Exception as e:
        logger.warning(f"[ITINERARY_BUILDER] status_cb emit failed: {e}")


async def _tracked(status_cb, event_base: dict, aw):
    """Emit state:start before awaiting `aw` and state:end after it finishes."""
    await _emit(status_cb, {**event_base, "state": "start"})
    try:
        return await aw
    finally:
        await _emit(status_cb, {**event_base, "state": "end"})


def _extract_content(response) -> str:
    """Extract text content from an LLM response, handling both string and
    list-of-content-blocks formats.

    OpenAI models sometimes return content as a list of blocks:
    [{'type': 'text', 'text': '...'}, {'type': 'text', 'text': '...'}]
    instead of a plain string. This extracts and concatenates all text blocks.
    """
    content = response.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return str(content)


TIME_BUDGETS = {
    "relaxed": {"morning": 3, "afternoon": 3, "evening": 2},
    "moderate": {"morning": 4, "afternoon": 4, "evening": 3},
    "packed": {"morning": 5, "afternoon": 5, "evening": 4},
}

TYPE_DURATIONS = {
    "museum": 2.5, "art_gallery": 1.5, "park": 1.5, "temple": 1.0,
    "shrine": 0.5, "shopping_mall": 2.0, "restaurant": 1.5, "cafe": 0.75,
    "landmark": 0.5, "historical_site": 1.5, "market": 1.0, "garden": 1.0,
    "amusement_park": 5.0, "zoo": 3.0, "aquarium": 2.0, "beach": 3.0,
    "hiking_trail": 4.0, "viewpoint": 0.5, "neighborhood": 2.0,
    "night_club": 2.0, "bar": 1.5, "tourist_attraction": 2.0,
    "point_of_interest": 1.5, "natural_feature": 1.5, "church": 1.0,
    "castle": 2.0, "monument": 0.5, "square": 0.5, "palace": 2.0,
    # Expanded granular types
    "art_museum": 2.0, "history_museum": 3.0, "national_park": 4.0,
    "theme_park": 6.0, "cathedral": 1.5, "mosque": 1.0, "synagogue": 1.0,
    "library": 1.5, "university": 1.5, "stadium": 2.5, "bridge": 0.5,
    "fountain": 0.25, "sculpture": 0.25, "art_studio": 1.0,
    "book_store": 0.5, "clothing_store": 0.75, "electronics_store": 0.5,
    "bakery": 0.5, "meal_takeaway": 0.5, "meal_delivery": 0.5,
    "movie_theater": 2.5, "performing_arts_theater": 2.5, "concert_hall": 3.0,
    "spa": 2.0, "gym": 1.5, "bowling_alley": 1.5, "casino": 3.0,
    "campground": 8.0, "rv_park": 8.0, "ski_resort": 5.0,
    "marina": 1.5, "pier": 1.0, "port": 1.0, "harbor": 1.0,
    "waterfall": 1.5, "mountain": 4.0, "canyon": 3.0, "cave": 2.0,
    "forest": 2.5, "lake": 2.0, "river": 2.0, "island": 4.0,
    "botanical_garden": 2.0, "memorial_park": 1.0, "national_monument": 1.5,
}


class ItineraryBuilder:
    def __init__(self):
        self._model = None

    @property
    def model(self):
        if self._model is None:
            self._model = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)
        return self._model

    async def build(self, ctx: dict, status_cb=None) -> dict | None:
        cities = ctx.get("cities")
        await _emit(status_cb, {
            "phase": "build_start", "state": "start", "group": "extras",
            "cities": [c.get("name") for c in (cities or [])],
        })
        if cities and len(cities) > 0:
            if ctx.get("include_travel_means"):
                result = await self._build_with_travel_means(ctx, status_cb)
            else:
                result = await self._build_multi_city(ctx, status_cb)
        else:
            result = await self._build_single_city(ctx, status_cb)
        await _emit(status_cb, {"phase": "build_complete", "state": "end", "group": "extras"})
        return result

    async def _search_all_places_for_city(
        self,
        city: str,
        trip_style: str,
        help_with: list[str] | None,
        total_days: int,
        user_memories: list[dict] | None = None,
        traveler_type: str | None = None,
        user_interests: list[str] | None = None,
        preferences: list[str] | None = None,
        dates: dict | str | None = None,
        status_cb=None,
    ) -> list[dict]:
        """Search for all real places in a city (across all days).

        Generates queries for the full trip and searches once, returning
        a deduplicated pool of places. This pool is then clustered by
        geographic proximity so each day gets nearby places.

        Queries are hybrid: the zero-token procedural templates plus one
        cached LLM call (generate_llm_queries) for destination-specific
        coverage — seasonality, signature experiences, neighborhoods.
        """
        # Generate a broad set of queries covering the whole trip
        if user_memories or traveler_type or user_interests:
            queries = generate_personalized_queries(
                city, trip_style, help_with, 1, total_days,
                user_memories=user_memories,
                traveler_type=traveler_type,
                user_interests=user_interests,
            )
        else:
            queries = generate_queries(city, trip_style, help_with, 1, total_days)

        # Hybrid: LLM-generated destination-specific queries alongside the
        # procedural base (cached per city+style+month; returns [] on failure).
        llm_queries = await generate_llm_queries(
            city,
            trip_style=trip_style,
            preferences=preferences,
            dates=dates,
            traveler_type=traveler_type,
        )
        queries = list(dict.fromkeys(queries + llm_queries))  # dedup preserving order

        logger.info(f"[ITINERARY_BUILDER] Searching {len(queries)} queries for {city}: {queries}")
        places = await _tracked(
            status_cb,
            {
                "phase": "search_places",
                "task_id": f"search_{_slugify(city)}",
                "city": city,
                "group": "place_search",
                "detail": f"{len(queries)} queries",
            },
            _with_api_sem(partial(places_search.search_multiple, queries, city, limit_per_query=10)),
        )

        # Deduplicate by placeId
        seen_ids = set()
        seen_names = set()
        unique = []
        for p in places:
            pid = p.get("placeId", "")
            name = p.get("name", "").lower()
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                seen_names.add(name)
                unique.append(p)
            elif name and name not in seen_names:
                seen_names.add(name)
                unique.append(p)

        logger.info(f"[ITINERARY_BUILDER] Found {len(unique)} unique places for {city}")
        return unique

    async def _search_and_curate_activities(
        self,
        city: str,
        day_num: int,
        total_days: int,
        trip_style: str,
        help_with: list[str] | None,
        all_city_names: list[str],
        used_names: list[str] | None = None,
        user_memories: list[dict] | None = None,
        traveler_type: str | None = None,
        user_interests: list[str] | None = None,
        day_places: list[dict] | None = None,
        preferences: list[str] | None = None,
        dates: dict | str | None = None,
    ) -> list[dict]:
        """Search for real places and use LLM to curate activities for the day.

        If day_places is provided (a pre-clustered subset), uses those directly.
        Otherwise, searches and uses all results (legacy behavior).

        1. Generate procedural queries (zero LLM tokens) + cached LLM queries
        2. Search via places_search (cache-first, with photo resolution)
        3. LLM picks 2-5 activities from real results based on time budget
        """
        # If a pre-clustered subset is provided, use it directly
        if day_places is not None:
            places = day_places
            if not places:
                logger.warning(f"[ITINERARY_BUILDER] Empty cluster for {city} day {day_num}, using LLM fallback")
                return self._llm_fallback_activities(city, day_num, total_days, trip_style)
        else:
            # Legacy: search per day (no clustering)
            if user_memories or traveler_type or user_interests:
                queries = generate_personalized_queries(
                    city, trip_style, help_with, day_num, total_days,
                    user_memories=user_memories,
                    traveler_type=traveler_type,
                    user_interests=user_interests,
                )
            else:
                queries = generate_queries(city, trip_style, help_with, day_num, total_days)

            # Hybrid: cached destination-specific LLM queries, same as
            # _search_all_places_for_city (cache hit when that already ran).
            llm_queries = await generate_llm_queries(
                city,
                trip_style=trip_style,
                preferences=preferences,
                dates=dates,
                traveler_type=traveler_type,
            )
            queries = list(dict.fromkeys(queries + llm_queries))  # dedup preserving order
            logger.info(f"[ITINERARY_BUILDER] Generated {len(queries)} queries for {city} day {day_num}: {queries}")

            # Step 2: Search for real places (cache-first, with photos)
            places = await _with_api_sem(partial(places_search.search_multiple, queries, city, limit_per_query=10))

            if not places:
                logger.warning(f"[ITINERARY_BUILDER] No places found for {city}, using LLM fallback")
                return self._llm_fallback_activities(city, day_num, total_days, trip_style)

        # Step 3: LLM curation — pick best activities from real results
        return await self._curate_activities_llm(places, city, day_num, total_days, trip_style, all_city_names, used_names)

    def _estimate_duration(self, place: dict) -> float:
        """Estimate visit duration in hours based on place types."""
        types = place.get("types", [])
        durations = [TYPE_DURATIONS.get(t, 0) for t in types if t in TYPE_DURATIONS]
        return max(durations) if durations else 2.0

    def _cluster_places_by_proximity(
        self,
        places: list[dict],
        num_clusters: int,
    ) -> list[list[dict]]:
        """Group places into geographically coherent clusters using K-means.

        Each cluster represents one day's worth of places, ensuring the
        traveler doesn't jump between distant locations within a day.

        Seeding: the highest-rated places anchor each cluster centroid,
        so popular spots naturally become the focal point of each day.

        Args:
            places: List of place dicts with "coordinates" → {"lat", "lng"}
            num_clusters: Number of clusters (= number of days for this city)

        Returns:
            List of clusters, each a list of place dicts.
        """
        if not places:
            return []
        if num_clusters <= 1 or len(places) <= num_clusters:
            # Can't cluster meaningfully — return single cluster or split evenly
            if num_clusters <= 1:
                return [places]
            # Split into roughly equal chunks
            chunks = []
            chunk_size = max(1, len(places) // num_clusters)
            for i in range(0, len(places), chunk_size):
                chunks.append(places[i:i + chunk_size])
            while len(chunks) < num_clusters:
                chunks.append([])
            return chunks[:num_clusters]

        # Extract coordinates
        coords = []
        valid_places = []
        for p in places:
            c = p.get("coordinates") or {}
            lat = c.get("lat")
            lng = c.get("lng")
            if lat is not None and lng is not None and lat != 0 and lng != 0:
                coords.append((lat, lng))
                valid_places.append(p)

        if len(valid_places) < num_clusters:
            # Not enough geocoded places — fall back to even split
            return self._cluster_places_by_proximity(places, 1) if num_clusters > 1 else [places]

        # Seed centroids with highest-rated places (spread across the area)
        rated = sorted(valid_places, key=lambda p: p.get("rating") or 0, reverse=True)
        centroids = []
        for i in range(num_clusters):
            idx = int(i * len(rated) / num_clusters)
            p = rated[idx]
            c = p.get("coordinates") or {}
            centroids.append((c.get("lat", 0), c.get("lng", 0)))

        # K-means iterations (simple, no numpy dependency)
        assignments = [0] * len(valid_places)
        for _iteration in range(10):
            changed = False
            for i, (lat, lng) in enumerate(coords):
                best_cluster = 0
                best_dist = float("inf")
                for j, (clat, clng) in enumerate(centroids):
                    dist = (lat - clat) ** 2 + (lng - clng) ** 2
                    if dist < best_dist:
                        best_dist = dist
                        best_cluster = j
                if assignments[i] != best_cluster:
                    assignments[i] = best_cluster
                    changed = True

            # Recompute centroids
            for j in range(num_clusters):
                members = [coords[i] for i in range(len(coords)) if assignments[i] == j]
                if members:
                    centroids[j] = (
                        sum(m[0] for m in members) / len(members),
                        sum(m[1] for m in members) / len(members),
                    )

            if not changed:
                break

        # Build clusters
        clusters: list[list[dict]] = [[] for _ in range(num_clusters)]
        for i, p in enumerate(valid_places):
            clusters[assignments[i]].append(p)

        # Merge tiny clusters (< 2 places) into nearest cluster
        merged = []
        small = []
        for j, cluster in enumerate(clusters):
            if len(cluster) < 2:
                small.extend(cluster)
            else:
                merged.append(cluster)

        if small:
            if merged:
                merged[-1].extend(small)
            else:
                merged.append(small)

        # Pad with empty lists if we have fewer clusters than days
        while len(merged) < num_clusters:
            merged.append([])

        logger.info(
            f"[ITINERARY_BUILDER] Clustered {len(valid_places)} places into "
            f"{len(merged)} clusters: {[len(c) for c in merged]}"
        )
        return merged

    def _pace_to_budget(self, trip_style: str) -> dict:
        """Map trip style to time budget per period."""
        pace_map = {
            "relaxed": "relaxed",
            "balanced": "moderate",
            "moderate": "moderate",
            "packed": "packed",
            "adventure": "packed",
            "fast": "packed",
        }
        pace = pace_map.get(trip_style, "moderate")
        return TIME_BUDGETS.get(pace, TIME_BUDGETS["moderate"])

    async def _curate_activities_llm(
        self,
        places: list[dict],
        city: str,
        day_num: int,
        total_days: int,
        trip_style: str,
        all_cities: list[str],
        used_names: list[str] | None = None,
    ) -> list[dict]:
        """Use LLM to pick 2-5 activities from real search results based on time budget."""
        is_first_day = day_num == 1
        is_last_day = day_num == total_days
        budget = self._pace_to_budget(trip_style)
        total_budget = sum(budget.values())

        # Format places for the LLM with estimated durations and coordinates
        places_text = []
        for i, p in enumerate(places):
            name = p.get("name", "Unknown")
            rating = p.get("rating", "N/A")
            ptype = ", ".join(p.get("types", [])[:3]) if p.get("types") else "attraction"
            desc = p.get("description", "")[:100]
            est_dur = self._estimate_duration(p)
            coords = p.get("coordinates", {})
            lat = coords.get("lat", 0) if coords else 0
            lng = coords.get("lng", 0) if coords else 0
            places_text.append(f"{i+1}. {name} (rating: {rating}, type: {ptype}, est: {est_dur}h, lat: {lat:.4f}, lng: {lng:.4f}) — {desc}")

        places_str = "\n".join(places_text)

        used_clause = ""
        if used_names:
            used_clause = f". Places already used (DO NOT pick these again): {', '.join(used_names)}"

        first_day_note = "\n- This is the first day — keep it lighter for arrival." if is_first_day else ""
        last_day_note = "\n- This is the last day — wrap up before departure." if is_last_day else ""
        other_cities = f"\n- Other cities on this trip: {', '.join(c for c in all_cities if c != city)}" if len(all_cities) > 1 else ""

        prompt = f"""\
You are a travel itinerary planner for Day {day_num} of a trip to {city}.

Trip pace: {trip_style} (time budget: morning={budget['morning']}h, afternoon={budget['afternoon']}h, evening={budget['evening']}h, total={total_budget}h)

Here are {len(places)} real places found via Google Maps search:
{places_str}

Trip context:
- City: {city}
- Day {day_num} of {total_days}
- Trip style: {trip_style}{first_day_note}{last_day_note}{other_cities}

Rules:
1. GROUP places by geographic proximity — pick places that are close together so the traveler minimizes transit time. Use the lat/lng coordinates to cluster nearby places.
2. Order the selected places in a logical walking/route order (nearest to farthest from a starting point, minimizing backtracking).
3. Select 2-5 different places from the list above (use the exact name)
4. Assign each to morning, afternoon, or evening
5. The total estimated duration should fit within the time budget for each period
6. Consider variety (don't pick 3 museums or 3 restaurants)
7. Write a one-sentence description for each
8. Set a realistic duration_hours based on the place type (e.g., a cafe is 45min, a major museum is 3h)
9. Do NOT repeat places used on previous days{used_clause}

Respond with ONLY a JSON array of 2-5 objects:
[{{"period": "morning", "name": "<exact name from list>", "type": "<category>", "description": "<one sentence>", "duration": "<hours>", "duration_hours": <number>}}, ...]
"""

        try:
            async with _API_SEMAPHORE:
                response = await self.model.ainvoke([
                    {"role": "system", "content": "You are a knowledgeable travel planner. Always respond with valid JSON only."},
                    {"role": "user", "content": prompt},
                ])
            content = _extract_content(response)
            curated = parse_json_robust(content)
            if curated and isinstance(curated, list) and len(curated) >= 2:
                # Enrich curated activities with real place data
                enriched = await self._enrich_activities(curated, places)
                # Sort by proximity (greedy nearest-neighbor)
                return self._sort_by_proximity(enriched)
            else:
                logger.warning(f"[ITINERARY_BUILDER] LLM returned unparseable JSON, using fallback. Content: {content[:200]}")
        except Exception as e:
            logger.error(f"[ITINERARY_BUILDER] LLM curation failed: {e}")

        # Fallback: pick top 3 by rating (with dedup)
        return self._pick_top_3(places, used_names)

    async def _enrich_activities(self, curated: list[dict], places: list[dict]) -> list[dict]:
        """Enrich LLM-curated activities with real place data from search results.

        Resolves photo references to direct image URLs for each activity.
        """
        from app.services.google_places import google_places

        # Index places by lowercase name for O(1) matching
        places_by_name = {p.get("name", "").lower(): p for p in places if p.get("name")}

        enriched = []
        photo_tasks: list[tuple[dict, Any]] = []
        for c in curated:
            name = c.get("name", "")
            # Find matching place from search results
            matching = places_by_name.get(name.lower())
            if not matching:
                name_lower = name.lower()
                matching = next(
                    (p for pname, p in places_by_name.items() if name_lower and name_lower in pname),
                    None,
                )

            if matching:
                c["placeId"] = matching.get("placeId", "")
                c["coordinates"] = matching.get("coordinates", {})
                c["rating"] = matching.get("rating")
                c["address"] = matching.get("address", "")
                c["website"] = matching.get("website", "")
                c["phone"] = matching.get("phone", "")
                if not c.get("description"):
                    c["description"] = matching.get("description", "")

                # Resolve photo URL if it's a reference, not a direct URL
                photo_url = matching.get("photo_url", "")
                if photo_url and not photo_url.startswith("http"):
                    photo_tasks.append((c, _with_api_sem(partial(google_places.resolve_photo_url, photo_url))))
                else:
                    c["photo_url"] = photo_url or None

            enriched.append(c)

        # Resolve photo references in parallel
        if photo_tasks:
            resolved_urls = await asyncio.gather(
                *(task for _, task in photo_tasks), return_exceptions=True
            )
            for (c, _), resolved in zip(photo_tasks, resolved_urls):
                c["photo_url"] = resolved if isinstance(resolved, str) and resolved else None

        return enriched

    @staticmethod
    def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Approximate distance in km between two lat/lng points."""
        import math
        R = 6371.0
        dlat = math.radians(lat2 - lat1)
        dlng = math.radians(lng2 - lng1)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
        return R * 2 * math.asin(math.sqrt(a))

    def _sort_by_proximity(self, activities: list[dict]) -> list[dict]:
        """Sort activities by greedy nearest-neighbor using coordinates.

        Starts from the first activity and repeatedly picks the closest
        unvisited activity, producing a route that minimizes total transit.
        """
        if len(activities) <= 1:
            return activities

        def get_coords(a: dict) -> tuple[float, float]:
            c = distance_matrix._get_coords(a)
            return (c["lat"], c["lng"]) if c else (0.0, 0.0)

        result = [activities[0]]
        remaining = list(activities[1:])
        while remaining:
            last = get_coords(result[-1])
            nearest_idx = 0
            nearest_dist = float("inf")
            for i, a in enumerate(remaining):
                coords = get_coords(a)
                dist = self._haversine_km(last[0], last[1], coords[0], coords[1])
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest_idx = i
            result.append(remaining.pop(nearest_idx))
        return result

    async def _compute_inter_activity_travel(
        self,
        activities: list[dict],
        travel_mode: str = "walking",
    ) -> list[dict]:
        """Compute travel times between consecutive activities.

        For activities [A, B, C], computes A→B and B→C via Distance Matrix API.
        Attaches travelInfo to each activity (except the last) and returns
        the activities list with travel info populated.

        The travel mode is chosen per-pair based on distance:
          - < 2 km: walking (or user's preferred mode)
          - 2–50 km: driving
          - 50–300 km: driving (highway)
          - > 300 km: flight

        Falls back to haversine + assumed speed if Distance Matrix fails.

        Args:
            activities: List of activity dicts (already sorted by proximity)
            travel_mode: User's preferred intra-city mode ("walking" or "driving")

        Returns:
            The same activities list with "travelInfo" added to each activity
            (except the last one, which has no "next" activity).
        """
        if len(activities) <= 1:
            return activities

        # Determine the mode for each consecutive pair based on haversine distance
        pair_modes: list[str] = []
        for i in range(len(activities) - 1):
            pair_modes.append(self._pick_travel_mode(activities[i], activities[i + 1], travel_mode))

        # Batch the API calls by mode to minimize requests
        # Group pair indices by mode
        mode_groups: dict[str, list[int]] = {}
        for i, mode in enumerate(pair_modes):
            mode_groups.setdefault(mode, []).append(i)

        # For each mode group, call the Distance Matrix API
        # Build a results array aligned to pair indices
        pair_results: list[dict | None] = [None] * len(pair_modes)

        for mode, indices in mode_groups.items():
            if mode == "flight":
                # No Distance Matrix API for flights — use haversine + flight speed
                for i in indices:
                    pair_results[i] = self._flight_estimate(activities[i], activities[i + 1])
                continue

            pairs = []
            for i in indices:
                origin_coords = distance_matrix._get_coords(activities[i])
                dest_coords = distance_matrix._get_coords(activities[i + 1])
                if origin_coords and dest_coords:
                    pairs.append({"origin": origin_coords, "destination": dest_coords})
                else:
                    pairs.append(None)

            valid_pairs = [p for p in pairs if p is not None]
            if valid_pairs:
                valid_results = await _with_api_sem(partial(distance_matrix.compute_travel_times, valid_pairs, mode=mode))
                vi = 0
                for j, i in enumerate(indices):
                    if pairs[j] is not None and vi < len(valid_results):
                        pair_results[i] = valid_results[vi]
                        vi += 1

        # Attach travel info to activities
        for i, activity in enumerate(activities):
            if i >= len(pair_results) or pair_results[i] is None:
                # Fallback: haversine + assumed speed
                mode = pair_modes[i] if i < len(pair_modes) else travel_mode
                self._add_haversine_fallback(activity, activities, i, mode)
                continue

            travel = pair_results[i]
            if travel and travel.get("durationSeconds", 0) > 0:
                mode = pair_modes[i]
                duration_text = distance_matrix.format_duration_text(travel["durationSeconds"])
                distance_text = distance_matrix.format_distance_text(travel["distanceMeters"])
                activity["travelInfo"] = {
                    "mode": mode,
                    "durationSeconds": travel["durationSeconds"],
                    "durationText": duration_text,
                    "distanceText": distance_text,
                    "distanceMeters": travel["distanceMeters"],
                }
                activity["distanceToNext"] = f"{duration_text} {mode} · {distance_text}"
            else:
                mode = pair_modes[i]
                self._add_haversine_fallback(activity, activities, i, mode)

        return activities

    def _pick_travel_mode(self, origin: dict, dest: dict, user_mode: str) -> str:
        """Pick the best travel mode for a pair based on haversine distance.

        - < 2 km: user's preferred mode (walking/driving)
        - 2–50 km: driving
        - 50–300 km: driving (highway speeds)
        - > 300 km: flight
        """
        origin_coords = distance_matrix._get_coords(origin)
        dest_coords = distance_matrix._get_coords(dest)
        if not origin_coords or not dest_coords:
            return user_mode

        km = self._haversine_km(
            origin_coords["lat"], origin_coords["lng"],
            dest_coords["lat"], dest_coords["lng"],
        )
        if km > 300:
            return "flight"
        if km > 2:
            return "driving"
        return user_mode

    def _flight_estimate(self, origin: dict, dest: dict) -> dict:
        """Estimate flight time + distance for long-distance pairs."""
        origin_coords = distance_matrix._get_coords(origin)
        dest_coords = distance_matrix._get_coords(dest)
        if not origin_coords or not dest_coords:
            return {"distanceMeters": 0, "durationSeconds": 0, "mode": "flight"}

        km = self._haversine_km(
            origin_coords["lat"], origin_coords["lng"],
            dest_coords["lat"], dest_coords["lng"],
        )
        # Flight time: 2h base (check-in, boarding, taxi) + ~800 km/h cruise
        flight_hours = 2.0 + (km / 800.0)
        seconds = int(flight_hours * 3600)
        meters = int(km * 1000)
        return {"distanceMeters": meters, "durationSeconds": seconds, "mode": "flight"}

    def _add_haversine_fallback(
        self,
        activity: dict,
        all_activities: list[dict],
        index: int,
        mode: str,
    ) -> None:
        """Add a rough travel time estimate using haversine distance.

        Assumes walking speed of 5 km/h, driving speed of 30 km/h (city)
        or 80 km/h (highway for >50 km), or flight speed of 800 km/h + 2h overhead.
        """
        if index >= len(all_activities) - 1:
            return  # last activity, no next

        origin = distance_matrix._get_coords(activity)
        dest = distance_matrix._get_coords(all_activities[index + 1])
        if not origin or not dest:
            return

        km = self._haversine_km(origin["lat"], origin["lng"], dest["lat"], dest["lng"])
        if mode == "flight":
            speed_kmh = 800.0
            seconds = int((km / speed_kmh) * 3600) + 2 * 3600  # +2h overhead
        elif mode == "driving":
            speed_kmh = 80.0 if km > 50 else 30.0
            seconds = int((km / speed_kmh) * 3600)
        else:
            speed_kmh = 5.0
            seconds = int((km / speed_kmh) * 3600)
        meters = int(km * 1000)

        if seconds > 0:
            duration_text = distance_matrix.format_duration_text(seconds)
            distance_text = distance_matrix.format_distance_text(meters)
            activity["travelInfo"] = {
                "mode": mode,
                "durationSeconds": seconds,
                "durationText": duration_text,
                "distanceText": distance_text,
                "distanceMeters": meters,
            }
            activity["distanceToNext"] = f"{duration_text} {mode} · {distance_text}"

    def _pick_top_3(self, places: list[dict], used_names: list[str] | None = None) -> list[dict]:
        """Fallback: pick top 3 places by rating, excluding already-used names."""
        used_lower = {n.lower() for n in (used_names or [])}
        sorted_places = sorted(places, key=lambda p: p.get("rating") or 0, reverse=True)
        # Filter out already-used places
        available = [p for p in sorted_places if p.get("name", "").lower() not in used_lower]
        # If everything was used, fall back to the full list (better than empty)
        if len(available) < 3:
            available = sorted_places
        periods = ["morning", "afternoon", "evening"]
        result = []
        for i, p in enumerate(available[:3]):
            result.append({
                "period": periods[i],
                "name": p.get("name", "Free time"),
                "type": ", ".join(p.get("types", [])[:2]) if p.get("types") else "attraction",
                "description": p.get("description", "")[:100],
                "duration": "2-3 hours",
                "placeId": p.get("placeId", ""),
                "coordinates": p.get("coordinates", {}),
                "rating": p.get("rating"),
                "address": p.get("address", ""),
                "photo_url": p.get("photo_url", ""),
            })
        return result

    def _llm_fallback_activities(self, city: str, day_num: int, total_days: int, trip_style: str) -> list[dict]:
        """Last resort: generate generic activities without real place data."""
        return [
            {"period": "morning", "name": f"Explore {city}", "type": "sightseeing", "description": f"Start your day exploring the highlights of {city}.", "duration": "2-3 hours"},
            {"period": "afternoon", "name": f"Local experience in {city}", "type": "culture", "description": f"Immerse yourself in the local culture and cuisine of {city}.", "duration": "2-3 hours"},
            {"period": "evening", "name": f"Evening in {city}", "type": "relaxation", "description": f"Wind down and enjoy the evening atmosphere of {city}.", "duration": "1-2 hours"},
        ]

    def _activity_to_time_slot(self, act_data: dict, prev_end: str = "09:00", travel_seconds: int = 0) -> TimeSlot:
        """Convert an activity dict to a TimeSlot with a populated Activity.

        Calculates startTime/endTime from duration_hours if available,
        chaining from the previous activity's end time. If travel_seconds
        is provided, adds a travel gap before this activity starts.
        """
        period = act_data.get("period", "morning")
        coords = act_data.get("coordinates", {})
        photo_url = act_data.get("photo_url") or act_data.get("imageUrl")
        travel_info = act_data.get("travelInfo")

        # Add travel gap from previous activity
        start_time = act_data.get("startTime") or prev_end
        if travel_seconds and travel_seconds > 0:
            start_time = self._add_seconds(start_time, travel_seconds)

        # Calculate time range from duration_hours
        duration_hours = act_data.get("duration_hours")
        if duration_hours:
            # Clamp to reasonable range (0.25h - 6h)
            duration_hours = max(0.25, min(6.0, float(duration_hours)))
            end_time = self._add_hours(start_time, duration_hours)
        else:
            end_time = act_data.get("endTime") or self._default_end_time(period)

        activity = Activity(
            name=act_data.get("name", "Free time"),
            title=act_data.get("name", "Free time"),
            type=act_data.get("type", ""),
            description=act_data.get("description", ""),
            duration=act_data.get("duration", ""),
            rating=act_data.get("rating"),
            placeId=act_data.get("placeId"),
            address=act_data.get("address"),
            coordinates=coords if coords else None,
            imageUrl=photo_url,
            photos=[photo_url] if photo_url else None,
            location=ActivityLocation(
                name=act_data.get("name", ""),
                address=act_data.get("address", ""),
                coordinates=coords if coords else {"lat": 0, "lng": 0},
            ),
            websiteUrl=act_data.get("website"),
            phoneNumber=act_data.get("phone"),
            travelInfo=travel_info,
            distanceToNext=act_data.get("distanceToNext"),
        )
        return TimeSlot(
            period=period,
            startTime=start_time,
            endTime=end_time,
            activity=activity,
            label=period.capitalize(),
            time=f"{start_time}-{end_time}",
            activities=[activity],
        )

    @staticmethod
    def _add_seconds(time_str: str, seconds: int) -> str:
        """Add seconds to a HH:MM time string, returning HH:MM."""
        try:
            h, m = map(int, time_str.split(":"))
            total = h * 60 + m + seconds // 60
            total = total % (24 * 60)
            return f"{total // 60:02d}:{total % 60:02d}"
        except Exception:
            return time_str

    @staticmethod
    def _add_hours(time_str: str, hours: float) -> str:
        """Add hours to a HH:MM time string, returning HH:MM."""
        try:
            h, m = map(int, time_str.split(":"))
            total = h * 60 + m + int(hours * 60)
            total = total % (24 * 60)
            return f"{total // 60:02d}:{total % 60:02d}"
        except Exception:
            return "18:00"

    @staticmethod
    def _default_end_time(period: str) -> str:
        """Default end time for a period when no duration is specified."""
        defaults = {"morning": "12:00", "afternoon": "18:00", "evening": "22:00"}
        return defaults.get(period, "18:00")

    def _reconcile_used_names(
        self,
        activities: list[dict],
        day_places: list[dict] | None,
        used_names: set[str],
    ) -> list[dict]:
        """Post-hoc dedup for days curated in parallel.

        Parallel day builds can't see each other's picks, so the same place
        may be selected on two days. Walk the day's activities; for any name
        already claimed by an earlier day, swap in the highest-rated unused
        place from this day's cluster. Names this day uses are recorded in
        `used_names` (call once per day, in day order).
        """
        if not activities:
            return activities
        picked = {a.get("name", "").lower() for a in activities if a.get("name")}
        candidates = sorted(
            (
                p for p in (day_places or [])
                if p.get("name")
                and p["name"].lower() not in used_names
                and p["name"].lower() not in picked
            ),
            key=lambda p: p.get("rating") or 0,
            reverse=True,
        )
        for i, act in enumerate(activities):
            name = act.get("name", "")
            if not name:
                continue
            if name.lower() not in used_names:
                used_names.add(name.lower())
                continue
            # Duplicate of an earlier day's pick — try to swap it out
            if not candidates:
                continue  # no replacement available; keep the pick
            p = candidates.pop(0)
            activities[i] = {
                "period": act.get("period", "morning"),
                "name": p.get("name", name),
                "type": ", ".join(p.get("types", [])[:2]) if p.get("types") else act.get("type", "attraction"),
                "description": p.get("description", "")[:100] or act.get("description", ""),
                "duration": act.get("duration", "2-3 hours"),
                "placeId": p.get("placeId", ""),
                "coordinates": p.get("coordinates", {}),
                "rating": p.get("rating"),
                "address": p.get("address", ""),
                "photo_url": p.get("photo_url", ""),
            }
            used_names.add(activities[i]["name"].lower())
        return activities

    async def _build_single_city(self, ctx: dict, status_cb=None) -> dict:
        destination = ctx["destination"]
        duration = ctx["duration"]
        if status_cb:
            await status_cb({"phase": "activities", "city": destination, "day": 1, "totalDays": duration})
        start_date = ctx.get("startDate")
        trip_style = ctx.get("tripStyle", "balanced")
        help_with = ctx.get("helpWith", [])
        user_memories = ctx.get("userMemories")
        traveler_type = ctx.get("travelerType")
        user_interests = ctx.get("userInterests")
        travel_mode = ctx.get("travelMode", "walking")

        itinerary = create_itinerary(destination, duration, start_date)

        if ctx.get("preferences"):
            itinerary.tripMetadata.preferences = ctx["preferences"]
        if ctx.get("travelType"):
            itinerary.tripMetadata.travelType = ctx["travelType"]

        # Search all places for the city once, then cluster by proximity
        all_places = await self._search_all_places_for_city(
            destination, trip_style, help_with, duration,
            user_memories=user_memories, traveler_type=traveler_type, user_interests=user_interests,
            preferences=ctx.get("preferences"), dates=ctx.get("startDate"),
            status_cb=status_cb,
        )
        clusters = self._cluster_places_by_proximity(all_places, duration) if all_places else []

        city_slug = _slugify(destination)
        num_days = len(itinerary.days)
        for i, day in enumerate(itinerary.days):
            day.subtitle = self._generate_day_description(destination, i + 1, duration, trip_style)

        # Phase 1: curate all days concurrently (bounded). gather returns
        # results in day-index order regardless of completion order.
        async def _curate_day(i: int) -> list[dict]:
            day_num = i + 1
            day_cluster = clusters[i] if i < len(clusters) else None
            return await _tracked(
                status_cb,
                {
                    "phase": "curate_day",
                    "task_id": f"curate_{city_slug}_{day_num}",
                    "city": destination,
                    "day": day_num,
                    "group": "day_build",
                    "detail": f"{len(day_cluster or [])} places",
                },
                self._search_and_curate_activities(
                    destination, day_num, duration, trip_style, help_with,
                    [destination], None,
                    user_memories=user_memories, traveler_type=traveler_type,
                    user_interests=user_interests, day_places=day_cluster,
                    preferences=ctx.get("preferences"), dates=ctx.get("startDate"),
                ),
            )

        curated_results = await _bounded_gather(
            [_curate_day(i) for i in range(num_days)], return_exceptions=True
        )

        # Reconcile duplicate picks across days post-hoc, in day order.
        used_names: set[str] = set()
        day_activities: list[list[dict]] = []
        for i in range(num_days):
            res = curated_results[i]
            if isinstance(res, Exception):
                logger.error(f"[ITINERARY_BUILDER] Day {i + 1} curation failed: {res}")
                acts = self._llm_fallback_activities(destination, i + 1, duration, trip_style)
            else:
                acts = res
            day_cluster = clusters[i] if i < len(clusters) else None
            day_activities.append(self._reconcile_used_names(acts, day_cluster, used_names))

        # Phase 2: travel times + time-slot assembly per day, concurrently.
        async def _build_day_slots(i: int) -> None:
            day_num = i + 1
            day = itinerary.days[i]
            activities = await _tracked(
                status_cb,
                {
                    "phase": "travel_times",
                    "task_id": f"travel_{city_slug}_{day_num}",
                    "city": destination,
                    "day": day_num,
                    "group": "day_build",
                },
                self._compute_inter_activity_travel(day_activities[i], travel_mode),
            )
            # Chain time slots: each activity starts after the previous ends + travel time
            time_slots = []
            prev_end = "09:00"
            for a in activities:
                travel_info = a.get("travelInfo") or {}
                travel_sec = travel_info.get("durationSeconds", 0)
                slot = self._activity_to_time_slot(a, prev_end, travel_seconds=travel_sec)
                prev_end = slot.endTime
                time_slots.append(slot)
            day.timeSlots = time_slots
            await _emit(status_cb, {
                "phase": "day_complete",
                "state": "end",
                "task_id": f"curate_{city_slug}_{day_num}",
                "day": day.dayNumber,
                "city": destination,
                "group": "day_build",
                "timeSlots": [ts.model_dump() for ts in time_slots],
                "totalDays": duration,
            })

        slot_results = await _bounded_gather(
            [_build_day_slots(i) for i in range(num_days)], return_exceptions=True
        )
        for i, res in enumerate(slot_results):
            if isinstance(res, Exception):
                logger.error(f"[ITINERARY_BUILDER] Day {i + 1} slot build failed: {res}")

        # Fetch hotel/restaurant recommendations and flights concurrently
        (hotels, restaurants), flights = await asyncio.gather(
            _tracked(
                status_cb,
                {"phase": "hotels_restaurants", "task_id": f"hotels_{city_slug}",
                 "city": destination, "group": "extras"},
                self._search_hotels_and_restaurants(destination, ctx),
            ),
            _tracked(
                status_cb,
                {"phase": "flights", "task_id": f"flights_{city_slug}",
                 "city": destination, "group": "extras"},
                self._search_flights_for_trip(ctx),
            ),
        )
        itinerary.hotelRecommendations = hotels
        itinerary.restaurantRecommendations = restaurants
        itinerary.flightOptions = flights

        return {"itinerary": itinerary.model_dump()}

    async def _build_multi_city(self, ctx: dict, status_cb=None) -> dict:
        cities = ctx["cities"]
        total_days = ctx.get("totalDays") or sum(c["days"] for c in cities)
        if status_cb:
            await status_cb({"phase": "activities", "city": cities[0]["name"], "day": 1, "totalDays": total_days})
        start_date = ctx.get("startDate")
        trip_style = ctx.get("tripStyle", "balanced")
        help_with = ctx.get("helpWith", [])
        all_city_names = [c["name"] for c in cities]
        user_memories = ctx.get("userMemories")
        traveler_type = ctx.get("travelerType")
        user_interests = ctx.get("userInterests")
        travel_mode = ctx.get("travelMode", "walking")

        itinerary = create_itinerary(cities[0]["name"], total_days, start_date)

        # Phase 0: search + cluster all cities concurrently (bounded)
        async def _search_city(city: dict) -> list[list[dict]]:
            all_places = await self._search_all_places_for_city(
                city["name"], trip_style, help_with, total_days,
                user_memories=user_memories, traveler_type=traveler_type, user_interests=user_interests,
                preferences=ctx.get("preferences"), dates=ctx.get("startDate"),
                status_cb=status_cb,
            )
            return self._cluster_places_by_proximity(all_places, city["days"]) if all_places else []

        cluster_results = await _bounded_gather(
            [_search_city(c) for c in cities], return_exceptions=True
        )
        city_clusters: list[list[list[dict]]] = []
        for c, res in zip(cities, cluster_results):
            if isinstance(res, Exception):
                logger.error(f"[ITINERARY_BUILDER] Place search failed for {c['name']}: {res}")
                city_clusters.append([])
            else:
                city_clusters.append(res)

        # Assign day metadata and build the flat spec list (global_idx, city_idx, local_day)
        day_specs: list[tuple[int, int, int]] = []
        day_idx = 0
        for ci, city in enumerate(cities):
            for d in range(city["days"]):
                if day_idx < len(itinerary.days):
                    day = itinerary.days[day_idx]
                    day.location = city["name"]
                    day.title = f"Day {day_idx + 1} - {city['name']}"
                    day.subtitle = self._generate_day_description(city["name"], day_idx + 1, total_days, trip_style)
                    day_specs.append((day_idx, ci, d))
                day_idx += 1

        # Phase 1: curate every day of every city concurrently (bounded).
        # gather returns results aligned to day_specs order.
        async def _curate_day(gidx: int, ci: int, d: int) -> list[dict]:
            city = cities[ci]
            day_num = gidx + 1
            clusters = city_clusters[ci]
            day_cluster = clusters[d] if d < len(clusters) else None
            return await _tracked(
                status_cb,
                {
                    "phase": "curate_day",
                    "task_id": f"curate_{_slugify(city['name'])}_{day_num}",
                    "city": city["name"],
                    "day": day_num,
                    "group": "day_build",
                    "detail": f"{len(day_cluster or [])} places",
                },
                self._search_and_curate_activities(
                    city["name"], day_num, total_days, trip_style, help_with,
                    all_city_names, None,
                    user_memories=user_memories, traveler_type=traveler_type,
                    user_interests=user_interests, day_places=day_cluster,
                    preferences=ctx.get("preferences"), dates=ctx.get("startDate"),
                ),
            )

        curated_results = await _bounded_gather(
            [_curate_day(g, ci, d) for g, ci, d in day_specs], return_exceptions=True
        )

        # Reconcile duplicate picks post-hoc, in day order, per city.
        used_by_city: dict[int, set[str]] = {}
        day_activities: dict[int, list[dict]] = {}
        for (gidx, ci, d), res in zip(day_specs, curated_results):
            city = cities[ci]
            used = used_by_city.setdefault(ci, set())
            if isinstance(res, Exception):
                logger.error(f"[ITINERARY_BUILDER] Day {gidx + 1} curation failed: {res}")
                acts = self._llm_fallback_activities(city["name"], gidx + 1, total_days, trip_style)
            else:
                acts = res
            clusters = city_clusters[ci]
            day_cluster = clusters[d] if d < len(clusters) else None
            day_activities[gidx] = self._reconcile_used_names(acts, day_cluster, used)

        # Phase 2: travel times + time-slot assembly per day, concurrently.
        async def _build_day_slots(gidx: int, ci: int) -> None:
            city = cities[ci]
            day_num = gidx + 1
            slug = _slugify(city["name"])
            day = itinerary.days[gidx]
            activities = await _tracked(
                status_cb,
                {
                    "phase": "travel_times",
                    "task_id": f"travel_{slug}_{day_num}",
                    "city": city["name"],
                    "day": day_num,
                    "group": "day_build",
                },
                self._compute_inter_activity_travel(day_activities[gidx], travel_mode),
            )
            # Chain time slots: each activity starts after the previous ends + travel time
            time_slots = []
            prev_end = "09:00"
            for a in activities:
                travel_info = a.get("travelInfo") or {}
                travel_sec = travel_info.get("durationSeconds", 0)
                slot = self._activity_to_time_slot(a, prev_end, travel_seconds=travel_sec)
                prev_end = slot.endTime
                time_slots.append(slot)
            day.timeSlots = time_slots
            await _emit(status_cb, {
                "phase": "day_complete",
                "state": "end",
                "task_id": f"curate_{slug}_{day_num}",
                "day": day.dayNumber,
                "city": city["name"],
                "group": "day_build",
                "timeSlots": [ts.model_dump() for ts in time_slots],
                "totalDays": total_days,
            })

        slot_results = await _bounded_gather(
            [_build_day_slots(g, ci) for g, ci, _d in day_specs], return_exceptions=True
        )
        for (gidx, _ci, _d), res in zip(day_specs, slot_results):
            if isinstance(res, Exception):
                logger.error(f"[ITINERARY_BUILDER] Day {gidx + 1} slot build failed: {res}")

        if ctx.get("preferences"):
            itinerary.tripMetadata.preferences = ctx["preferences"]
        if ctx.get("travelType"):
            itinerary.tripMetadata.travelType = ctx["travelType"]

        # Fetch hotel/restaurant recommendations per city AND flights — all concurrent
        all_hotels: list[HotelRecommendation] = []
        all_restaurants: list[RestaurantRecommendation] = []
        city_results, flights = await asyncio.gather(
            asyncio.gather(
                *(
                    _tracked(
                        status_cb,
                        {"phase": "hotels_restaurants", "task_id": f"hotels_{_slugify(c['name'])}",
                         "city": c["name"], "group": "extras"},
                        self._search_hotels_and_restaurants(c["name"], ctx),
                    )
                    for c in cities
                ),
                return_exceptions=True,
            ),
            _tracked(
                status_cb,
                {"phase": "flights", "task_id": "flights",
                 "cities": [c["name"] for c in cities], "group": "extras"},
                self._search_flights_for_trip(ctx),
            ),
        )
        for res in city_results:
            if isinstance(res, Exception):
                logger.error(f"[ITINERARY_BUILDER] Hotel/restaurant search failed for a city: {res}")
                continue
            hotels, restaurants = res
            all_hotels.extend(hotels)
            all_restaurants.extend(restaurants)
        itinerary.hotelRecommendations = all_hotels
        itinerary.restaurantRecommendations = all_restaurants
        itinerary.flightOptions = flights

        return {"itinerary": itinerary.model_dump()}

    async def _build_with_travel_means(self, ctx: dict, status_cb=None) -> dict:
        result = await self._build_multi_city(ctx, status_cb)
        if not result:
            return None

        try:
            from app.services.travel_means import travel_means_service
            cities = ctx["cities"]
            start_location = ctx.get("startLocation")
            if isinstance(start_location, dict):
                start_location = start_location.get("name", cities[0]["name"])

            travel_means = await travel_means_service.calculate_travel_means(
                start_location=start_location or cities[0]["name"],
                cities=[c["name"] for c in cities],
                start_date=datetime.fromisoformat(ctx["startDate"]) if ctx.get("startDate") else datetime.now(),
                total_days=ctx.get("totalDays") or sum(c["days"] for c in cities),
                passengers=ctx.get("numberOfPeople", 1),
                preferences=ctx.get("travelPreferences"),
            )
            return {"itinerary": result["itinerary"], "travelMeans": travel_means}
        except Exception as e:
            logger.error(f"Travel means calculation failed: {e}")
            return result

    def _generate_day_description(self, city: str, day_num: int, total_days: int, trip_style: str = "balanced") -> str:
        style_hints = {
            "beaches": ["relax by the coast and enjoy the ocean breeze", "unwind by the water and soak up the sun", "take a leisurely stroll along the shore", "enjoy the beach at your own pace"],
            "culture": ["explore historic sites and immerse in local traditions", "wander through old quarters and discover hidden temples", "visit museums and learn the city's story", "experience the local arts and heritage scene"],
            "wellness": ["focus on rejuvenation and mindful exploration", "start the day with a calm walk and a healthy breakfast", "treat yourself to a spa session and quiet reflection", "find a peaceful spot and recharge"],
            "adventure": ["get outdoors and seek out active experiences", "challenge yourself with a hike or a water sport", "push your limits with something new", "explore the wilder side of the destination"],
            "food": ["discover local flavors and hidden culinary gems", "hunt down the best street food and local markets", "try a cooking class or a food tour", "dine where the locals dine"],
            "city": ["wander through neighborhoods and soak in the urban energy", "explore a different district and its character", "hop between cafes, shops, and galleries", "get lost in the city's rhythm"],
            "balanced": ["balance sightseeing with time to wander", "mix a must-see landmark with a quiet afternoon", "explore at a comfortable pace with room for spontaneity", "split the day between planned stops and free exploration"],
        }
        hints = style_hints.get(trip_style, style_hints["balanced"])
        activity_hint = hints[(day_num - 1) % len(hints)]

        if day_num == 1:
            return f"Arrive in {city}, settle in, and start to {activity_hint}. Keep the first day light to adjust."
        elif day_num == total_days:
            return f"Final day in {city} — wrap up with any last visits and {activity_hint} before departure."
        elif day_num == total_days - 1 and total_days > 2:
            return f"Make the most of your last full day in {city}. {activity_hint.capitalize()} with a relaxed pace."
        elif day_num == 2:
            return f"Get into the rhythm of {city} — {activity_hint} and start exploring in earnest."
        elif day_num == 3:
            return f"Go deeper into {city}. {activity_hint.capitalize()} and discover something unexpected."
        else:
            return f"Another day in {city} — {activity_hint} and see where the day takes you."

    async def _search_flights_for_trip(self, ctx: dict) -> list[FlightOption]:
        """Search for flights if SerpApi is configured and we have start location + dates.

        Gracefully skips if SerpApi key is missing or no dates/start location.
        """
        from app.services.serpapi_provider import serpapi_provider

        if not settings.serpapi_api_key:
            logger.debug("[ITINERARY_BUILDER] Skipping flights — no SerpApi key")
            return []

        start_location = ctx.get("startLocation")
        if isinstance(start_location, dict):
            start_location = start_location.get("name")
        if not start_location:
            logger.debug("[ITINERARY_BUILDER] Skipping flights — no start location")
            return []

        start_date = ctx.get("startDate")
        if not start_date:
            logger.debug("[ITINERARY_BUILDER] Skipping flights — no start date")
            return []

        cities = ctx.get("cities") or []
        if cities:
            destination_city = cities[0]["name"]
            total_days = ctx.get("totalDays") or sum(c["days"] for c in cities)
        else:
            destination_city = ctx.get("destination", "")
            total_days = ctx.get("duration", 1)

        if not destination_city:
            return []

        # Calculate return date
        try:
            dep_date = datetime.fromisoformat(start_date).date()
            ret_date = dep_date + timedelta(days=total_days)
            return_date = ret_date.isoformat()
        except Exception:
            return_date = None

        # Resolve airport codes via autocomplete
        origin_code = await self._resolve_airport_code(start_location)
        dest_code = await self._resolve_airport_code(destination_city)
        if not origin_code or not dest_code:
            logger.warning(
                f"[ITINERARY_BUILDER] Could not resolve airport codes: "
                f"{start_location}→{destination_city}"
            )
            return []

        adults = ctx.get("numberOfPeople", 1)
        travel_class = "economy"
        prefs = ctx.get("travelPreferences") or {}
        if prefs.get("cabinClass"):
            travel_class = prefs["cabinClass"]

        try:
            flights_data = await _with_api_sem(partial(
                serpapi_provider.search_flights,
                origin=origin_code,
                destination=dest_code,
                departure_date=start_date[:10],
                return_date=return_date,
                adults=adults,
                travel_class=travel_class,
            ))
        except Exception as e:
            logger.error(f"[ITINERARY_BUILDER] Flight search failed: {e}")
            return []

        # Convert to FlightOption models (top 3)
        flight_models = []
        for f in flights_data[:3]:
            flight_models.append(FlightOption(
                id=f.get("id", ""),
                legs=f.get("legs", []),
                outboundLegs=f.get("outboundLegs", []),
                returnLegs=f.get("returnLegs", []),
                layovers=f.get("layovers", []),
                totalDuration=f.get("totalDuration", 0),
                price=f.get("price", 0),
                currency=f.get("currency", "USD"),
                type=f.get("type", ""),
                isBest=f.get("isBest", False),
                bookingLink=f.get("bookingLink", ""),
            ))

        logger.info(
            f"[ITINERARY_BUILDER] Flights {start_location}→{destination_city}: "
            f"{len(flight_models)} options"
        )
        return flight_models

    # Common city → IATA airport code mapping for Google Flights.
    # Google Flights requires IATA codes (e.g. "BOM", "NRT") for departure_id/arrival_id.
    # The google_autocomplete engine returns general search suggestions (e.g. "mumbai indians")
    # which are NOT valid airport codes — so we use this mapping instead.
    _CITY_TO_IATA: dict[str, str] = {
        # India
        "mumbai": "BOM", "bombay": "BOM", "delhi": "DEL", "new delhi": "DEL",
        "bangalore": "BLR", "bengaluru": "BLR", "chennai": "MAA", "madras": "MAA",
        "kolkata": "CCU", "calcutta": "CCU", "hyderabad": "HYD", "pune": "PNQ",
        "ahmedabad": "AMD", "kochi": "COK", "cochin": "COK", "goa": "GOI",
        "jaipur": "JAI", "lucknow": "LKO", "chandigarh": "IXC",
        # Japan
        "tokyo": "NRT", "osaka": "KIX", "kyoto": "KIX", "nagoya": "NGO",
        "sapporo": "CTS", "fukuoka": "FUK", "okinawa": "OKA",
        # USA
        "new york": "JFK", "manhattan": "JFK",
        "los angeles": "LAX", "san francisco": "SFO",
        "chicago": "ORD", "miami": "MIA", "boston": "BOS", "seattle": "SEA",
        "las vegas": "LAS", "washington": "IAD", "atlanta": "ATL",
        "dallas": "DFW", "houston": "IAH", "denver": "DEN", "phoenix": "PHX",
        "san diego": "SAN", "portland": "PDX", "austin": "AUS",
        # Europe
        "london": "LHR", "paris": "CDG", "amsterdam": "AMS", "rome": "FCO",
        "madrid": "MAD", "barcelona": "BCN", "berlin": "BER", "munich": "MUC",
        "frankfurt": "FRA", "dublin": "DUB", "lisbon": "LIS", "prague": "PRG",
        "vienna": "VIE", "zurich": "ZRH", "geneva": "GVA", "copenhagen": "CPH",
        "stockholm": "ARN", "oslo": "OSL", "helsinki": "HEL", "athens": "ATH",
        "istanbul": "IST", "milan": "MXP", "venice": "VCE", "florence": "FLR",
        "naples": "NAP", "nice": "NCE", "edinburgh": "EDI", "manchester": "MAN",
        # Asia Pacific
        "singapore": "SIN", "hong kong": "HKG", "bangkok": "BKK",
        "kuala lumpur": "KUL", "seoul": "ICN", "incheon": "ICN",
        "beijing": "PEK", "shanghai": "PVG", "taipei": "TPE", "manila": "MNL",
        "jakarta": "CGK", "ho chi minh": "SGN", "saigon": "SGN", "hanoi": "HAN",
        "sydney": "SYD", "melbourne": "MEL", "brisbane": "BNE", "perth": "PER",
        "auckland": "AKL", "wellington": "WLG", "bali": "DPS", "denpasar": "DPS",
        "phuket": "HKT", "chiang mai": "CNX", "kathmandu": "KTM",
        "dhaka": "DAC", "colombo": "CMB",
        # Middle East
        "dubai": "DXB", "abu dhabi": "AUH", "doha": "DOH", "riyadh": "RUH",
        "jeddah": "JED", "tel aviv": "TLV", "amman": "AMM",
        # Africa
        "cairo": "CAI", "johannesburg": "JNB", "cape town": "CPT",
        "nairobi": "NBO", "lagos": "LOS", "addis ababa": "ADD",
        # Latin America
        "mexico city": "MEX", "cancun": "CUN", "bogota": "BOG",
        "lima": "LIM", "santiago": "SCL", "buenos aires": "EZE",
        "rio de janeiro": "GIG", "sao paulo": "GRU",
        "havana": "HAV", "san jose": "SJO",
        # Iceland / Nordic
        "reykjavik": "KEF", "iceland": "KEF",
    }

    # Short abbreviations and common name variants → IATA code.
    # Kept separate from _CITY_TO_IATA so it's clear these are deliberate
    # aliases resolved by exact match only — never by prefix matching.
    _CITY_ALIASES: dict[str, str] = {
        "nyc": "JFK", "new york city": "JFK",
        "la": "LAX", "sf": "SFO",
        "dc": "IAD", "washington dc": "IAD",
        "kl": "KUL", "rio": "GIG",
        "ho chi minh city": "SGN",
    }

    @staticmethod
    async def _resolve_airport_code(city_name: str) -> str | None:
        """Resolve a city name to an IATA airport code.

        Exact (case-insensitive) match against _CITY_TO_IATA, then the
        explicit _CITY_ALIASES table for abbreviations like "nyc" or "sf".
        Returns None when there is no exact match — flight search is skipped.
        """
        if not city_name:
            return None
        key = city_name.lower().strip()
        code = (
            ItineraryBuilder._CITY_TO_IATA.get(key)
            or ItineraryBuilder._CITY_ALIASES.get(key)
        )
        if code:
            return code
        logger.warning(f"[ITINERARY_BUILDER] No IATA code found for {city_name!r}")
        return None

    async def _search_hotels_and_restaurants(
        self,
        city: str,
        ctx: dict | None = None,
    ) -> tuple[list[HotelRecommendation], list[RestaurantRecommendation]]:
        """Search for top hotels and restaurants in a city.

        When SerpApi is configured AND the ctx provides check-in/check-out dates,
        uses google_hotels for price/amenity/booking-link data. Falls back to
        Google Places Text Search (no prices) when no dates or no SerpApi key.
        """
        from app.services.google_places import google_places

        # --- SerpApi hotel path (with prices/amenities/booking) ---
        # Used when SerpApi is configured AND we have check-in/check-out dates.
        async def _serpapi_hotel_search() -> list[dict]:
            if not (settings.serpapi_api_key and ctx):
                return []
            start_date = ctx.get("startDate")
            duration = ctx.get("duration") or ctx.get("totalDays") or 1
            if not start_date:
                return []
            try:
                from datetime import datetime as _dt, timedelta as _td
                dep = _dt.fromisoformat(start_date[:10]).date()
                checkout = (dep + _td(days=int(duration))).isoformat()
                adults = ctx.get("numberOfPeople", 1) or 1
                from app.services.serpapi_provider import serpapi_provider
                results = await _with_api_sem(partial(
                    serpapi_provider.search_hotels,
                    destination=city,
                    check_in=start_date[:10],
                    check_out=checkout,
                    adults=adults,
                ))
                logger.info(
                    f"[ITINERARY_BUILDER] SerpApi hotels for {city}: "
                    f"{len(results)} results (check-in {start_date[:10]})"
                )
                return results
            except Exception as e:
                logger.warning(f"[ITINERARY_BUILDER] SerpApi hotel search failed: {e}")
                return []

        async def _places_hotel_restaurant_search() -> tuple[list[dict], list[dict]]:
            hotel_queries = generate_hotel_queries(city)
            restaurant_queries = generate_restaurant_queries(city)

            # Try text_search first (returns up to 20 results per query)
            if settings.google_places_api_key:
                hotel_tasks = [_with_api_sem(partial(google_places.text_search, q, limit=5)) for q in hotel_queries]
                restaurant_tasks = [_with_api_sem(partial(google_places.text_search, q, limit=5)) for q in restaurant_queries]
                hotel_results, restaurant_results = await asyncio.gather(
                    asyncio.gather(*hotel_tasks, return_exceptions=True),
                    asyncio.gather(*restaurant_tasks, return_exceptions=True),
                )
                hotel_places = []
                for r in hotel_results:
                    if isinstance(r, list):
                        hotel_places.extend(r)
                restaurant_places = []
                for r in restaurant_results:
                    if isinstance(r, list):
                        restaurant_places.extend(r)
            else:
                # Fallback to places_search (MCP → OpenTripMap)
                hotel_places, restaurant_places = await asyncio.gather(
                    _with_api_sem(partial(places_search.search_multiple, hotel_queries, city, limit_per_query=3)),
                    _with_api_sem(partial(places_search.search_multiple, restaurant_queries, city, limit_per_query=3)),
                )
            return hotel_places, restaurant_places

        # SerpApi hotel search and Google Places searches run concurrently
        serpapi_hotels, (hotel_places, restaurant_places) = await asyncio.gather(
            _serpapi_hotel_search(),
            _places_hotel_restaurant_search(),
        )

        # Deduplicate by placeId and pick top 5 by rating
        hotels = self._dedupe_and_rank(hotel_places, max_results=5)
        restaurants = self._dedupe_and_rank(restaurant_places, max_results=5)

        async def _resolve_place_photo(place: dict) -> str | None:
            """Resolve a Google Places photo reference to a URL (bounded)."""
            photo_url = place.get("photo_url", "")
            if photo_url and not photo_url.startswith("http"):
                try:
                    resolved = await _with_api_sem(partial(google_places.resolve_photo_url, photo_url))
                    if resolved:
                        return resolved
                    return photo_url
                except Exception:
                    return None
            return photo_url or None

        # Resolve photo references for all candidates concurrently.
        # (Hotel photos are only needed when falling back to Places results.)
        photo_targets = restaurants if serpapi_hotels else [*hotels, *restaurants]
        photo_results = await asyncio.gather(
            *(_resolve_place_photo(p) for p in photo_targets)
        )
        if serpapi_hotels:
            hotel_photos: list[str | None] = []
            restaurant_photos = photo_results
        else:
            hotel_photos = photo_results[:len(hotels)]
            restaurant_photos = photo_results[len(hotels):]

        # --- Build hotel models ---
        # Prefer SerpApi results (with prices/amenities/booking) when available.
        hotel_models: list[HotelRecommendation] = []
        if serpapi_hotels:
            for h in serpapi_hotels[:5]:
                images = h.get("images") or []
                image_url = images[0]["original"] if images and images[0].get("original") else None
                if not image_url and images:
                    image_url = images[0].get("thumbnail")

                rate = h.get("ratePerNight")
                rating = h.get("rating")
                reviews = h.get("reviewsCount")
                amenities = h.get("amenities") or []
                currency = h.get("currency", "USD")

                # Rule-based "why we picked this" rationale.
                why_parts = []
                if rating:
                    why_parts.append(f"Top-rated in {city} ({rating}★")
                    if reviews:
                        why_parts.append(f", {reviews} reviews")
                    why_parts.append(")")
                if rate:
                    why_parts.append(f" at {currency}{rate}/night")
                if amenities:
                    top_amenities = [a for a in amenities[:2] if isinstance(a, str)]
                    if top_amenities:
                        why_parts.append(f" with {', '.join(top_amenities)}")
                why_picked = "".join(why_parts) + "." if why_parts else None

                hotel_models.append(HotelRecommendation(
                    name=h.get("name", ""),
                    ratePerNight=rate,
                    totalRate=h.get("totalRate"),
                    currency=currency,
                    rating=rating,
                    reviewsCount=reviews,
                    amenities=amenities,
                    bookingLink=h.get("bookingLink"),
                    images=[img.get("original") or img.get("thumbnail") for img in images if isinstance(img, dict)],
                    imageUrl=image_url,
                    whyPicked=why_picked,
                ))
        else:
            # Fallback: Google Places text search (no prices/dates).
            for h, photo_url in zip(hotels, hotel_photos):
                hotel_models.append(HotelRecommendation(
                    name=h.get("name", ""),
                    placeId=h.get("placeId"),
                    address=h.get("address"),
                    rating=h.get("rating"),
                    imageUrl=photo_url,
                    website=h.get("website"),
                    phone=h.get("phone"),
                    coordinates=h.get("coordinates"),
                    description=h.get("description"),
                ))

        restaurant_models = []
        for r, photo_url in zip(restaurants, restaurant_photos):
            # Extract cuisine from types
            types = r.get("types", [])
            cuisine = None
            for t in types:
                if t in ("restaurant", "cafe", "bar", "meal_takeaway", "bakery"):
                    cuisine = t.replace("_", " ").title()
                    break

            restaurant_models.append(RestaurantRecommendation(
                name=r.get("name", ""),
                placeId=r.get("placeId"),
                address=r.get("address"),
                rating=r.get("rating"),
                imageUrl=photo_url,
                cuisine=cuisine,
                website=r.get("website"),
                phone=r.get("phone"),
                coordinates=r.get("coordinates"),
                description=r.get("description"),
            ))

        logger.info(
            f"[ITINERARY_BUILDER] Hotels/restaurants for {city}: "
            f"{len(hotel_models)} hotels, {len(restaurant_models)} restaurants"
        )
        return hotel_models, restaurant_models

    @staticmethod
    def _dedupe_and_rank(places: list[dict], max_results: int = 5) -> list[dict]:
        """Deduplicate places by placeId and rank by rating."""
        seen_ids = set()
        seen_names = set()
        unique = []
        for p in places:
            pid = p.get("placeId", "")
            name = p.get("name", "").lower()
            if pid and pid in seen_ids:
                continue
            if name and name in seen_names:
                continue
            if pid:
                seen_ids.add(pid)
            if name:
                seen_names.add(name)
            unique.append(p)
        ranked = sorted(unique, key=lambda p: p.get("rating") or 0, reverse=True)
        return ranked[:max_results]

itinerary_builder = ItineraryBuilder()
