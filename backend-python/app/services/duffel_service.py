"""Duffel flight search + booking (test mode — real orders, no money).

Flow: create offer request -> pick offer -> create order (balance payment).
Docs: https://duffel.com/docs/api/v2
"""

import httpx

from app.config import settings
from app.utils.logger import logger

BASE = "https://api.duffel.com/air"


def _headers() -> dict:
    if not settings.duffel_access_token:
        raise ValueError("DUFFEL_ACCESS_TOKEN not configured")
    return {
        "Authorization": f"Bearer {settings.duffel_access_token}",
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
    }


async def search_flights(
    origin: str,
    destination: str,
    departure_date: str,
    adults: int = 1,
    return_date: str | None = None,
    cabin_class: str = "economy",
    max_offers: int = 5,
) -> list[dict]:
    """Create an offer request and return simplified offers."""
    slices = [{"origin": origin.upper(), "destination": destination.upper(), "departure_date": departure_date}]
    if return_date:
        slices.append({"origin": destination.upper(), "destination": origin.upper(), "departure_date": return_date})
    payload = {
        "data": {
            "slices": slices,
            "passengers": [{"type": "adult"} for _ in range(max(1, adults))],
            "cabin_class": cabin_class,
            "max_connections": 2,
        }
    }
    async with httpx.AsyncClient(timeout=45) as client:
        resp = await client.post(f"{BASE}/offer_requests?supplier_timeout=20000", headers=_headers(), json=payload)
        if resp.status_code >= 400:
            raise RuntimeError(f"Duffel offer request {resp.status_code}: {resp.text[:300]}")
        data = resp.json()["data"]

    offers = []
    for o in (data.get("offers") or [])[: max_offers * 3]:  # over-fetch, dedupe below
        segments = []
        for s in o.get("slices") or []:
            for seg in s.get("segments") or []:
                segments.append({
                    "origin": seg["origin"]["iata_code"],
                    "destination": seg["destination"]["iata_code"],
                    "departing_at": seg.get("departing_at"),
                    "arriving_at": seg.get("arriving_at"),
                    "carrier": (seg.get("operating_carrier") or {}).get("name")
                               or (seg.get("marketing_carrier") or {}).get("name"),
                    "flight_number": (seg.get("marketing_carrier_flight_number")),
                    "duration": seg.get("duration"),
                })
        offers.append({
            "offerId": o["id"],
            "total": o.get("total_amount"),
            "currency": o.get("total_currency"),
            "airline": (o.get("owner") or {}).get("name"),
            "expiresAt": o.get("expires_at"),
            "passengerIds": [p["id"] for p in o.get("passengers") or []],
            "segments": segments,
        })
        if len(offers) >= max_offers:
            break
    return offers


async def get_offer(offer_id: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{BASE}/offers/{offer_id}", headers=_headers())
        if resp.status_code >= 400:
            raise RuntimeError(f"Duffel get offer {resp.status_code}: {resp.text[:300]}")
        return resp.json()["data"]


async def create_order(
    offer_id: str,
    passenger: dict,
    email: str,
    phone: str | None = None,
) -> dict:
    """Create a real (test-mode) order. passenger: {given_name, family_name, born_on, title, gender}."""
    offer = await get_offer(offer_id)
    pax_ids = [p["id"] for p in offer.get("passengers") or []]
    if not pax_ids:
        raise RuntimeError("Offer has no passenger slots")

    passengers = [{
        "id": pax_ids[0],
        "given_name": passenger["given_name"],
        "family_name": passenger["family_name"],
        "born_on": passenger["born_on"],
        "email": email,
        "phone_number": phone or "+10000000000",
        "title": passenger.get("title", "mr"),
        "gender": passenger.get("gender", "m"),
    }]

    payload = {
        "data": {
            "type": "instant",
            "selected_offers": [offer_id],
            "payments": [{
                "type": "balance",
                "currency": offer["total_currency"],
                "amount": offer["total_amount"],
            }],
            "passengers": passengers,
        }
    }
    async with httpx.AsyncClient(timeout=45) as client:
        resp = await client.post(f"{BASE}/orders", headers=_headers(), json=payload)
        if resp.status_code >= 400:
            raise RuntimeError(f"Duffel create order {resp.status_code}: {resp.text[:400]}")
        order = resp.json()["data"]

    slices = order.get("slices") or []
    route = []
    for s in slices:
        for seg in s.get("segments") or []:
            route.append(
                f"{seg['origin']['iata_code']}->{seg['destination']['iata_code']} "
                f"{seg.get('departing_at')}"
            )
    return {
        "orderId": order["id"],
        "bookingReference": order.get("booking_reference"),
        "total": order.get("total_amount"),
        "currency": order.get("total_currency"),
        "liveMode": order.get("live_mode"),
        "route": route,
        "passenger": f"{passenger['given_name']} {passenger['family_name']}",
    }


async def persist_flight_booking(user_id: int, order: dict, offer_id: str) -> None:
    """Record the booking as a SavedItem so it shows up in the Saved tab."""
    from app.database import async_session
    from app.models.saved_item import SavedItem

    async with async_session() as db:
        db.add(SavedItem(
            user_id=user_id,
            item_type="flight",
            name=f"Flight {order['route'][0].split()[0] if order['route'] else ''} — {order['bookingReference']}",
            data={
                "orderId": order["orderId"],
                "bookingReference": order["bookingReference"],
                "offerId": offer_id,
                "price": float(order["total"]) if order.get("total") else None,
                "currency": order.get("currency"),
                "route": order["route"],
                "passenger": order["passenger"],
                "liveMode": order["liveMode"],
                "source": "duffel",
            },
        ))
        await db.commit()
