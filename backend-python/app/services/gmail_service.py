"""Gmail service — OAuth + booking confirmation parsing.

Uses the same Google OAuth tokens as Calendar (stored encrypted in
user.google_tokens). Scopes: gmail.readonly — to search for booking
confirmation emails.

Parsing pipeline per message:
1. schema.org JSON-LD markup (FlightReservation / LodgingReservation /
   BusReservation / TrainReservation / RentalCarReservation) — the markup
   Gmail itself reads for summary cards. This is the reliable path.
2. Regex heuristics on the plain text body (legacy fallback).
3. One-shot gpt-4o-mini extraction for emails neither path could parse
   (capped per search to keep it cheap).
"""

import asyncio
import base64
import html as html_lib
import json
import re
import secrets
from datetime import datetime, timezone

from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from app.config import settings
from app.services import google_oauth
from app.services.llm_json import parse_json_robust
from app.utils.logger import logger


GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "email",
    "profile",
]

# Cap of LLM fallback calls per search_bookings() run — keeps the endpoint cheap.
MAX_LLM_FALLBACKS = 5

BOOKING_SENDERS = [
    "noreply@booking.com",
    "confirmations@airbnb.com",
    "expedia.com",
    "hotels.com",
    "noreply@southwest.com",
    "noreply@united.com",
    "noreply@delta.com",
    "noreply@american.com",
    "noreply@emirates.com",
    "noreply@lufthansa.com",
    "noreply@british-airways.com",
    "noreply@singaporeair.com",
    "noreply@qatarairways.com",
    "noreply@airindia.com",
    "noreply@indigo.com",
    "noreply@vistara.com",
    "noreply@makemytrip.com",
    "noreply@goibibo.com",
    "noreply@cleartrip.com",
    "noreply@trip.com",
    "noreply@agoda.com",
    "noreply@kayak.com",
    " reservations@",
    " booking@",
    " confirmations@",
    " itinerary@",
]

BOOKING_KEYWORDS = [
    "booking confirmation",
    "flight confirmation",
    "hotel confirmation",
    "reservation confirmed",
    "your booking",
    "your reservation",
    "your flight",
    "your stay",
    "e-ticket",
    "boarding pass",
    "check-in",
    "reservation number",
    "confirmation code",
    "booking reference",
    "itinerary",
]

# schema.org reservation types we understand, mapped to our booking "type".
_RESERVATION_TYPE_MAP = {
    "FlightReservation": "flight",
    "LodgingReservation": "hotel",
    "BusReservation": "bus",
    "TrainReservation": "train",
    "RentalCarReservation": "car",
    "EventReservation": "event",
    "FoodEstablishmentReservation": "restaurant",
    "Reservation": "other",
}


