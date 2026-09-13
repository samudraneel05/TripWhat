"""Gmail booking tools — get_email_bookings and import_email_booking.

Read the user's Gmail booking confirmations (parsed by gmail_service) into
trip_state["bookings"], and import a chosen booking into the itinerary as a
FlightOption / HotelRecommendation.
"""

from typing import Annotated

from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool, InjectedToolCallId
from langgraph.prebuilt import InjectedState
from langgraph.types import Command

from app.utils.logger import logger


def _user_id(config: RunnableConfig | None) -> str | None:
    if not config:
        return None
    return (config.get("configurable") or {}).get("user_id")


def _summarize(booking: dict) -> str:
    d = booking.get("details") or {}
    parts = [booking.get("type", "booking")]
    if d.get("airline") or d.get("flightNumber"):
        parts.append(" ".join(filter(None, [d.get("airline"), d.get("flightNumber")])))
        dep = (d.get("departureAirport") or {}).get("iata") or (d.get("departureAirport") or {}).get("name")
        arr = (d.get("arrivalAirport") or {}).get("iata") or (d.get("arrivalAirport") or {}).get("name")
        if dep or arr:
            parts.append(f"{dep or '?'} → {arr or '?'}")
    elif d.get("hotelName"):
        parts.append(d["hotelName"])
    if d.get("departureTime") or d.get("checkIn"):
        parts.append(f"on {(d.get('departureTime') or d.get('checkIn'))[:10]}")
    if booking.get("confirmationCode"):
        parts.append(f"(conf {booking['confirmationCode']})")
    return " ".join(parts)


@tool
async def get_email_bookings(
    state: Annotated[dict, InjectedState] = None,
    config: RunnableConfig = None,
    tool_call_id: Annotated[str, InjectedToolCallId] = None,
) -> Command:
    """Search the user's connected Gmail for travel booking confirmations
    (flights, hotels, trains, buses) and list what was found.

    Requires the user to have connected Gmail from the trip's Bookings tab.
    Results are stored in trip_state["bookings"] — use import_email_booking
    to add one of them to the itinerary.
    """
    user_id = _user_id(config)
    if not user_id:
        return Command(update={"messages": [ToolMessage(
            content="I couldn't determine your user account. Please try again.",
            tool_call_id=tool_call_id,
        )]})

    from app.services.gmail_service import gmail_service

    try:
        if not await gmail_service.is_connected(str(user_id)):
            return Command(update={"messages": [ToolMessage(
                content="Gmail isn't connected. Ask the user to open the Bookings tab and click 'Connect Gmail' first.",
                tool_call_id=tool_call_id,
            )]})
        bookings = await gmail_service.search_bookings(str(user_id))
    except Exception as e:
        logger.error(f"[GMAIL_TOOL] search_bookings failed: {e}")
        return Command(update={"messages": [ToolMessage(
            content="I couldn't search Gmail right now — the connection may need to be re-authorized in the Bookings tab.",
            tool_call_id=tool_call_id,
        )]})

    if not bookings:
        return Command(update={"messages": [ToolMessage(
            content="No booking confirmations found in the last 6 months of Gmail.",
            tool_call_id=tool_call_id,
        )]})

    lines = "\n".join(f"- [{b.get('id')}] {_summarize(b)}" for b in bookings)
    msg = f"Found {len(bookings)} booking confirmation(s) in Gmail:\n{lines}\n\nUse import_email_booking with a booking id to add one to the trip."

    return Command(
        update={
            "trip_state": {"bookings": bookings},
            "messages": [ToolMessage(content=msg, tool_call_id=tool_call_id)],
        }
    )


@tool
async def import_email_booking(
    booking_id: str,
    state: Annotated[dict, InjectedState] = None,
    config: RunnableConfig = None,
    tool_call_id: Annotated[str, InjectedToolCallId] = None,
) -> Command:
    """Import a Gmail booking into the current trip's itinerary.

    Flight bookings become flight options; hotel bookings become hotel
    recommendations. Call get_email_bookings first if trip_state has no
    bookings yet.

    Args:
        booking_id: The id of the booking returned by get_email_bookings
                    (a Gmail message id).
    """
    trip_state = (state or {}).get("trip_state") or {}
    bookings = trip_state.get("bookings") or []

    booking = next((b for b in bookings if b.get("id") == booking_id), None)

    if not booking:
        # Try a fresh search — maybe bookings haven't been fetched yet.
        user_id = _user_id(config)
        if user_id:
            try:
                from app.services.gmail_service import gmail_service
                fresh = await gmail_service.search_bookings(str(user_id))
                bookings = fresh
                booking = next((b for b in fresh if b.get("id") == booking_id), None)
            except Exception as e:
                logger.warning(f"[GMAIL_TOOL] re-fetch failed: {e}")

    if not booking:
        return Command(update={"messages": [ToolMessage(
            content=f"Couldn't find a booking with id '{booking_id}'. Call get_email_bookings to list what's available.",
            tool_call_id=tool_call_id,
        )]})

    from app.services.booking_import import merge_booking_into_trip_state

    # Partial write — merge_booking_into_trip_state returns only the keys it
    # owns (bookings, itinerary) so the right-wins trip_state merge can't
    # clobber keys another tool set in the same step.
    update, message = merge_booking_into_trip_state(trip_state, booking)
    if bookings:
        update["bookings"] = bookings

    return Command(
        update={
            "trip_state": update,
            "messages": [ToolMessage(content=message, tool_call_id=tool_call_id)],
        }
    )
