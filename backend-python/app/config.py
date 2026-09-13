"""Application configuration via pydantic-settings."""

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

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
