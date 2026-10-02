"""Application configuration via pydantic-settings."""

from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Server
    port: int = 5000
    node_env: str = "development"

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/tripwhat"

    # Redis (stream buffering)
    redis_url: str = "redis://localhost:6379"

    # OpenAI
    openai_api_key: str = ""

    # OpenTripMap
    opentripmap_api_key: str = ""

    # SerpApi
    serpapi_api_key: str = ""

    # Google Places
    google_places_api_key: str = ""

    # Google Maps MCP (Grounding Lite)
    google_mcp_access_token: str = ""

    # Tavily (web search)
    tavily_api_key: str = ""

    # LangSmith (tracing + evaluation)
    langsmith_api_key: str = ""
    langsmith_tracing: bool = False
    langsmith_project: str = "tripwhat-agent"
    langsmith_workspace_id: str = ""

    # GeoDB
    geodb_api_key: str = ""
    geodb_host: str = "wft-geo-db.p.rapidapi.com"

    # JWT
    jwt_secret: str = "fallback-secret"
    jwt_expires_in_days: int = 7

    # CORS
    frontend_url: str = "http://localhost:5173"

    # Google Calendar/Gmail OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:5000/api/google/oauth/callback"
    gmail_redirect_uri: str = "http://localhost:5000/api/google/gmail/oauth/callback"
    # Optional Fernet key (urlsafe-b64 32 bytes) for encrypting Google tokens at
    # rest. When empty, a key is derived from jwt_secret.
    google_token_encryption_key: str = ""

    # Link import (social reel -> saved places)
    google_video_understanding_key: str = ""  # Gemini API key for video understanding
    apify_token: str = ""                     # optional fallback scraper for IG/TikTok
    duffel_access_token: str = ""             # duffel_test_... — flight search + test booking
    allow_live_bookings: bool = False         # must be true to book with a duffel_live_ token

    # Agent capacity controls
    fallback_model: str = "gpt-4o-mini"       # used when the primary model is rate-limited
    max_concurrent_agent_runs: int = 8        # global cap on in-flight agent runs
    max_runs_per_user: int = 2                # per-user cap on in-flight agent runs
    user_messages_per_minute: int = 12        # per-user send limit

    model_config = {"env_file": ".env", "extra": "ignore"}

    @model_validator(mode="after")
    def _require_strong_jwt_secret_outside_dev(self):
        if self.node_env.lower() not in ("development", "test") and (
            self.jwt_secret == "fallback-secret" or len(self.jwt_secret) < 32
        ):
            raise ValueError(
                "JWT_SECRET must be set to a random value of at least 32 characters "
                f"when NODE_ENV is '{self.node_env}'"
            )
        return self


settings = Settings()
