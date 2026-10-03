"""SerpApi provider — flights + hotels search via Google SERP."""

import httpx

from app.config import settings
from app.utils.logger import logger


class SerpApiProvider:
    BASE_URL = "https://serpapi.com/search"

    def _api_key(self) -> str:
        return settings.serpapi_api_key

    async def search_flights(
        self,
        origin: str,
        destination: str,
        departure_date: str,
        return_date: str | None = None,
        adults: int = 1,
        children: int = 0,
        travel_class: str = "economy",
        max_price: int | None = None,
        currency: str = "USD",
    ) -> list[dict]:
        if not self._api_key():
            logger.warning("SERPAPI_API_KEY not configured")
            return []

        params = {
            "engine": "google_flights",
            "departure_id": origin,
            "arrival_id": destination,
            "gl": "us",
            "hl": "en",
            "currency": currency,
            "type": "round_trip" if return_date else "one_way",
            "outbound_date": departure_date,
            "adults": adults,
            "children": children,
            "travel_class": travel_class,
            "api_key": self._api_key(),
        }
        if return_date:
            params["return_date"] = return_date
        if max_price:
            params["max_price"] = max_price

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(self.BASE_URL, params=params)
                data = resp.json()
        except Exception as e:
            logger.error(f"Flight search failed: {e}")
            return []

        flights = []
        is_round_trip = bool(return_date)
        for item in data.get("best_flights", []) + data.get("other_flights", []):
            all_legs = []
            for leg in item.get("flights", []):
                all_legs.append({
                    "departureAirport": {
                        "code": leg.get("departure_airport", {}).get("id", ""),
                        "name": leg.get("departure_airport", {}).get("name", ""),
                        "time": leg.get("departure_airport", {}).get("time", ""),
                    },
                    "arrivalAirport": {
                        "code": leg.get("arrival_airport", {}).get("id", ""),
                        "name": leg.get("arrival_airport", {}).get("name", ""),
                        "time": leg.get("arrival_airport", {}).get("time", ""),
                    },
                    "airline": leg.get("airline", ""),
                    "flightNumber": leg.get("flight_number", ""),
                    "duration": leg.get("duration", 0),
                    "airplane": leg.get("airplane", ""),
                    "travelClass": leg.get("travel_class", ""),
                    "overnight": leg.get("overnight", False),
                })

            # For round-trip, split legs into outbound and return groups.
            # The split point is the first leg that departs from the destination
            # airport (i.e., the return journey begins).
            outbound_legs = all_legs
            return_legs: list[dict] = []
            if is_round_trip and len(all_legs) > 1:
                dest_code = destination  # arrival_id passed by caller
                for idx, leg in enumerate(all_legs):
                    dep_code = leg.get("departureAirport", {}).get("code", "")
                    if dep_code and dep_code.upper() == dest_code.upper() and idx > 0:
                        outbound_legs = all_legs[:idx]
                        return_legs = all_legs[idx:]
                        break

            flight = {
                "id": item.get("flight_id", ""),
                "legs": all_legs,  # keep flat list for backwards compat
                "outboundLegs": outbound_legs,
                "returnLegs": return_legs,
                "layovers": [],
                "totalDuration": item.get("total_duration", 0),
                "price": item.get("price", 0),
                "currency": currency,
                "type": "round-trip" if return_date else "one-way",
                "isBest": item in data.get("best_flights", []),
                "bookingLink": item.get("booking_token", ""),
            }
            for leg in item.get("flights", []):
                if leg.get("layovers"):
                    for layover in leg["layovers"]:
                        flight["layovers"].append({
                            "airportCode": layover.get("airport", {}).get("id", ""),
                            "duration": layover.get("duration", 0),
                            "overnight": layover.get("overnight", False),
                        })

            flights.append(flight)

        return flights

    async def search_hotels(
        self,
        destination: str,
        check_in: str,
        check_out: str,
        adults: int = 2,
        children: int = 0,
        min_price: int | None = None,
        max_price: int | None = None,
        currency: str = "USD",
        sort: str = "relevance",
    ) -> list[dict]:
        if not self._api_key():
            logger.warning("SERPAPI_API_KEY not configured")
            return []

        params = {
            "engine": "google_hotels",
            "q": destination,
            "check_in_date": check_in,
            "check_out_date": check_out,
            "adults": adults,
            "children": children,
            "currency": currency,
            "gl": "us",
            "hl": "en",
            "sorting": sort,
            "api_key": self._api_key(),
        }
        if min_price:
            params["min_price"] = min_price
        if max_price:
            params["max_price"] = max_price

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(self.BASE_URL, params=params)
                data = resp.json()
        except Exception as e:
            logger.error(f"Hotel search failed: {e}")
            return []

        hotels = []
        for item in data.get("properties", []):
            hotels.append({
                "id": item.get("property_token", ""),
                "name": item.get("name", ""),
                "type": item.get("type", ""),
                "ratePerNight": item.get("rate_per_night", {}).get("extracted_lowest"),
                "totalRate": item.get("total_rate", {}).get("extracted_lowest"),
                "currency": currency,
                "rating": item.get("overall_rating"),
                "reviewsCount": item.get("reviews"),
                "amenities": item.get("amenities", []),
                "bookingLink": item.get("booking_token", ""),
                "images": [{"thumbnail": img.get("thumbnail"), "original": img.get("original")} for img in item.get("images", [])],
            })

        return hotels

    async def autocomplete(self, term: str) -> list[dict]:
        if not self._api_key():
            return []

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(self.BASE_URL, params={
                    "engine": "google_autocomplete",
                    "q": term,
                    "api_key": self._api_key(),
                })
                data = resp.json()
        except Exception:
            return []

        suggestions = []
        for item in data.get("suggestions", []):
            suggestions.append({
                "code": item.get("value", ""),
                "name": item.get("value", ""),
            })
        return suggestions


serpapi_provider = SerpApiProvider()
