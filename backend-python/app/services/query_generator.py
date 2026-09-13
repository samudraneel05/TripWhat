"""Hybrid query generator — builds search queries from city + trip_style + help_with.

The procedural path (generate_queries / generate_personalized_queries) spends
no LLM tokens — queries are generated deterministically from templates.
generate_llm_queries() adds a small cached LLM pass for destination-specific
queries (seasonality, signature experiences, neighborhoods, local events).
"""

from langchain_openai import ChatOpenAI

from app.services.llm_json import parse_json_robust
from app.utils.logger import logger

QUERY_TEMPLATES: dict[str, list[str]] = {
    # By trip_style
    "culture": [
        "historic sites in {city}",
        "museums in {city}",
        "temples and shrines in {city}",
    ],
    "food": [
        "best restaurants in {city}",
        "food markets in {city}",
        "street food in {city}",
    ],
    "adventure": [
        "outdoor activities in {city}",
        "hiking trails near {city}",
        "parks and nature in {city}",
    ],
    "city": [
        "top attractions in {city}",
        "landmarks in {city}",
        "shopping districts in {city}",
    ],
    "beaches": [
        "beaches near {city}",
        "coastal attractions in {city}",
    ],
    "wellness": [
        "spas in {city}",
        "wellness centers in {city}",
        "parks and gardens in {city}",
    ],
    "balanced": [
        "top attractions in {city}",
        "museums in {city}",
        "best restaurants in {city}",
    ],
}

# By help_with category
HELP_WITH_TEMPLATES: dict[str, list[str]] = {
    "hotels": ["hotels in {city}"],
    "restaurants": ["best restaurants in {city}", "cafes in {city}"],
    "things_to_do": ["tourist attractions in {city}", "things to do in {city}"],
    "flights": [],  # Flights handled separately via web_search
}


def generate_queries(
    city: str,
    trip_style: str = "balanced",
    help_with: list[str] | None = None,
    day_num: int = 1,
    total_days: int = 1,
) -> list[str]:
    """Generate procedural search queries for a city.

    Args:
        city: City name (e.g., "Tokyo")
        trip_style: Trip style (e.g., "culture", "food", "balanced")
        help_with: List of help categories (e.g., ["itinerary", "hotels"])
        day_num: Current day number (1-indexed)
        total_days: Total days in the trip

    Returns:
        List of search query strings
    """
    queries: list[str] = []

    # Style-based queries
    style_queries = QUERY_TEMPLATES.get(trip_style, QUERY_TEMPLATES["balanced"])
    queries.extend(q.format(city=city) for q in style_queries)

    # Help-with-based queries
    if help_with:
        for hw in help_with:
            hw_queries = HELP_WITH_TEMPLATES.get(hw, [])
            queries.extend(q.format(city=city) for q in hw_queries)

    # Day-specific queries for variety
    if day_num > 1 and total_days > 1:
        # For later days, add variety queries
        variety_queries = [
            "hidden gems in {city}",
            "local favorites in {city}",
            "neighborhoods to explore in {city}",
        ]
        idx = (day_num - 2) % len(variety_queries)
        queries.append(variety_queries[idx].format(city=city))

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for q in queries:
        if q not in seen:
            seen.add(q)
            unique.append(q)

    return unique


# ---------------------------------------------------------------------------
# LLM-assisted query generation (hybrid: complements the procedural base)
# ---------------------------------------------------------------------------

# Cache of LLM-generated queries keyed by (city, trip_style, travel month).
# Repeat builds for the same destination/month reuse the cached list and
# skip the LLM call entirely.
_LLM_QUERY_CACHE: dict[tuple[str, str, str], list[str]] = {}

_query_llm: ChatOpenAI | None = None


def _get_query_llm() -> ChatOpenAI:
    """Lazily create the ChatOpenAI client used for query generation."""
    global _query_llm
    if _query_llm is None:
        _query_llm = ChatOpenAI(
            model="gpt-4o-mini",
            temperature=0.5,
            model_kwargs={"response_format": {"type": "json_object"}},
        )
    return _query_llm


