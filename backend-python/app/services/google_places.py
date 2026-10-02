"""Google Places API service."""

import httpx

from app.config import settings
from app.utils.logger import logger


class GooglePlacesService:
    BASE_URL = "https://maps.googleapis.com/maps/api/place"

    async def search_places(self, query: str, location: str | None = None) -> list[dict]:
        if not settings.google_places_api_key:
            return []

        async with httpx.AsyncClient(timeout=10.0) as client:
            params = {
                "input": query,
                "inputtype": "textquery",
                "fields": "place_id,name,formatted_address,geometry,rating,photos,types",
                "key": settings.google_places_api_key,
            }
            if location:
                params["locationbias"] = f"point:{location}"

            resp = await client.get(f"{self.BASE_URL}/findplacefromtext/json", params=params)
            data = resp.json()
            candidates = data.get("candidates", [])

            results = []
            for c in candidates:
                geom = c.get("geometry", {}).get("location", {})
                photos = c.get("photos", [])
                photo_ref = photos[0].get("photo_reference", "") if photos else ""
                results.append({
                    "placeId": c.get("place_id"),
                    "name": c.get("name"),
                    "address": c.get("formatted_address"),
                    "coordinates": {"lat": geom.get("lat", 0), "lng": geom.get("lng", 0)},
                    "rating": c.get("rating"),
                    "types": c.get("types", []),
                    "photo_url": photo_ref,
                })
            return results

    async def get_place_details(self, place_id: str) -> dict | None:
        if not settings.google_places_api_key:
            return None

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.BASE_URL}/details/json", params={
                "place_id": place_id,
                "fields": "name,formatted_address,geometry,rating,photos,opening_hours,website,formatted_phone_number,international_phone_number,reviews,price_level,user_ratings_total,editorial_summary,address_components,business_status,url",
                "key": settings.google_places_api_key,
            })
            data = resp.json()
            return data.get("result")

    async def resolve_photo_url(self, photo_reference: str, max_width: int = 400) -> str | None:
        """Resolve a Google Places photo reference to a direct image URL.

        Supports two formats:
        - Legacy photo_reference (short hash) → Places Photo API (legacy)
        - Places API v1 photo name (e.g. "places/ChIJ.../photos/...") → Places API v1 media endpoint

        Both return a 302 redirect to the actual image URL on Google's CDN.
        We capture that redirect URL without downloading the image.
        """
        if not settings.google_places_api_key:
            return None

        # Places API v1 photo name (from MCP) — uses different endpoint
        if photo_reference.startswith("places/"):
            v1_url = f"https://places.googleapis.com/v1/{photo_reference}/media"
            try:
                async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
                    resp = await client.get(v1_url, params={
                        "maxWidthPx": max_width,
                        "key": settings.google_places_api_key,
                    })
                    if resp.status_code == 302:
                        return resp.headers.get("location")
                    elif resp.status_code == 200:
                        # Some responses return the image directly — construct a usable URL
                        return f"{v1_url}?maxWidthPx={max_width}&key={settings.google_places_api_key}"
            except Exception as e:
                logger.warning(f"[GOOGLE_PLACES] v1 photo resolution failed for '{photo_reference[:50]}': {e}")
            return None

        # Legacy photo reference → Places Photo API
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
                resp = await client.get(f"{self.BASE_URL}/photo", params={
                    "photoreference": photo_reference,
                    "maxwidth": max_width,
                    "key": settings.google_places_api_key,
                })
                if resp.status_code == 302:
                    return resp.headers.get("location")
                else:
                    logger.warning(f"[GOOGLE_PLACES] Photo API returned {resp.status_code} for ref '{photo_reference[:30]}'")
        except Exception as e:
            logger.warning(f"[GOOGLE_PLACES] Photo resolution failed for ref '{photo_reference[:30]}': {e}")
        return None

    async def text_search(self, query: str, limit: int = 10) -> list[dict]:
        """Search via Google Places Text Search API.

        Unlike findplacefromtext (which returns 1-4 candidates), the Text Search
        API returns up to 20 results — much better for listing hotels/restaurants.
        """
        if not settings.google_places_api_key:
            return []

        async with httpx.AsyncClient(timeout=15.0) as client:
            params = {
                "query": query,
                "fields": "place_id,name,formatted_address,geometry,rating,photos,types,business_status",
                "key": settings.google_places_api_key,
            }
            resp = await client.get(f"{self.BASE_URL}/textsearch/json", params=params)
            data = resp.json()
            results = []
            for r in data.get("results", [])[:limit]:
                geom = r.get("geometry", {}).get("location", {})
                photos = r.get("photos", [])
                photo_ref = photos[0].get("photo_reference", "") if photos else ""
                results.append({
                    "placeId": r.get("place_id"),
                    "name": r.get("name"),
                    "address": r.get("formatted_address"),
                    "coordinates": {"lat": geom.get("lat", 0), "lng": geom.get("lng", 0)},
                    "rating": r.get("rating"),
                    "types": r.get("types", []),
                    "photo_url": photo_ref,
                })
            return results

    async def place_lookup(self, name: str) -> dict:
        """Resolve a name to place types — used to validate destinations.

        Returns {"status": "OK"|"ZERO_RESULTS"|"REQUEST_DENIED"|...,
                 "types": [top-hit types]} so callers can distinguish a
        name that isn't a place from an API outage.
        """
        if not settings.google_places_api_key:
            return {"status": "UNCONFIGURED", "name": "", "types": []}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self.BASE_URL}/textsearch/json",
                    params={
                        "query": name,
                        "fields": "name,types",
                        "key": settings.google_places_api_key,
                    },
                )
                data = resp.json()
        except Exception:
            return {"status": "ERROR", "name": "", "types": []}
        results = data.get("results") or []
        return {
            "status": data.get("status", "UNKNOWN"),
            "name": results[0].get("name", "") if results else "",
            "types": results[0].get("types", []) if results else [],
        }

    async def find_nearby(self, lat: float, lng: float, radius: int = 5000, place_type: str = "tourist_attraction") -> list[dict]:
        if not settings.google_places_api_key:
            return []

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.BASE_URL}/nearbysearch/json", params={
                "location": f"{lat},{lng}",
                "radius": radius,
                "type": place_type,
                "key": settings.google_places_api_key,
            })
            data = resp.json()
            results = []
            for r in data.get("results", []):
                geom = r.get("geometry", {}).get("location", {})
                results.append({
                    "placeId": r.get("place_id"),
                    "name": r.get("name"),
                    "address": r.get("vicinity"),
                    "coordinates": {"lat": geom.get("lat", 0), "lng": geom.get("lng", 0)},
                    "rating": r.get("rating"),
                    "types": r.get("types", []),
                })
            return results


google_places = GooglePlacesService()
