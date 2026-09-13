"""Google Calendar service — OAuth + event management.

Shares Google OAuth token handling with gmail_service via
app.services.google_oauth (encrypted tokens, merge-update saves, signed
connect-state nonces, asyncio.to_thread for blocking googleapiclient calls).
"""

from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from app.config import settings
from app.services import google_oauth
from app.utils.logger import logger

CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "openid",
    "email",
    "profile",
]


class CalendarService:
    def _create_flow(self) -> Flow:
        if not settings.google_client_id or not settings.google_client_secret:
            raise ValueError("Missing Google OAuth env vars")

        return Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [settings.google_redirect_uri],
                }
            },
            scopes=CALENDAR_SCOPES,
            redirect_uri=settings.google_redirect_uri,
        )

    def get_oauth_url(self, user_id: str) -> str:
        flow = self._create_flow()
        url, _ = flow.authorization_url(
            access_type="offline",
            prompt="consent",
            include_granted_scopes=True,  # incremental authorization
            state=google_oauth.build_connect_state(user_id, "calendar_connect"),
        )
        return url

    async def exchange_code_and_store_tokens(self, code: str, user_id: str):
        flow = self._create_flow()
        await google_oauth.run_sync(flow.fetch_token, code=code)
        # Merge-update: preserve refresh token + scopes granted by other flows.
        await google_oauth.save_google_tokens(user_id, flow.credentials)

    async def _get_authorized_client(self, user_id: str):
        """Returns (service, creds, previous_access_token)."""
        creds, prev_token = await google_oauth.load_google_credentials(user_id)
        service = await google_oauth.run_sync(build, "calendar", "v3", credentials=creds)
        return service, creds, prev_token

    async def disconnect(self, user_id: str) -> bool:
        """Revoke the Google grant and clear stored tokens."""
        return await google_oauth.revoke_and_disconnect(user_id)

    async def list_upcoming_events(self, user_id: str, max_results: int = 20) -> list[dict]:
        service, creds, prev_token = await self._get_authorized_client(user_id)
        from datetime import datetime, timezone
        try:
            events_result = await google_oauth.run_sync(
                service.events().list(
                    calendarId="primary",
                    timeMin=datetime.now(timezone.utc).isoformat() + "Z",
                    maxResults=max_results,
                    singleEvents=True,
                    orderBy="startTime",
                ).execute
            )
        except Exception as e:
            await google_oauth.handle_auth_failure(user_id, e)
            raise
        finally:
            await google_oauth.persist_if_refreshed(user_id, creds, prev_token)
        return events_result.get("items", [])

    async def create_event(self, user_id: str, event_data: dict) -> dict:
        service, creds, prev_token = await self._get_authorized_client(user_id)
        try:
            event = await google_oauth.run_sync(
                service.events().insert(
                    calendarId="primary",
                    body={
                        "summary": event_data.get("summary"),
                        "description": event_data.get("description"),
                        "location": event_data.get("location"),
                        "start": {"dateTime": event_data.get("start"), "timeZone": event_data.get("timeZone")},
                        "end": {"dateTime": event_data.get("end"), "timeZone": event_data.get("timeZone")},
                    },
                ).execute
            )
        except Exception as e:
            await google_oauth.handle_auth_failure(user_id, e)
            raise
        finally:
            await google_oauth.persist_if_refreshed(user_id, creds, prev_token)
        return event


calendar_service = CalendarService()