def _month_key(dates: dict | str | None) -> str:
    """Extract a month key ("YYYY-MM" or a month name) from trip dates.

    Used both for the cache key and for prompt context so queries reflect
    the season/events of the actual travel month.
    """
    if not dates:
        return ""
    if isinstance(dates, dict):
        start = str(dates.get("start") or "")
        return start[:7]  # "YYYY-MM-DD" → "YYYY-MM"
    s = str(dates).strip()
    # ISO-like "YYYY-MM-DD..." → "YYYY-MM"; otherwise keep as-is (e.g. "October")
    return s[:7] if len(s) >= 7 and s[:4].isdigit() else s.lower()


async def generate_llm_queries(
    city: str,
    trip_style: str = "",
    preferences: list[str] | None = None,
    dates: dict | str | None = None,
    traveler_type: str | None = None,
) -> list[str]:
    """Generate destination-specific search queries with one small LLM call.

    Complements the zero-token procedural templates with queries tailored to
    the destination: signature experiences, neighborhood names, seasonal
    events for the travel month, and local specialties.

    Results are cached per (city, trip_style, travel month). On any LLM or
    parse failure, returns [] so callers can fall back to procedural queries.

    Args:
        city: City name (e.g., "Tokyo")
        trip_style: Trip style (e.g., "culture", "food", "balanced")
        preferences: User preference strings (e.g., ["vegetarian", "history"])
        dates: Trip dates — dict with a "start" ISO date, or a string
            (ISO date or month name like "October")
        traveler_type: Traveler type (e.g., "solo", "couple", "family")

    Returns:
        List of 3-5 search query strings, or [] on failure.
    """
    month = _month_key(dates)
    cache_key = (city.lower().strip(), (trip_style or "").lower().strip(), month)
    if cache_key in _LLM_QUERY_CACHE:
        logger.info(f"[QUERY_GEN] LLM query cache hit for {city} ({month or 'no month'})")
        return list(_LLM_QUERY_CACHE[cache_key])

    context_bits = []
    if trip_style:
        context_bits.append(f"Trip style: {trip_style}")
    if traveler_type:
        context_bits.append(f"Travelers: {traveler_type}")
    if preferences:
        context_bits.append("Preferences: " + ", ".join(str(p) for p in preferences))
    if month:
        context_bits.append(f"Travel month: {month}")
    context = ("\n" + "\n".join(context_bits)) if context_bits else ""

    prompt = f"""\
You are helping plan a trip to {city}.{context}

Generate 3-5 place-search queries that would surface the best things to do
in {city} for this specific trip. Make each query SPECIFIC to {city} — avoid
generic phrasing that would apply to any city. Draw on:
- Signature experiences or attractions unique to {city}
- Specific neighborhood or district names worth exploring
- Seasonal events, festivals, or seasonal experiences for the travel month (if given)
- Local specialties the city is known for (foods, markets, viewpoints)

Respond with ONLY a JSON object of the form:
{{"queries": ["query 1", "query 2", "query 3"]}}
Each query must be a short search phrase suitable for a places search API.
"""

    try:
        response = await _get_query_llm().ainvoke([{"role": "user", "content": prompt}])
        content = response.content
        if not isinstance(content, str):
            # Handle list-of-content-blocks format from OpenAI
            content = "".join(
                b.get("text", "") for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            ) if isinstance(content, list) else str(content)
        parsed = parse_json_robust(content)
    except Exception as e:
        logger.warning(f"[QUERY_GEN] LLM query generation failed for {city}: {e}")
        return []

    # Accept {"queries": [...]} or a bare list
    raw_queries = parsed.get("queries") if isinstance(parsed, dict) else parsed
    if not isinstance(raw_queries, list):
        logger.warning(f"[QUERY_GEN] No query list in LLM response for {city}")
        return []

    queries = [q.strip() for q in raw_queries if isinstance(q, str) and q.strip()][:5]
    if not queries:
        return []

    _LLM_QUERY_CACHE[cache_key] = queries
    logger.info(f"[QUERY_GEN] LLM generated {len(queries)} queries for {city}: {queries}")
    return list(queries)


def generate_restaurant_queries(city: str) -> list[str]:
    """Generate restaurant-specific queries for meal slots."""
    return [
        f"best restaurants in {city}",
        f"lunch spots in {city}",
        f"dinner restaurants in {city}",
    ]


