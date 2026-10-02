"""Trip state definition and normalization helpers.

The slot-filling state machine (SLOT_ORDER, check_slots, apply_slot_answer,
pending states, conditional slots) has been removed. The LLM now drives the
flow directly via plan_trip and ask_question tools. This module keeps only
the TripState type and simple normalization helpers.
"""

from typing import TypedDict, Optional, Any
from datetime import datetime, timedelta
import re


class TripState(TypedDict, total=False):
    # NOTE: `status` and `version` are write-only today (no reader in backend or
    # frontend code), but both are required fields in the frontend TripState
    # contract (frontend/src/stores/tripStore.ts) and are persisted/transmitted
    # with the state — keep them unless the wire contract is cleaned up too.
    # `pace` is read (ctx.travelType) but never written, so it always resolves
    # to the default "moderate" — kept as a future hook for a pace input.
    status: str  # planning | upcoming | completed | archived
    cities: list[dict]  # user-declared destinations (name/order); canonical for display + edit destination
    dates: Optional[dict]
    duration: Optional[int]
    travelers: Optional[dict]
    preferences: Optional[list[str]]
    pace: Optional[str]
    tripStyle: Optional[str]
    helpWith: Optional[list[str]]
    itinerary: Optional[dict]
    routeProposal: Optional[dict]  # canonical for per-city nights/order at itinerary-build time
    bookings: Optional[list[dict]]  # parsed email booking confirmations
    startLocation: Optional[str]
    travelMode: Optional[str]  # walking | driving | transit (intra-city default: walking)
    budget: Optional[dict]  # {amount, scope: "total"|"per_night"|"per_day", text}
    version: int


def create_default_trip_state() -> TripState:
    return {
        "status": "planning",
        "cities": [],
        "version": 0,
    }


# ---------------------------------------------------------------------------
# Normalization helpers (used by plan_trip tool)
# ---------------------------------------------------------------------------

_MONTHS = {
    "january": 0, "february": 1, "march": 2, "april": 3, "may": 4, "june": 5,
    "july": 6, "august": 7, "september": 8, "october": 9, "november": 10, "december": 11,
    "jan": 0, "feb": 1, "mar": 2, "apr": 3, "jun": 5, "jul": 6, "aug": 7,
    "sep": 8, "oct": 9, "nov": 10, "dec": 11,
}


def _assumed_dates_from_month(rough_month: str, duration: int | None = None,
                              part: str | None = None) -> dict:
    """Convert a rough month name (or 'Oct 2026') to assumed concrete dates.

    Picks a Friday in the next occurrence of that month — first Friday by
    default, nearest the 15th for "mid", last for "late"/"end of" — and an
    end date = start + (duration-1) days. Falls back to a 7-day trip if
    duration is unknown.
    """
    month_lower = (rough_month or "").lower().strip()
    target_month: int | None = None
    target_year: int | None = None

    # Try "Oct 2026" or "October 2026" format
    m = re.match(r"^([a-z]+)\s+(\d{4})$", month_lower)
    if m:
        month_name, year_str = m.group(1), m.group(2)
        if month_name in _MONTHS:
            target_month = _MONTHS[month_name]
            target_year = int(year_str)

    if target_month is None:
        # Try "2026-10" format (YYYY-MM)
        m = re.match(r"^(\d{4})-(\d{1,2})$", month_lower)
        if m:
            target_year = int(m.group(1))
            target_month = int(m.group(2)) - 1
        elif month_lower in _MONTHS:
            target_month = _MONTHS[month_lower]
        else:
            # Try numeric month
            try:
                target_month = int(month_lower) - 1
                if not 0 <= target_month <= 11:
                    return {}
            except (ValueError, TypeError):
                return {}

    today = datetime.today()
    if target_year is None:
        year = today.year
        if target_month < today.month or (target_month == today.month and today.day > 15):
            year += 1
    else:
        year = target_year

    # Friday in the right part of the month (default: first Friday).
    first_of_month = datetime(year, target_month + 1, 1)
    if part in ("mid", "middle"):
        target = first_of_month + timedelta(days=14)
        start = target + timedelta(days=(4 - target.weekday()) % 7)
    elif part in ("late", "end", "end of"):
        next_month = datetime(year + (target_month + 2 > 12), (target_month + 2 - 1) % 12 + 1, 1)
        last_of_month = next_month - timedelta(days=1)
        start = last_of_month - timedelta(days=(last_of_month.weekday() - 4) % 7)
    else:
        days_until_friday = (4 - first_of_month.weekday()) % 7  # 4 = Friday
        start = first_of_month + timedelta(days=days_until_friday)
    if start < today:
        start = start + timedelta(weeks=4)

    dur = duration if duration and duration > 0 else 7
    end = start + timedelta(days=dur - 1)
    return {
        "start": start.date().isoformat(),
        "end": end.date().isoformat(),
        "assumed": True,
        "roughMonth": month_lower,
    }


