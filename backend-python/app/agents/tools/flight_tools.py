"""Flight tools — search Duffel offers and create real (test-mode) bookings."""

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig


@tool
async def search_flights(
    origin: str,
    destination: str,
    departure_date: str,
    adults: int = 1,
    return_date: str | None = None,
    cabin_class: str = "economy",
    config: RunnableConfig = None,
) -> str:
    """Search real flight offers between two IATA airport/city codes.

    Use this when the user asks about flights. If the user gives city names
    rather than airport codes, resolve them first (e.g. "Tokyo" -> TYO,
    "London" -> LON, "New York" -> NYC).

    Args:
        origin: IATA code (e.g. "SFO", "JFK", "LHR")
        destination: IATA code (e.g. "HND", "CDG")
        departure_date: YYYY-MM-DD
        adults: number of adults (default 1)
        return_date: optional YYYY-MM-DD for round-trip
        cabin_class: economy | premium_economy | business | first
    """
    from app.services import duffel_service

    try:
        offers = await duffel_service.search_flights(
            origin, destination, departure_date, adults, return_date, cabin_class
        )
    except ValueError:
        return ("Flight search isn't configured yet — the DUFFEL_ACCESS_TOKEN "
                "environment variable needs a Duffel test token.")
    except Exception as e:
        return f"Flight search failed: {e}"

    if not offers:
        return f"No flight offers found for {origin} -> {destination} on {departure_date}."

    lines = [f"Found {len(offers)} flight offers {origin} -> {destination}:"]
    for i, o in enumerate(offers, 1):
        legs = "; ".join(
            f"{s['origin']}->{s['destination']} dep {s['departing_at']}" for s in o["segments"]
        )
        lines.append(f"{i}. {o['airline']} — {o['currency']} {o['total']} | {legs} | offer {o['offerId']}")
    lines.append("Tell the user the options; to book one, call book_flight with the offerId and passenger details.")
    return "\n".join(lines)


@tool
async def book_flight(
    offer_id: str,
    passenger_given_name: str,
    passenger_family_name: str,
    passenger_born_on: str,
    passenger_email: str,
    passenger_phone: str | None = None,
    config: RunnableConfig = None,
) -> str:
    """Book a flight offer — creates a REAL order (test mode: Duffel Airways, no charge).

    IMPORTANT: always confirm the exact offer, price and passenger details with
    the user before calling this. Collect full name, date of birth, and email.

    Args:
        offer_id: offerId returned by search_flights
        passenger_given_name: first/given name
        passenger_family_name: last/family name
        passenger_born_on: date of birth YYYY-MM-DD
        passenger_email: passenger email
        passenger_phone: optional phone (E.164)
    """
    from app.services import duffel_service

    user_id = (config.get("configurable") or {}).get("user_id") if config else None
    try:
        order = await duffel_service.create_order(
            offer_id,
            passenger={
                "given_name": passenger_given_name,
                "family_name": passenger_family_name,
                "born_on": passenger_born_on,
            },
            email=passenger_email,
            phone=passenger_phone,
        )
    except ValueError:
        return "Flight booking isn't configured — DUFFEL_ACCESS_TOKEN is missing."
    except Exception as e:
        return f"Booking failed: {e}"

    if user_id:
        try:
            await duffel_service.persist_flight_booking(int(user_id), order, offer_id)
        except Exception:
            pass  # booking succeeded; persistence is best-effort

    mode = "LIVE" if order.get("liveMode") else "test"
    return (
        f"Booked! Booking reference {order['bookingReference']} ({mode} mode). "
        f"{order['currency']} {order['total']} for {order['passenger']}. "
        f"Route: {', '.join(order['route'])}. "
        f"The booking has been added to Saved items."
    )
