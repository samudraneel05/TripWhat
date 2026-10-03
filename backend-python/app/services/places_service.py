"""Places service — OpenTripMap search."""

import asyncio
import httpx

from app.config import settings


class PlacesService:
    OTM_BASE = "https://api.opentripmap.com/0.1/en/places"

    def _otm_key(self) -> str:
        return settings.opentripmap_api_key

    async def search_places(self, query: str, limit: int = 10) -> list[dict]:
        if not self._otm_key():
            return []

        query_variations = [query, f"{query} city", query.replace(" ", "")]
        lat, lon, location_name, country, state = 0, 0, "", "", ""

        async with httpx.AsyncClient(timeout=10.0) as client:
            for qv in query_variations:
                try:
                    resp = await client.get(
                        f"{self.OTM_BASE}/geoname",
                        params={"name": qv, "apikey": self._otm_key()},
                    )
                    data = resp.json()
                    if data.get("lat"):
                        lat = data["lat"]
                        lon = data["lon"]
                        location_name = data.get("name", "")
                        country = data.get("country", "")
                        state = data.get("state", "")
                        break
                except Exception:
                    continue

            if not lat or not lon:
                return []

            await asyncio.sleep(0.1)

            try:
                resp = await client.get(
                    f"{self.OTM_BASE}/radius",
                    params={
                        "radius": 10000, "lon": lon, "lat": lat,
                        "limit": min(limit, 20),
                        "format": "geojson", "rate": 3,
                        "apikey": self._otm_key(),
                    },
                )
                places_data = resp.json()
            except Exception:
                return []

            features = places_data.get("features", [])
            if not features:
                return []

            places = []
            for i, feature in enumerate(features[:limit]):
                props = feature.get("properties", {})
                coords = feature.get("geometry", {}).get("coordinates", [0, 0])

                if i > 0:
                    await asyncio.sleep(0.2)

                details = None
                try:
                    if props.get("xid"):
                        detail_resp = await client.get(
                            f"{self.OTM_BASE}/xid/{props['xid']}",
                            params={"apikey": self._otm_key()},
                        )
                        details = detail_resp.json()
                except Exception:
                    pass

                kinds = props.get("kinds", "")
                place_type = "attraction"
                if "museums" in kinds:
                    place_type = "museum"
                elif "historic" in kinds:
                    place_type = "historic"
                elif "natural" in kinds:
                    place_type = "natural"
                elif "cultural" in kinds:
                    place_type = "cultural"
                elif "religion" in kinds or "architecture" in kinds:
                    place_type = "historic"

                wiki_text = ""
                if details:
                    wiki_text = (details.get("wikipedia_extracts", {}) or {}).get("text", "")[:200]

                places.append({
                    "id": props.get("xid", f"otm_{i}"),
                    "name": props.get("name", "Unknown Place"),
                    "location": location_name,
                    "country": country,
                    "state": state,
                    "description": wiki_text or (details or {}).get("info", {}).get("descr", "") or ", ".join(kinds.split(",")) or "Tourist attraction",
                    "type": place_type,
                    "coordinates": {"lat": coords[1], "lon": coords[0]},
                    "imageUrl": (details or {}).get("preview", {}).get("source") or (details or {}).get("image") or f"https://source.unsplash.com/800x600/?{props.get('name', '')}+{location_name}",
                    "searchTerms": [p for p in [props.get("name", "").lower(), location_name.lower(), country.lower()] if p] + [k.strip() for k in kinds.split(",") if k.strip()],
                    "rating": props.get("rate", 0),
                    "kinds": kinds,
                })

            return [p for p in places if p["name"] and p["name"] != "Unknown Place"]


places_service = PlacesService()
