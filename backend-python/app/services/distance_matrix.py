"""Google Maps Distance Matrix API service.

Batches multiple origin→destination pairs into a single API call to get
real travel times and distances between places.

Google Distance Matrix API limits:
  - 100 elements per request (origins × destinations)
  - Free tier: 100 elements/request, 1000 elements/second

Usage:
  results = await distance_matrix.compute_travel_times(
      pairs=[{"origin": {"lat": 35.6, "lng": 139.7}, "destination": {"lat": 35.7, "lng": 139.8}}],
      mode="walking",
  )
  # → [{"distanceMeters": 1200, "durationSeconds": 900, "mode": "walking"}]
"""

import httpx

from app.config import settings
from app.utils.logger import logger


class DistanceMatrixService:
    BASE_URL = "https://maps.googleapis.com/maps/api/distancematrix/json"

    async def compute_travel_times(
        self,
        pairs: list[dict],
        mode: str = "walking",
    ) -> list[dict]:
        """Compute travel times for a list of origin→destination pairs.

        Batches all pairs into a single Distance Matrix API call.
        Origins = all origins, Destinations = all destinations.
        The result[i] corresponds to pairs[i].

        Args:
            pairs: List of {"origin": {lat, lng}, "destination": {lat, lng}}
            mode: "walking" or "driving" (default: walking for intra-city)

        Returns:
            List of {"distanceMeters": int, "durationSeconds": int, "mode": str}
            in the same order as pairs. Falls back to None values on error.
        """
        if not pairs:
            return []

        if not settings.google_places_api_key:
            logger.warning("[DISTANCE_MATRIX] No API key — returning empty results")
            return [self._empty_result(mode) for _ in pairs]

        # Build pipe-separated origin/destination strings
        origins = "|".join(
            f"{p['origin']['lat']},{p['origin']['lng']}" for p in pairs
        )
        destinations = "|".join(
            f"{p['destination']['lat']},{p['destination']['lng']}" for p in pairs
        )

        # Map mode to API parameter
        api_mode = "walking" if mode == "walking" else "driving"

        params = {
            "origins": origins,
            "destinations": destinations,
            "mode": api_mode,
            "units": "metric",
            "key": settings.google_places_api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(self.BASE_URL, params=params)
                data = resp.json()

            if data.get("status") != "OK":
                logger.warning(
                    f"[DISTANCE_MATRIX] API status: {data.get('status')} — "
                    f"{data.get('error_message', '')}"
                )
                return [self._empty_result(mode) for _ in pairs]

            rows = data.get("rows", [])
            results = []
            for i, pair in enumerate(pairs):
                # Distance Matrix returns rows[i].elements[j] for origins[i] → destinations[j]
                # Since we're pairing them 1:1, j = i
                row = rows[i] if i < len(rows) else {}
                element = row.get("elements", [{}])[i] if row.get("elements") else {}

                if element.get("status") == "OK":
                    results.append({
                        "distanceMeters": element.get("distance", {}).get("value", 0),
                        "durationSeconds": element.get("duration", {}).get("value", 0),
                        "mode": mode,
                    })
                else:
                    logger.debug(
                        f"[DISTANCE_MATRIX] No route for pair {i}: "
                        f"{element.get('status', 'unknown')}"
                    )
                    results.append(self._empty_result(mode))

            logger.info(
                f"[DISTANCE_MATRIX] Computed {len(results)} travel times "
                f"(mode={mode}, {sum(1 for r in results if r['durationSeconds'] > 0)} ok)"
            )
            return results

        except Exception as e:
            logger.error(f"[DISTANCE_MATRIX] API call failed: {e}")
            return [self._empty_result(mode) for _ in pairs]

    @staticmethod
    def _get_coords(activity: dict) -> dict | None:
        """Extract lat/lng from an activity dict."""
        coords = activity.get("coordinates") or {}
        lat = coords.get("lat")
        lng = coords.get("lng")
        if lat is not None and lng is not None and lat != 0 and lng != 0:
            return {"lat": lat, "lng": lng}
        return None

    @staticmethod
    def _empty_result(mode: str) -> dict:
        """Return an empty/zero travel time result."""
        return {"distanceMeters": 0, "durationSeconds": 0, "mode": mode}

    @staticmethod
    def format_duration_text(seconds: int) -> str:
        """Format seconds into a human-readable duration string."""
        if seconds <= 0:
            return ""
        minutes = seconds / 60
        if minutes < 60:
            if minutes < 1:
                return "<1 min"
            return f"{int(minutes)} min"
        hours = minutes / 60
        if hours < 2:
            remaining = int(minutes % 60)
            if remaining:
                return f"{int(hours)}h {remaining}min"
            return f"{int(hours)}h"
        return f"{hours:.1f}h"

    @staticmethod
    def format_distance_text(meters: int) -> str:
        """Format meters into a human-readable distance string."""
        if meters <= 0:
            return ""
        if meters < 1000:
            return f"{meters} m"
        km = meters / 1000
        if km < 10:
            return f"{km:.1f} km"
        return f"{int(km)} km"


distance_matrix = DistanceMatrixService()
