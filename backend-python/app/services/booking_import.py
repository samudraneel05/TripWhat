"""Import parsed email bookings into a trip's itinerary state.

Converts bookings produced by gmail_service.search_bookings() into itinerary
schema objects (FlightOption / HotelRecommendation) and merges them into
trip_state["itinerary"], plus records the raw booking in trip_state["bookings"].
"""

from datetime import datetime, timezone

from app.schemas.itinerary import (
    FlightLeg,
    FlightOption,
    HotelRecommendation,
)
from app.utils.logger import logger


def _date_of(iso_str: str | None) -> str | None:
    """ISO datetime → YYYY-MM-DD, or the string itself if it's already a date."""
    if not iso_str:
        return None
    try:
        return datetime.fromisoformat(str(iso_str).replace("Z", "+00:00")).date().isoformat()
    except (ValueError, TypeError):
        return str(iso_str)[:10]


def _airport_label(airport: dict | None) -> str:
    if not airport:
        return ""
    name = airport.get("name") or ""
    iata = airport.get("iata") or ""
    return f"{name} ({iata})" if name and iata else name or iata


def booking_to_flight_option(booking: dict) -> dict | None:
    """Convert a flight booking into a FlightOption dict."""
    details = booking.get("details") or {}
    segments = details.get("segments") or [details]

    legs: list[dict] = []
    for seg in segments:
        leg = FlightLeg(
            departureAirport={
                "name": (seg.get("departureAirport") or {}).get("name", ""),
                "code": (seg.get("departureAirport") or {}).get("iata", ""),
                "time": seg.get("departureTime") or "",
            },
            arrivalAirport={
                "name": (seg.get("arrivalAirport") or {}).get("name", ""),
                "code": (seg.get("arrivalAirport") or {}).get("iata", ""),
                "time": seg.get("arrivalTime") or "",
            },
            airline=seg.get("airline") or "",
            flightNumber=seg.get("flightNumber") or "",
        )
        legs.append(leg.model_dump())

    if not legs:
        return None

    option = FlightOption(
        id=f"email-{booking.get('id', '')}",
        legs=[FlightLeg(**l) for l in legs],
        outboundLegs=[FlightLeg(**legs[0])],
        returnLegs=[FlightLeg(**l) for l in legs[1:]],
        type="imported",
        bookingLink="",
    )
    data = option.model_dump()
    # Keep human-readable context the schema doesn't carry.
    data["pnr"] = details.get("pnr") or booking.get("confirmationCode")
    data["source"] = "gmail"
    data["emailSubject"] = booking.get("subject")
    return data


def booking_to_hotel(booking: dict) -> dict | None:
    """Convert a hotel booking into a HotelRecommendation dict."""
    details = booking.get("details") or {}
    name = details.get("hotelName") or booking.get("subject")
    if not name:
        return None

    conf = details.get("pnr") or booking.get("confirmationCode")
    dates_bits = []
    if details.get("checkIn"):
        dates_bits.append(f"check-in {_date_of(details['checkIn'])}")
    if details.get("checkOut"):
        dates_bits.append(f"check-out {_date_of(details['checkOut'])}")

    hotel = HotelRecommendation(
        name=name,
        address=details.get("address"),
        phone=details.get("phone"),
        description=(
            f"Imported from email confirmation{f' — {conf}' if conf else ''}"
            + (f". {', '.join(dates_bits)}" if dates_bits else "")
        ),
        whyPicked="Your existing reservation (imported from Gmail)",
    )
    data = hotel.model_dump()
    data["confirmationCode"] = conf
    data["checkIn"] = details.get("checkIn")
    data["checkOut"] = details.get("checkOut")
    data["source"] = "gmail"
    return data


def merge_booking_into_trip_state(trip_state: dict, booking: dict) -> tuple[dict, str]:
    """Merge a parsed booking into trip_state. Returns (update, message).

    The returned update contains ONLY the trip_state keys this merge owns —
    "bookings" always, and "itinerary" only when a FlightOption /
    HotelRecommendation was actually attached. Callers merge the update into
    their own copy (or send it as a partial Command update) so keys owned by
    other writers are never clobbered by a stale snapshot.

    - Records the booking in trip_state["bookings"] (deduped by id).
    - If an itinerary exists, appends a FlightOption / HotelRecommendation.
    """
    trip_state = trip_state or {}
    update: dict = {}
    booking_id = booking.get("id") or booking.get("confirmationCode") or ""

    bookings = [b for b in (trip_state.get("bookings") or []) if b.get("id") != booking_id]
    entry = dict(booking)
    entry["importedAt"] = datetime.now(timezone.utc).isoformat()
    bookings.append(entry)
    update["bookings"] = bookings

    itinerary = trip_state.get("itinerary")
    if not itinerary:
        return update, "Booking saved to trip (no itinerary yet — it will attach when you build one)."

    itinerary = dict(itinerary)
    btype = booking.get("type")

    if btype == "flight":
        option = booking_to_flight_option(booking)
        if option:
            existing = itinerary.get("flightOptions") or []
            existing = [f for f in existing if f.get("id") != option["id"]]
            existing.append(option)
            itinerary["flightOptions"] = existing
            update["itinerary"] = itinerary
            seg = (booking.get("details") or {})
            label = " ".join(filter(None, [seg.get("airline"), seg.get("flightNumber")])) or booking.get("subject", "flight")
            return update, f"Added flight {label} to your itinerary."
        return update, "Booking saved (could not map flight details into the itinerary)."

    if btype == "hotel":
        hotel = booking_to_hotel(booking)
        if hotel:
            existing = itinerary.get("hotelRecommendations") or []
            existing = [h for h in existing if h.get("name") != hotel.get("name")]
            existing.append(hotel)
            itinerary["hotelRecommendations"] = existing
            update["itinerary"] = itinerary
            return update, f"Added hotel {hotel['name']} to your itinerary."
        return update, "Booking saved (could not map hotel details into the itinerary)."

    return update, f"Saved {btype or 'booking'} to your trip."
