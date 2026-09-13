"""MCP-powered agent tools — search_places, resolve_names, compute_routes, lookup_weather, find_nearby.

These tools wrap the Google Maps Grounding Lite MCP client as LangGraph @tool functions
so the agent can call them autonomously during chat.
"""

import contextvars
import json
from langchain_core.tools import tool

from app.services.mcp_client import maps_mcp
from app.services.places_search import places_search
from app.services.google_places import google_places

# Contextvar holding a mutable list. chat_stream sets a fresh list before
# streaming; mcp_search_places appends structured results to it. After the
# stream completes, chat_stream reads the list to build a search_results
# widget. The contextvar holds a reference to the same list object, so
# mutations made inside tool calls (which may run in child tasks) are
# visible to the parent.
_search_results_var: contextvars.ContextVar[list] = contextvars.ContextVar(
    "search_results", default=None
)


def init_search_results() -> None:
    """Call at the start of a chat turn to reset the search results buffer."""
    _search_results_var.set([])


def get_search_results() -> list:
    """Call after the stream completes to retrieve accumulated search results."""
    return _search_results_var.get() or []


@tool
async def mcp_search_places(text_query: str, city: str = "", exclude: list[str] | None = None) -> str:
    """Search for real places using Google Maps — attractions, restaurants, hotels, etc.
    Use this when the user asks to find things to do, search for hotels/restaurants/attractions,
    or when you need real place data (names, ratings, addresses) for an itinerary.

    Args:
        text_query: What to search for (e.g., "attractions", "best sushi restaurants", "hotels near Shinjuku")
        city: The location to search in — a city ("Tokyo"), region ("Tuscany"), or
              country ("Australia"). Pass whatever the user asked about — it scopes the search.
        exclude: Place names to leave out of results. When the user asks for
              MORE/different places after a previous search, pass the names you
              already showed so the response isn't a repeat of the same list.
              Prefer a different query angle too (other cities, categories,
              neighborhoods) rather than re-running a near-identical query.
    """
    # If city is provided and text_query doesn't already mention it, combine them
    # so the actual Google Maps query includes the city (e.g., "attractions in Tokyo").
    if city and city.lower() not in text_query.lower():
        search_query = f"{text_query} in {city}"
    else:
        search_query = text_query

    # Use cache-first search service (MCP → Google Places → OpenTripMap)
    results = await places_search.search(search_query, city or text_query, limit=10)

    if exclude:
        excluded = {str(e).strip().lower() for e in exclude}
        filtered = [r for r in results if (r.get("name") or "").strip().lower() not in excluded]
        if filtered:
            results = filtered

    # Stash structured results for the search_results widget
    container = _search_results_var.get()
    if container is not None:
        container.extend(results)

    if not results:
        return f"No places found for '{text_query}'. Try a different search term."

    summaries = []
    for r in results:
        name = r.get("name", "Unknown")
        rating = r.get("rating", "N/A")
        address = r.get("address", "")
        rtype = ", ".join(r.get("types", [])[:3]) if r.get("types") else "place"
        coords = r.get("coordinates", {})
        summaries.append(
            f"**{name}** (rating: {rating}, type: {rtype})\n"
            f"  Address: {address}\n"
            f"  Coordinates: {coords.get('lat', 0)}, {coords.get('lng', 0)}\n"
            f"  Place ID: {r.get('placeId', 'N/A')}"
        )

    return f"Found {len(results)} places for '{text_query}':\n\n" + "\n\n".join(summaries)


@tool
async def mcp_resolve_names(place_names: list[str]) -> str:
    """Resolve place names to canonical Google Maps Place IDs.
    Use this when you need to standardize ambiguous place names or get Place IDs
    for other lookups. For general place search with ratings/addresses, use mcp_search_places instead.

    Args:
        place_names: List of place names to resolve (e.g., ["Senso-ji Temple", "Tokyo Tower"])
    """
    results = await maps_mcp.resolve_names(place_names)

    if not results:
        return f"Could not resolve any of: {place_names}"

    summaries = []
    for r in results:
        summaries.append(f"**{r['name']}** → Place ID: {r.get('placeId', 'N/A')}")

    return f"Resolved {len(results)} places:\n\n" + "\n\n".join(summaries)


