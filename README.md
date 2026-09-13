# TripWhat

An AI travel agent that closes the loop: **see a place on social media → plan the trip → book it**.

You share an Instagram reel, TikTok, or YouTube link. TripWhat watches the video, pulls out every place it mentions, and saves them. Chat with it to turn those into a real itinerary — it searches live inventory, pulls your existing bookings straight out of Gmail, drops events onto your Google Calendar, and when you're ready, it actually books the flight.

## Demo video

> **[Watch the 2-minute demo](<VIDEO_URL_HERE>)**
>
> *(Link placeholder — recording in progress.)*

## The flow

1. **Inspiration in.** Paste a social link in the Saved tab — Gemini video understanding + metadata extraction pull out the places, resolved against Google Places.
2. **Plan in chat.** LangGraph agent asks smart follow-up questions (native `interrupt()` cards), searches the web in parallel, and builds a day-by-day itinerary with photos, ratings, and routes.
3. **Bookings from Gmail.** One click connects Gmail (OAuth, encrypted tokens); confirmation emails are parsed and merged into your trip automatically.
4. **Onto your Calendar.** The agent creates Google Calendar events for flights, hotels, and activities.
5. **Actually book it.** `search_flights` + `book_flight` tools hit the Duffel API — real order creation with a booking reference (test mode: no money moves, real orders).

## External apps connected

| App | What the agent does with it |
|---|---|
| **Instagram / TikTok / YouTube** | Ingests shared links, extracts places from video + audio + captions |
| **Google Gemini** | Video understanding — reads on-screen text and spoken place names |
| **Google Places** | Resolves every candidate to a real placeId, rating, photos, coordinates |
| **Gmail** | OAuth connect → finds flight/hotel confirmations → merges into trips |
| **Google Calendar** | Creates itinerary events with times and locations |
| **Duffel** | Searches live flight offers and creates real bookings (test mode) |
| **OpenAI** | Agent reasoning, extraction, Whisper transcription fallback |
| **Tavily** | Parallel web search during planning |

Plus OpenTripMap, Geoapify, SerpApi, and OpenWeather for places/routes/hotels/weather.

## Setup

```bash
# 1. Infra
brew services start redis          # or: redis-server --daemonize yes
createdb tripwhat                  # or: docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres

# 2. Backend
cd backend-python && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:asgi_app --reload --port 5000

# 3. Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```

**Backend** (`backend-python/.env` — see `.env.example` for the full list):
```
OPENAI_API_KEY=...
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/tripwhat
REDIS_URL=redis://localhost:6379
JWT_SECRET=...
GOOGLE_PLACES_API_KEY=...

# Optional integrations
GOOGLE_CLIENT_ID=...              # sign-in + Gmail + Calendar OAuth
GOOGLE_CLIENT_SECRET=...
GOOGLE_VIDEO_UNDERSTANDING_KEY=... # Gemini — link import video tier
DUFFEL_ACCESS_TOKEN=duffel_test_... # flight search + booking (free test token)
APIFY_TOKEN=...                   # optional scraper fallback
```

## Reliability & testing

```bash
cd backend-python && pytest        # 109 backend tests
cd frontend && npm test            # 40 frontend tests
cd frontend && npm run build       # production build
```

Verified end-to-end, not just unit-tested:

- **OAuth**: Google sign-in completes a real PKCE flow — the `code_verifier` round-trips through a signed JWT state token; Gmail and Calendar grants merge incrementally without clobbering each other.
- **Agent state**: LangGraph Postgres checkpointer is the source of truth — pending questions survive page reloads, manual itinerary edits and Gmail imports sync back into the checkpoint, concurrent sends return a clean 409.
- **Link import**: tested against real Instagram reels — caption-rich links resolve via metadata alone; caption-sparse videos escalate to Gemini video understanding; deduped against existing saved places.
- **Booking**: a real Duffel Airways test order was created and returned a live booking reference (`ord_...` / PNR).
- **Streaming**: Redis-buffered token streams replay after refresh/disconnect mid-turn.

## Architecture

- **Backend**: FastAPI + Socket.IO + LangGraph + PostgreSQL (checkpointed agent state) + Redis (stream buffering)
- **Frontend**: React 18 + Vite + Tailwind + Zustand
- **Agent**: `create_agent` with `InjectedState` tools, `SummarizationMiddleware`, native `interrupt()`/`Command(resume)` for human-in-the-loop questions
- **Link import**: tiered cascade — yt-dlp metadata → Gemini video understanding → Apify fallback → Places re-rank → `SavedItem`

---

## Why TripWhat

Most travel AI stops at suggestions. TripWhat takes actions. It doesn't just tell you about a place — it watches the reel you sent, files the places away, checks your inbox for the bookings you already made, puts events on your calendar, and books the flight. The loop from inspiration to reservation is the whole product.

## Why this is a strong fit for the Multi-App AI Agent Hackathon

- **Eight external apps, one coherent agent.** Instagram/TikTok/YouTube, Gemini, Google Places, Gmail, Google Calendar, Duffel, OpenAI, Tavily — each one carries real weight in a single user story, not bolted on for a count.
- **Real actions, not read-only demos.** The agent creates calendar events, merges email bookings into trip state, and creates actual Duffel orders with booking references — test mode is real infrastructure, not a mock.
- **Production-grade engineering.** Durable agent state via LangGraph Postgres checkpointing, PKCE-secured OAuth with encrypted token storage and incremental scope merging, Redis-backed resumable streaming, bounded-concurrency enrichment, and checkpoint-synced manual edits.
- **Human-in-the-loop done right.** Questions suspend the graph via `interrupt()` and resume with `Command(resume)` — pending prompts survive reloads and multi-question chains.
- **Evaluation surface.** 149 automated tests, plus every claim in this README was verified live: real reels imported, real OAuth consents completed, a real flight order created.

## What to look at in the code

- `backend-python/app/services/link_import.py` — the tiered link→places cascade
- `backend-python/app/agents/travel_agent.py` — agent orchestration, checkpoint state, interrupt resume
- `backend-python/app/services/duffel_service.py` — flight search → real order creation
- `backend-python/app/services/google_oauth.py` — encrypted tokens, incremental scopes, PKCE state
- `backend-python/app/services/checkpoint_sync.py` — manual edits synced into live agent state

## Team

- _Add team member names + emails here_