def normalize_dates(dates: Any, duration: int | None = None) -> dict | None:
    """Normalize a dates value into a concrete {start, end, assumed?} dict.

    Accepts:
    - "October", "December", "Oct 2026", "oct" → assumed dates
    - "2026-10-10 to 2026-10-20" → concrete dates
    - {"start": "2026-10-10", "end": "2026-10-20"} → as-is
    - "flexible", "any", "you_decide" → near-future assumed dates
    - "2026-10" (YYYY-MM) → assumed dates for that month
    """
    if dates is None:
        return None

    if isinstance(dates, dict):
        if dates.get("start"):
            return {
                "start": dates["start"],
                "end": dates.get("end"),
                "assumed": dates.get("assumed", False),
            }
        if dates.get("flexible") and dates.get("roughMonth"):
            return _assumed_dates_from_month(dates["roughMonth"], duration)
        return None

    if isinstance(dates, str):
        s = dates.strip().lower()

        # Flexible / any / you_decide → near-future assumed dates
        if s in ("flexible", "any", "you_decide", "let stardrift decide", "not sure", "unsure"):
            today = datetime.today()
            # Default to ~6 weeks out, 7-day trip
            start = today + timedelta(weeks=6)
            dur = duration if duration and duration > 0 else 7
            end = start + timedelta(days=dur - 1)
            return {
                "start": start.date().isoformat(),
                "end": end.date().isoformat(),
                "assumed": True,
                "roughMonth": "flexible",
            }

        # Date range: "2026-10-10 to 2026-10-20" or "2026-10-10 – 2026-10-20"
        m = re.match(r"^(\d{4}-\d{2}-\d{2})\s*(?:to|–|-|until)\s*(\d{4}-\d{2}-\d{2})$", s)
        if m:
            return {"start": m.group(1), "end": m.group(2), "assumed": False}

        # Single date: "2026-10-10"
        m = re.match(r"^(\d{4}-\d{2}-\d{2})$", s)
        if m:
            start = datetime.fromisoformat(m.group(1))
            dur = duration if duration and duration > 0 else 7
            end = start + timedelta(days=dur - 1)
            return {"start": m.group(1), "end": end.date().isoformat(), "assumed": False}

        today = datetime.today()

        # Relative phrases
        if s in ("next week", "this week"):
            start = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
            dur = duration if duration and duration > 0 else 7
            return {"start": start.date().isoformat(),
                    "end": (start + timedelta(days=dur - 1)).date().isoformat(),
                    "assumed": True, "roughMonth": s}
        if s in ("this weekend", "next weekend", "a weekend", "weekend"):
            start = today + timedelta(days=(4 - today.weekday()) % 7 or 7)
            dur = duration if duration and duration > 0 else 3
            return {"start": start.date().isoformat(),
                    "end": (start + timedelta(days=dur - 1)).date().isoformat(),
                    "assumed": True, "roughMonth": s}

        # Holidays — "christmas", "around christmas", "new year", "halloween"
        h = re.sub(r"^(around|over|for|during|at|in|the)\s+", "", s)
        _HOLIDAYS = {
            "christmas": (12, 22), "xmas": (12, 22), "holidays": (12, 22),
            "new year": (12, 29), "new year's": (12, 29), "new years": (12, 29),
            "new year's eve": (12, 30), "halloween": (10, 29),
            "valentine's day": (2, 12), "valentines day": (2, 12),
        }
        if h in _HOLIDAYS:
            mo, day = _HOLIDAYS[h]
            year = today.year if datetime(today.year, mo, day) > today else today.year + 1
            start = datetime(year, mo, day)
            dur = duration if duration and duration > 0 else 7
            return {"start": start.date().isoformat(),
                    "end": (start + timedelta(days=dur - 1)).date().isoformat(),
                    "assumed": True, "roughMonth": s}

        # "early/mid/late <month>" (optionally with year, allows hyphen)
        m = re.match(r"^(early|mid|middle|late|end\s+of)[\s-]+([a-z]+)(?:\s+(\d{4}))?$", s)
        if m and m.group(2) in _MONTHS:
            rough = f"{m.group(2)} {m.group(3)}" if m.group(3) else m.group(2)
            return _assumed_dates_from_month(rough, duration, part=m.group(1))

        # "<month> weekend" / "weekend in <month>"
        m = re.match(r"^(?:a\s+)?weekend\s+(?:in\s+)?([a-z]+)$", s) or \
            re.match(r"^([a-z]+)\s+weekend$", s)
        if m and m.group(1) in _MONTHS:
            return _assumed_dates_from_month(m.group(1), duration or 3)

        # Month name or "Month Year" → assumed dates
        assumed = _assumed_dates_from_month(s, duration)
        if assumed:
            return assumed

        # YYYY-MM format
        m = re.match(r"^(\d{4})-(\d{1,2})$", s)
        if m:
            return _assumed_dates_from_month(s, duration)

    return None


def distribute_nights(trip_state: dict, duration: int) -> None:
    """Distribute nights across cities in trip_state (mutates in place)."""
    cities = trip_state.get("cities", [])
    if not cities or duration < 1:
        return
    total_nights = duration - 1 if duration > 1 else 1
    nights_per = max(1, total_nights // len(cities))
    for city in cities:
        city["nights"] = nights_per
    remainder = total_nights - nights_per * len(cities)
    if remainder > 0:
        cities[0]["nights"] = cities[0].get("nights", 0) + remainder


def resolve_build_cities(trip_state: dict) -> list[dict]:
    """Derive the [{"name", "days"}] list the itinerary builder consumes.

    Canonical source: routeProposal.cities (LLM-proposed night splits and
    visit order). Falls back to trip_state.cities (user-declared list, with
    nights from distribute_nights) when no proposal exists.

    Convention: the first city gets nights+1 days (arrival day counts);
    subsequent cities get exactly their nights in days.
    """
    route_proposal = trip_state.get("routeProposal")
    cities = trip_state.get("cities") or []

    if route_proposal and route_proposal.get("cities"):
        return [
            {"name": c["name"], "days": c["nights"] + 1 if i == 0 else c["nights"]}
            for i, c in enumerate(route_proposal["cities"])
        ]
    return [
        {"name": c["name"], "days": c.get("nights", 1) + 1 if i == 0 else c.get("nights", 1)}
        for i, c in enumerate(cities)
    ]
