"""MCP client for Google Maps Grounding Lite API.

Connects to https://mapstools.googleapis.com/mcp via streamable HTTP.
Uses API key authentication via X-Goog-Api-Key header.

Tools exposed by the server:
  - search_places: Find places, businesses, attractions, POIs
  - lookup_weather: Current/hourly/daily weather forecasts
  - compute_routes: Route between origin and destination
  - resolve_names: Batch resolve place names to Place IDs
  - resolve_maps_urls: Resolve Google Maps URLs to Place IDs
"""

import json
import httpx
from typing import Any

from app.config import settings
from app.utils.logger import logger


MCP_ENDPOINT = "https://mapstools.googleapis.com/mcp"


class MapsMCPClient:
    """Client for Google Maps Grounding Lite MCP server."""

    def __init__(self):
        self._access_token: str | None = None
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    def _get_auth_headers(self) -> dict:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        api_key = settings.google_mcp_access_token or settings.google_places_api_key
        if api_key:
            headers["X-Goog-Api-Key"] = api_key
        return headers

    async def _call_tool(self, tool_name: str, arguments: dict) -> dict | None:
        """Call an MCP tool via JSON-RPC over HTTP.

        Handles both plain JSON and SSE (text/event-stream) responses.
        """
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }

        try:
            resp = await self.client.post(MCP_ENDPOINT, json=payload, headers=self._get_auth_headers())
            if resp.status_code != 200:
                logger.error(f"[MCP] {tool_name} returned status {resp.status_code}: {resp.text[:300]}")
                return None

            data = self._parse_response(resp)
            if data is None:
                logger.error(f"[MCP] {tool_name} — could not parse response")
                return None

            if "error" in data:
                logger.error(f"[MCP] {tool_name} error: {data['error']}")
                return None

            result = data.get("result", {})
            if result.get("isError"):
                msg = ""
                for item in result.get("content") or []:
                    if item.get("type") == "text":
                        msg += item.get("text", "")
                logger.error(f"[MCP] {tool_name} tool error: {msg[:300]}")
                return None

            content = result.get("content", [])
            if content and isinstance(content, list):
                for item in content:
                    if item.get("type") == "text":
                        try:
                            return json.loads(item["text"])
                        except (json.JSONDecodeError, KeyError):
                            return {"text": item.get("text", "")}
            return result
        except Exception as e:
            logger.error(f"[MCP] {tool_name} call failed: {e}")
            return None

    def _parse_response(self, resp: httpx.Response) -> dict | None:
        """Parse MCP response — handles both JSON and SSE formats."""
        content_type = resp.headers.get("content-type", "")

        if "text/event-stream" in content_type:
            # SSE format: lines starting with "data: "
            for line in resp.text.split("\n"):
                line = line.strip()
                if line.startswith("data: "):
                    try:
                        return json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
            return None

        # Plain JSON response
        try:
            return resp.json()
        except json.JSONDecodeError:
            return None

    async def search_places(self, text_query: str, location_bias: dict | None = None,
                            language_code: str | None = None, region_code: str | None = None) -> list[dict]:
        """Search for places using Google Maps MCP.

        Args:
            text_query: Search query (e.g., "tourist attractions in Tokyo")
            location_bias: Optional {circle: {center: {latitude, longitude}, radius_meters}}
            language_code: e.g., "en", "ja"
            region_code: e.g., "US", "JP"

        Returns:
            List of place dicts with name, address, coordinates, rating, place_id, etc.
        """
        args: dict[str, Any] = {"text_query": text_query}
        if location_bias:
            args["location_bias"] = location_bias
        if language_code:
            args["language_code"] = language_code
        if region_code:
            args["region_code"] = region_code

        result = await self._call_tool("search_places", args)
        if not result:
            return []

        places = result.get("places", [])
        if not places and isinstance(result, list):
            places = result

        normalized = []
        for p in places:
            # MCP response format: name is in attribution.title (e.g., "Tokyo Tower - Google Maps")
            attribution = p.get("attribution", {})
            name = p.get("name") or p.get("displayName", {}).get("text", "")
            if not name and attribution.get("title"):
                # Strip " - Google Maps" suffix
                name = attribution["title"].replace(" - Google Maps", "").strip()

            normalized.append({
                "placeId": p.get("place_id") or p.get("id", ""),
                "name": name,
                "address": p.get("formatted_address") or p.get("address", ""),
                "coordinates": {
                    "lat": p.get("location", {}).get("latitude", 0),
                    "lng": p.get("location", {}).get("longitude", 0),
                },
                "rating": p.get("rating"),
                "types": p.get("types", []),
                "description": p.get("summary", {}).get("text", "") if isinstance(p.get("summary"), dict) else "",
                "photo_url": p.get("photos", [{}])[0].get("name", "") if p.get("photos") else "",
                "website": p.get("website_uri", ""),
                "phone": p.get("international_phone_number", "") or p.get("formatted_phone_number", ""),
                "maps_url": attribution.get("url", ""),
            })

        logger.info(f"[MCP] search_places('{text_query}') → {len(normalized)} results")
        return normalized

    async def resolve_names(self, queries: list[str], location_bias: dict | None = None) -> list[dict]:
        """Batch resolve place names to Google Place IDs."""
        args = {
            "queries": [{"text": q} for q in queries],
        }
        if location_bias:
            args["location_bias"] = location_bias

        result = await self._call_tool("resolve_names", args)
        if not result:
            return []

        results = result.get("results", [])
        normalized = []
        for r in results:
            entity = r.get("entity", {})
            if entity:
                normalized.append({
                    "placeId": entity.get("place_id", ""),
                    "name": entity.get("display_name", {}).get("text", ""),
                    "address": entity.get("formatted_address", ""),
                    "coordinates": {
                        "lat": entity.get("location", {}).get("latitude", 0),
                        "lng": entity.get("location", {}).get("longitude", 0),
                    },
                })

        return normalized

    async def compute_routes(self, origin: dict, destination: dict, travel_mode: str = "DRIVE") -> dict | None:
        """Compute a route between origin and destination.

        Args:
            origin: {address: "..."} or {lat_lng: {latitude, longitude}} or {place_id: "..."}
            destination: Same format as origin
            travel_mode: "DRIVE" or "WALK"
        """
        args = {
            "origin": origin,
            "destination": destination,
            "travel_mode": travel_mode,
        }
        return await self._call_tool("compute_routes", args)

    async def lookup_weather(self, location: dict, date: dict | None = None,
                             hour: int | None = None, units_system: str = "METRIC") -> dict | None:
        """Look up weather for a location.

        Args:
            location: {lat_lng: {latitude, longitude}} or {place_id: "..."} or {address: "..."}
            date: {year, month, day} for forecast
            hour: 0-23 for hourly forecast
            units_system: "METRIC" or "IMPERIAL"
        """
        args: dict[str, Any] = {"location": location, "units_system": units_system}
        if date:
            args["date"] = date
        if hour is not None:
            args["hour"] = hour

        return await self._call_tool("lookup_weather", args)

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None


maps_mcp = MapsMCPClient()