def generate_hotel_queries(city: str) -> list[str]:
    """Generate hotel-specific queries."""
    return [
        f"best hotels in {city}",
        f"top rated hotels in {city}",
        f"hotels near city center {city}",
    ]


def generate_personalized_queries(
    city: str,
    trip_style: str = "balanced",
    help_with: list[str] | None = None,
    day_num: int = 1,
    total_days: int = 1,
    user_memories: list[dict] | None = None,
    traveler_type: str | None = None,
    user_interests: list[str] | None = None,
) -> list[str]:
    """Generate personalized search queries for a city.

    Extends the base procedural queries with personalization from user
    memories, traveler type, and explicit interests. Falls back to
    generate_queries() when no personalization data is provided.

    Args:
        city: City name (e.g., "Tokyo")
        trip_style: Trip style (e.g., "culture", "food", "balanced")
        help_with: List of help categories (e.g., ["itinerary", "hotels"])
        day_num: Current day number (1-indexed)
        total_days: Total days in the trip
        user_memories: List of user memory dicts from memory service
            (each has "content" and "type" keys)
        traveler_type: Traveler type (e.g., "solo", "couple", "family")
        user_interests: List of interest strings (e.g., ["photography", "history"])

    Returns:
        List of search query strings, personalized where possible
    """
    # Start with the base procedural queries
    queries = generate_queries(
        city=city,
        trip_style=trip_style,
        help_with=help_with,
        day_num=day_num,
        total_days=total_days,
    )

    # Add traveler-type-specific queries
    traveler_queries: dict[str, list[str]] = {
        "family": [
            "family-friendly attractions in {city}",
            "kid-friendly activities in {city}",
        ],
        "solo": [
            "solo travel activities in {city}",
            "safe neighborhoods to explore in {city}",
        ],
        "couple": [
            "romantic spots in {city}",
            "couples activities in {city}",
        ],
        "friends": [
            "group activities in {city}",
            "nightlife in {city}",
        ],
    }
    if traveler_type and traveler_type in traveler_queries:
        queries.extend(q.format(city=city) for q in traveler_queries[traveler_type])

    # Add interest-specific queries
    interest_query_map: dict[str, str] = {
        "photography": "photography spots in {city}",
        "history": "historical landmarks in {city}",
        "art": "art galleries in {city}",
        "music": "live music venues in {city}",
        "nightlife": "bars and clubs in {city}",
        "shopping": "shopping districts in {city}",
        "nature": "parks and nature spots in {city}",
        "architecture": "architectural landmarks in {city}",
        "coffee": "best coffee shops in {city}",
        "vegetarian": "vegetarian restaurants in {city}",
        "vegan": "vegan restaurants in {city}",
        "budget": "free things to do in {city}",
        "luxury": "luxury experiences in {city}",
    }
    if user_interests:
        for interest in user_interests:
            key = interest.lower().strip()
            if key in interest_query_map:
                queries.append(interest_query_map[key].format(city=city))

    # Add queries derived from user memories (e.g., dietary restrictions, preferences)
    if user_memories:
        for memory in user_memories:
            content = memory.get("content", "") if isinstance(memory, dict) else str(memory)
            mtype = memory.get("type", "") if isinstance(memory, dict) else ""
            content_lower = content.lower()

            # Dietary restrictions
            if "vegetarian" in content_lower or "vegan" in content_lower:
                queries.append(f"vegetarian restaurants in {city}")
            if "gluten-free" in content_lower or "celiac" in content_lower:
                queries.append(f"gluten-free restaurants in {city}")
            if "halal" in content_lower:
                queries.append(f"halal restaurants in {city}")
            if "kosher" in content_lower:
                queries.append(f"kosher restaurants in {city}")

            # Activity preferences from memories
            if "dislikes" in content_lower or "avoid" in content_lower:
                # Don't add queries for things they dislike — just skip
                pass
            elif mtype == "preference" and "history" in content_lower:
                queries.append(f"historical sites in {city}")
            elif mtype == "preference" and "beach" in content_lower:
                queries.append(f"beaches near {city}")
            elif mtype == "preference" and "hiking" in content_lower:
                queries.append(f"hiking trails near {city}")

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for q in queries:
        if q not in seen:
            seen.add(q)
            unique.append(q)

    return unique