class GmailService:
    def _create_flow(self, code_verifier: str | None = None) -> Flow:
        if not settings.google_client_id or not settings.google_client_secret:
            raise ValueError("Missing Google OAuth env vars")

        return Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [settings.gmail_redirect_uri],
                }
            },
            scopes=GMAIL_SCOPES,
            redirect_uri=settings.gmail_redirect_uri,
            code_verifier=code_verifier,
        )

    def get_oauth_url(self, user_id: str) -> str:
        # PKCE: generate the verifier ourselves so it can round-trip through
        # the signed state token — the callback builds a fresh Flow and would
        # otherwise fetch_token with no verifier → invalid_grant.
        verifier = secrets.token_urlsafe(64)
        flow = self._create_flow(code_verifier=verifier)
        url, _ = flow.authorization_url(
            access_type="offline",
            prompt="consent",
            include_granted_scopes=True,  # incremental authorization
            state=google_oauth.build_connect_state(user_id, "gmail_connect", code_verifier=verifier),
        )
        return url

    async def exchange_code_and_store_tokens(self, code: str, user_id: str, code_verifier: str | None = None):
        flow = self._create_flow(code_verifier=code_verifier)
        await google_oauth.run_sync(flow.fetch_token, code=code)
        # Merge-update: keep scopes/refresh token granted by other flows.
        await google_oauth.save_google_tokens(user_id, flow.credentials)

    async def _get_authorized_client(self, user_id: str):
        """Returns (service, creds, previous_access_token)."""
        creds, prev_token = await google_oauth.load_google_credentials(user_id)
        service = await google_oauth.run_sync(build, "gmail", "v1", credentials=creds)
        return service, creds, prev_token

    async def is_connected(self, user_id: str) -> bool:
        from sqlalchemy import select
        from app.database import async_session
        from app.models import User

        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == int(user_id)))
            user = result.scalar_one_or_none()
            if not user or not user.google_tokens:
                return False
            scopes = user.google_tokens.get("scope", "")
            return "gmail" in scopes

    async def disconnect(self, user_id: str) -> bool:
        """Revoke the Google grant and clear stored tokens."""
        return await google_oauth.revoke_and_disconnect(user_id)

    async def search_bookings(self, user_id: str, max_results: int = 20) -> list[dict]:
        """Search Gmail for booking confirmation emails."""
        service, creds, prev_token = await self._get_authorized_client(user_id)

        # Build search query from sender patterns and keywords
        sender_query = " OR ".join(f"from:{s.strip()}" for s in BOOKING_SENDERS[:10])
        keyword_query = " OR ".join(f'subject:"{k}"' for k in BOOKING_KEYWORDS[:8])
        query = f"({sender_query}) OR ({keyword_query}) newer_than:6m"

        try:
            results = await google_oauth.run_sync(
                service.users().messages().list(
                    userId="me",
                    q=query,
                    maxResults=max_results,
                ).execute
            )

            messages = results.get("messages", [])
            if not messages:
                return []

            # Fetch all messages in one batch HTTP request (documented
            # googleapiclient pattern) executed off the event loop.
            msg_data_map = await asyncio.to_thread(
                self._batch_get_messages, service, [m["id"] for m in messages]
            )

            bookings = []
            llm_fallbacks = 0
            for msg_id in [m["id"] for m in messages]:
                msg_data = msg_data_map.get(msg_id)
                if not msg_data:
                    continue
                booking = self._parse_booking_email(msg_data)
                if booking and not booking.get("details") and not booking.get("confirmationCode") \
                        and not booking.get("dates") and llm_fallbacks < MAX_LLM_FALLBACKS:
                    # Neither JSON-LD nor regex extracted anything — try LLM once.
                    llm_fallbacks += 1
                    enriched = await self._llm_extract_booking(booking)
                    if enriched:
                        booking = enriched
                if booking:
                    bookings.append(booking)

            return bookings
        except Exception as e:
            await google_oauth.handle_auth_failure(user_id, e)
            logger.error(f"[GMAIL] Search failed: {e}")
            if google_oauth.is_refresh_revoked(e):
                raise ValueError("Google connection expired — please reconnect Gmail") from e
            return []
        finally:
            await google_oauth.persist_if_refreshed(user_id, creds, prev_token)

    def _batch_get_messages(self, service, message_ids: list[str]) -> dict[str, dict]:
        """Fetch messages via a single BatchHttpRequest (synchronous)."""
        collected: dict[str, dict] = {}

        def _cb(request_id, response, exception):
            if exception is None and response:
                collected[request_id] = response
            elif exception:
                logger.warning(f"[GMAIL] batch get failed for {request_id}: {exception}")

        try:
            batch = service.new_batch_http_request(callback=_cb)
            for mid in message_ids:
                batch.add(
                    service.users().messages().get(userId="me", id=mid, format="full"),
                    request_id=mid,
                )
            batch.execute()
        except Exception as e:
            logger.error(f"[GMAIL] batch request failed, falling back to sequential: {e}")
            for mid in message_ids:
                try:
                    collected[mid] = service.users().messages().get(
                        userId="me", id=mid, format="full"
                    ).execute()
                except Exception as inner:
                    logger.warning(f"[GMAIL] get {mid} failed: {inner}")
        return collected

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse_booking_email(self, msg_data: dict) -> dict | None:
        """Parse a Gmail message into a booking summary."""
        headers = msg_data.get("payload", {}).get("headers", [])
        subject = next((h["value"] for h in headers if h["name"] == "Subject"), "")
        sender = next((h["value"] for h in headers if h["name"] == "From"), "")
        date_str = next((h["value"] for h in headers if h["name"] == "Date"), "")

        plain, html_body = self._extract_bodies(msg_data.get("payload", {}))

        # Path 1: schema.org JSON-LD markup in the HTML body.
        details = None
        if html_body:
            details = self._details_from_jsonld(html_body)

        text = plain or self._strip_html(html_body)

        booking_type = None
        conf_code = None
        dates = None

        if details:
            booking_type = details.get("kind")
            conf_code = details.get("pnr")
            dates = self._dates_from_details(details)

        # Path 2: regex heuristics on plain text (fills gaps or full fallback).
        if not booking_type:
            booking_type = self._detect_booking_type(subject, sender, text)
        if not conf_code:
            conf_code = self._extract_confirmation_code(subject, text)
        if not dates:
            dates = self._extract_dates(text)

        return {
            "id": msg_data.get("id", ""),
            "threadId": msg_data.get("threadId", ""),
            "subject": subject,
            "sender": sender,
            "date": date_str,
            "snippet": msg_data.get("snippet", "")[:200],
            "type": booking_type,
            "confirmationCode": conf_code,
            "dates": dates,
            "details": details,
            "bodyPreview": text[:500] if text else "",
        }

    # ------------------------------------------------------------------
    # schema.org JSON-LD markup
    # ------------------------------------------------------------------

    _LD_JSON_RE = re.compile(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        re.DOTALL | re.IGNORECASE,
    )

    def _extract_json_ld_items(self, html_body: str) -> list[dict]:
        """Pull every JSON-LD object out of <script type="application/ld+json"> blocks."""
        items: list[dict] = []
        for m in self._LD_JSON_RE.finditer(html_body):
            raw = html_lib.unescape(m.group(1)).strip()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            stack = data if isinstance(data, list) else [data]
            while stack:
                item = stack.pop(0)
                if not isinstance(item, dict):
                    continue
                graph = item.get("@graph")
                if isinstance(graph, list):
                    stack.extend(graph)
                items.append(item)
        return items

    def _reservation_types(self, item: dict) -> set[str]:
        t = item.get("@type") or ""
        if isinstance(t, str):
            t = [t]
        return {str(x) for x in t}

    def _details_from_jsonld(self, html_body: str) -> dict | None:
        """Extract structured booking details from schema.org reservation markup."""
        items = self._extract_json_ld_items(html_body)
        flights: list[dict] = []
        first_details: dict | None = None

        for item in items:
            types = self._reservation_types(item)
            kind = next((v for k, v in _RESERVATION_TYPE_MAP.items() if k in types), None)
            if not kind:
                continue
            if kind == "flight":
                seg = self._flight_segment_from_jsonld(item)
                if seg:
                    seg["pnr"] = self._reservation_number(item)
                    flights.append(seg)
            else:
                d = self._reservation_details_from_jsonld(item, kind)
                if d and first_details is None:
                    first_details = d

        if flights:
            first = dict(flights[0])
            if len(flights) > 1:
                first["segments"] = flights
            return first
        return first_details

    def _reservation_number(self, item: dict) -> str | None:
        return item.get("reservationNumber") or item.get("reservationId") or item.get("bookingNumber")

    @staticmethod
    def _name_of(node) -> str | None:
        if isinstance(node, dict):
            return node.get("name")
        if isinstance(node, str):
            return node
        return None

    @staticmethod
    def _iata_of(node) -> str | None:
        if isinstance(node, dict):
            return node.get("iataCode")
        return None

    @staticmethod
    def _airport(node) -> dict | None:
        if node is None:
            return None
        if isinstance(node, str):
            return {"name": node}
        if isinstance(node, dict):
            out = {"name": node.get("name"), "iata": node.get("iataCode")}
            addr = node.get("address")
            if isinstance(addr, dict) and addr.get("addressLocality"):
                out["city"] = addr.get("addressLocality")
            return {k: v for k, v in out.items() if v}
        return None

    def _flight_segment_from_jsonld(self, item: dict) -> dict | None:
        flight = item.get("reservationFor")
        if not isinstance(flight, dict):
            return None
        airline_node = flight.get("airline") or flight.get("provider") or flight.get("seller")
        airline = self._name_of(airline_node)
        iata = self._iata_of(airline_node)
        flight_number = flight.get("flightNumber")
        # Gmail markup often uses bare flightNumber ("110") + airline.iataCode ("UA").
        if flight_number and iata and not re.match(r"^[A-Za-z]{2}", str(flight_number)):
            flight_number = f"{iata}{flight_number}"
        status = item.get("reservationStatus")
        if isinstance(status, str):
            status = status.rstrip("/").split("/")[-1].replace("Reservation", "").lower() or status
        return {
            "kind": "flight",
            "airline": airline,
            "airlineIata": iata,
            "flightNumber": str(flight_number) if flight_number else None,
            "departureAirport": self._airport(flight.get("departureAirport")),
            "departureTime": flight.get("departureTime"),
            "arrivalAirport": self._airport(flight.get("arrivalAirport")),
            "arrivalTime": flight.get("arrivalTime"),
            "departureTerminal": flight.get("departureTerminal"),
            "arrivalTerminal": flight.get("arrivalTerminal"),
            "passenger": self._name_of(item.get("underName")),
            "status": status if isinstance(status, str) else None,
        }

    def _reservation_details_from_jsonld(self, item: dict, kind: str) -> dict | None:
        res = item.get("reservationFor")
        if not isinstance(res, dict):
            return None

        if kind == "hotel":
            address = res.get("address")
            if isinstance(address, dict):
                parts = [
                    address.get("streetAddress"),
                    address.get("addressLocality"),
                    address.get("addressRegion"),
                    address.get("postalCode"),
                    self._name_of(address.get("addressCountry")) or (address.get("addressCountry") if isinstance(address.get("addressCountry"), str) else None),
                ]
                address_str = ", ".join(p for p in parts if p) or None
            else:
                address_str = address if isinstance(address, str) else None
            return {
                "kind": "hotel",
                "hotelName": res.get("name") or self._name_of(res),
                "address": address_str,
                "phone": res.get("telephone"),
                "checkIn": item.get("checkinTime") or item.get("checkinDate"),
                "checkOut": item.get("checkoutTime") or item.get("checkoutDate"),
                "pnr": self._reservation_number(item),
                "guests": item.get("numAdults") or item.get("partySize"),
                "passenger": self._name_of(item.get("underName")),
            }

        if kind in ("bus", "train"):
            provider = self._name_of(res.get("provider") or res.get("carrier") or res.get("brand"))
            dep_node = res.get("departureStation") or res.get("departureBusStop")
            arr_node = res.get("arrivalStation") or res.get("arrivalBusStop")
            return {
                "kind": kind,
                "provider": provider or res.get("name"),
                "vehicleNumber": res.get("trainNumber") or res.get("busNumber") or res.get("busName") or res.get("trainName"),
                "departureAirport": None,
                "departurePlace": self._name_of(dep_node) if not isinstance(dep_node, dict) else (dep_node.get("name") or dep_node.get("address")),
                "arrivalPlace": self._name_of(arr_node) if not isinstance(arr_node, dict) else (arr_node.get("name") or arr_node.get("address")),
                "departureTime": res.get("departureTime"),
                "arrivalTime": res.get("arrivalTime"),
                "pnr": self._reservation_number(item),
                "passenger": self._name_of(item.get("underName")),
            }

        # Generic reservation (event, restaurant, car, other).
        return {
            "kind": kind,
            "name": self._name_of(res),
            "pnr": self._reservation_number(item),
            "checkIn": item.get("checkinTime") or res.get("startDate"),
            "checkOut": item.get("checkoutTime") or res.get("endDate"),
            "passenger": self._name_of(item.get("underName")),
        }

    def _dates_from_details(self, details: dict) -> dict | None:
        start = details.get("departureTime") or details.get("checkIn")
        end = details.get("arrivalTime") or details.get("checkOut")
        segs = details.get("segments") or []
        if segs:
            start = start or segs[0].get("departureTime")
            end = segs[-1].get("arrivalTime") or end
        if start or end:
            return {"start": start, "end": end} if end else {"start": start}
        return None

    # ------------------------------------------------------------------
    # MIME body extraction (plain text + HTML)
    # ------------------------------------------------------------------

    def _extract_bodies(self, payload: dict) -> tuple[str, str]:
        """Walk MIME parts; return (plain_text, html)."""
        plain = ""
        html_body = ""

        def _decode(part: dict) -> str:
            data = (part.get("body") or {}).get("data")
            if not data:
                return ""
            try:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
            except Exception:
                return ""

        def _walk(part: dict):
            nonlocal plain, html_body
            mime = part.get("mimeType", "")
            if mime == "text/plain" and not plain:
                plain = _decode(part)
            elif mime == "text/html" and not html_body:
                html_body = _decode(part)
            for sub in part.get("parts", []) or []:
                _walk(sub)

        _walk(payload)
        # Single-part messages keep content in payload.body directly.
        if not plain and not html_body and payload.get("body", {}).get("data"):
            mime = payload.get("mimeType", "")
            decoded = _decode(payload)
            if mime == "text/html":
                html_body = decoded
            else:
                plain = decoded
        return plain, html_body

    @staticmethod
    def _strip_html(html_body: str) -> str:
        if not html_body:
            return ""
        text = re.sub(r"<script[\s\S]*?</script>", " ", html_body, flags=re.IGNORECASE)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = html_lib.unescape(text)
        return re.sub(r"\s+", " ", text).strip()

    # ------------------------------------------------------------------
    # Regex fallbacks (legacy)
    # ------------------------------------------------------------------

    def _detect_booking_type(self, subject: str, sender: str, body: str) -> str:
        text = (subject + " " + sender + " " + body).lower()
        if any(w in text for w in ["flight", "airline", "boarding", "e-ticket", "check-in", "airport"]):
            return "flight"
        if any(w in text for w in ["hotel", "stay", "check in", "check-in", "room", "resort", "accommodation"]):
            return "hotel"
        if any(w in text for w in ["train", "railway", "rail "]):
            return "train"
        if any(w in text for w in ["restaurant", "table", "dining"]):
            return "restaurant"
        return "other"

    def _extract_confirmation_code(self, subject: str, body: str) -> str | None:
        patterns = [
            r"(?:confirmation|booking|reservation)\s*(?:code|number|reference|#)[:\s]*([A-Z0-9]{6,12})",
            r"(?:ref|reference)[:\s]*([A-Z0-9]{6,12})",
            r"\b([A-Z0-9]{6})\b",
        ]
        for pattern in patterns:
            match = re.search(pattern, subject + " " + body, re.IGNORECASE)
            if match:
                return match.group(1)
        return None

    def _extract_dates(self, body: str) -> dict | None:
        date_pattern = r"(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4})"
        matches = re.findall(date_pattern, body, re.IGNORECASE)
        if len(matches) >= 2:
            return {"start": matches[0], "end": matches[1]}
        elif len(matches) == 1:
            return {"start": matches[0]}
        return None

    # ------------------------------------------------------------------
    # LLM fallback extraction (one cheap call per unparsed email)
    # ------------------------------------------------------------------

    async def _llm_extract_booking(self, booking: dict) -> dict | None:
        """Ask gpt-4o-mini to extract booking details from an unparsed email."""
        if not settings.openai_api_key:
            return None
        try:
            from langchain_openai import ChatOpenAI

            model = ChatOpenAI(
                model="gpt-4o-mini",
                temperature=0,
                model_kwargs={"response_format": {"type": "json_object"}},
            )
            prompt = (
                "Extract travel booking details from this email. Respond with a JSON object:\n"
                '{"type": "flight|hotel|train|bus|car|restaurant|other|none", '
                '"confirmationCode": string|null, "airline": string|null, "flightNumber": string|null, '
                '"departureAirport": string|null, "departureTime": ISO8601|null, '
                '"arrivalAirport": string|null, "arrivalTime": ISO8601|null, '
                '"hotelName": string|null, "hotelAddress": string|null, '
                '"checkIn": ISO8601|null, "checkOut": ISO8601|null}\n'
                'Use "type":"none" if this is not a booking confirmation.\n\n'
                f"Subject: {booking.get('subject')}\n"
                f"From: {booking.get('sender')}\n"
                f"Body:\n{booking.get('bodyPreview', '')[:3000]}"
            )
            response = await model.ainvoke([{"role": "user", "content": prompt}])
            content = response.content if isinstance(response.content, str) else str(response.content)
            if isinstance(content, list):
                content = "".join(b.get("text", "") for b in content if isinstance(b, dict))
            data = parse_json_robust(content)
            if not isinstance(data, dict) or data.get("type") in (None, "none"):
                return None

            btype = data.get("type", "other")
            details: dict = {"kind": btype, "source": "llm"}
            if data.get("confirmationCode"):
                details["pnr"] = data["confirmationCode"]
                booking["confirmationCode"] = data["confirmationCode"]
            if btype == "flight":
                details.update({
                    "airline": data.get("airline"),
                    "flightNumber": data.get("flightNumber"),
                    "departureAirport": {"name": data["departureAirport"]} if data.get("departureAirport") else None,
                    "departureTime": data.get("departureTime"),
                    "arrivalAirport": {"name": data["arrivalAirport"]} if data.get("arrivalAirport") else None,
                    "arrivalTime": data.get("arrivalTime"),
                })
            elif btype == "hotel":
                details.update({
                    "hotelName": data.get("hotelName"),
                    "address": data.get("hotelAddress"),
                    "checkIn": data.get("checkIn"),
                    "checkOut": data.get("checkOut"),
                })
            else:
                details["name"] = data.get("hotelName") or data.get("airline")

            booking["type"] = btype
            booking["details"] = details
            dates = self._dates_from_details(details)
            if dates:
                booking["dates"] = dates
            return booking
        except Exception as e:
            logger.warning(f"[GMAIL] LLM booking extraction failed: {e}")
            return None


gmail_service = GmailService()