@tool
async def mcp_compute_routes(origin: str, destination: str, travel_mode: str = "DRIVE") -> str:
    """Compute a travel route between two places.
    Use this when the user asks about travel time, distance, or directions between places.

    Args:
        origin: Starting point (address or place name, e.g., "Senso-ji Temple, Tokyo")
        destination: Ending point (address or place name, e.g., "Tokyo Tower")
        travel_mode: "DRIVE" or "WALK" (default: DRIVE)
    """
    result = await maps_mcp.compute_routes(
        origin={"address": origin},
        destination={"address": destination},
        travel_mode=travel_mode,
    )

    if not result:
        return f"Could not compute route from {origin} to {destination}."

    distance = result.get("distanceMeters", "N/A")
    duration = result.get("duration", "N/A")
    return f"Route from {origin} to {destination} ({travel_mode}):\nDistance: {distance}m\nDuration: {duration}"


@tool
async def mcp_lookup_weather(location: str, date: str = "") -> str:
    """Look up weather for a location.
    Use this when the user asks about weather, what to pack, or best time to visit.

    Args:
        location: City or place name (e.g., "Tokyo, Japan")
        date: Optional specific date in YYYY-MM-DD format for a forecast. Omit for current conditions.
    """
    args = {"location": {"address": location}}

    if date:
        try:
            parts = date.split("-")
            args["date"] = {"year": int(parts[0]), "month": int(parts[1]), "day": int(parts[2])}
        except (ValueError, IndexError):
            pass

    result = await maps_mcp.lookup_weather(args)

    if not result:
        return f"Could not look up weather for {location}."

    return f"Weather for {location}:\n{json.dumps(result, indent=2)[:500]}"


@tool
async def mcp_find_nearby(
    location: str,
    place_type: str = "tourist_attraction",
    radius_meters: int = 5000,
) -> str:
    """Find places near a specific location.
    Use this when the user asks for things near a place, e.g., "what's near the Eiffel Tower?"
    or "find restaurants near my hotel" or "attractions within walking distance of Times Square".

    Args:
        location: A place name or address (e.g., "Eiffel Tower", "Times Square, New York")
        place_type: Type of place to find — "tourist_attraction", "restaurant", "lodging",
                    "museum", "cafe", "bar", "park", "shopping_mall", etc.
        radius_meters: Search radius in meters (default: 5000, max 50000). 1000m ≈ walking distance.
    """
    # Step 1: Resolve the location name to coordinates
    resolved = await maps_mcp.resolve_names([location])
    coords = None
    if resolved:
        coords = resolved[0].get("coordinates")

    if not coords:
        # Fallback: try a text search to get coordinates
        results = await places_search.search(location, location, limit=1)
        if results:
            coords = results[0].get("coordinates")

    if not coords or not coords.get("lat") or not coords.get("lng"):
        return f"Could not resolve location '{location}' to coordinates."

    lat = coords["lat"]
    lng = coords["lng"]

    # Step 2: Search for nearby places using Google Places Nearby Search
    nearby = await google_places.find_nearby(lat, lng, radius=radius_meters, place_type=place_type)

    if not nearby:
        return f"No {place_type} places found within {radius_meters}m of {location}."

    # Stash structured results for the search_results widget
    container = _search_results_var.get()
    if container is not None:
        container.extend(nearby)

    summaries = []
    for r in nearby[:10]:
        name = r.get("name", "Unknown")
        rating = r.get("rating", "N/A")
        address = r.get("address", "")
        rtype = ", ".join(r.get("types", [])[:3]) if r.get("types") else place_type
        summaries.append(
            f"**{name}** (rating: {rating}, type: {rtype})\n"
            f"  Address: {address}\n"
            f"  Place ID: {r.get('placeId', 'N/A')}"
        )

    return f"Found {len(nearby)} {place_type} places near {location} (within {radius_meters}m):\n\n" + "\n\n".join(summaries)
