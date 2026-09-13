# TripWhat

**You send it a reel. It books you the trip.**

TripWhat is an AI travel agent that closes the loop everyone else leaves open: inspiration → plan → reservation. Paste an Instagram reel into the app and it *watches the video* — pulls every place mentioned out of the audio, the on-screen text, and the caption, resolves them against Google Places, and files them away. Then you just chat: it builds a day-by-day itinerary with live search, finds the bookings already sitting in your Gmail, drops the trip onto your Google Calendar, and when you say go — it books the flight through Duffel and hands you a confirmation code.

Not a chatbot that suggests. An agent that does.

## Demo video

> Watch the 2-minute demo


https://github.com/user-attachments/assets/baecf303-e5e1-4384-b076-7da93867e4f0





## The flow

1. **Inspiration in.** Paste a social link in the Saved tab — a tiered cascade pulls places out: caption metadata first, then Gemini video understanding reads on-screen text and spoken names, with an Apify fallback when platforms block access.
2. **Plan in chat.** A LangGraph agent asks smart follow-ups through native `interrupt()` cards, fans out web searches in parallel, and builds a day-by-day itinerary with photos, ratings, and routes.
3. **Reality in.** One click connects Gmail — confirmation emails are parsed and merged into the trip. Itinerary items become Google Calendar events.
4. **Booked.** `search_flights` + `book_flight` tools hit the Duffel API: real offer search, real order creation, real booking reference (test mode — real infrastructure, no money moves).

## External apps connected

| App | What the agent does with it |
|---|---|
| **Instagram / TikTok / YouTube** | Ingests shared links; extracts places from video frames, audio, and captions |
| **Google Gemini** | Video understanding — reads on-screen text and spoken place names |
| **Google Places** | Resolves every candidate to a real placeId with rating, photos, coordinates |
| **Gmail** | OAuth connect → finds flight/hotel confirmations → merges into trips |
| **Google Calendar** | Creates itinerary events with times and locations |
| **Duffel** | Live flight offer search → real order creation with booking reference |
| **OpenAI** | Agent reasoning, place extraction, Whisper transcription fallback |
| **Tavily** | Parallel web search during planning |

Plus OpenTripMap, Geoapify, SerpApi, and OpenWeather for places, routes, hotels, and weather — **12+ external services orchestrated by one agent**.

## Observability & evaluation

This is the part most hackathon agents skip — we built it in:

- **LangSmith tracing** — every agent run, tool call, and LLM call is traced end-to-end (`langsmith_tracing` + `langsmith_project`). You can open any conversation and see exactly what the agent did, in what order, and what it cost.
- **80-case eval benchmark** (`backend-python/tests/eval/`) — multi-turn scripted conversations across categories (chitchat, planning, edits, edge cases), scored by LLM-as-judge evaluators, runnable as a CLI: `python -m tests.eval.run_evals --category planning`.
- **LangSmith datasets** — the benchmark uploads as a LangSmith dataset and runs through `langsmith.evaluate()` (`tests/eval/langsmith_eval.py`), so experiments are comparable run-over-run.

## Reliability & testing

```bash
cd backend-python && pytest                      # 130 backend tests
cd frontend && npm test                          # 40 frontend tests
cd frontend && npm run build                     # production build
cd backend-python && python -m tests.eval.run_evals   # 80-case agent benchmark
```

Verified end-to-end, not just unit-tested:

- **OAuth**: Google sign-in completes a real PKCE flow — the `code_verifier` round-trips through a signed JWT state token; Gmail and Calendar grants merge incrementally without clobbering each other.
- **Agent state**: the LangGraph Postgres checkpointer is the source of truth — pending questions survive page reloads, manual itinerary edits and Gmail imports sync back into the checkpoint, concurrent sends return a clean 409.
- **Link import**: verified against real Instagram reels — caption-rich links resolve via metadata alone; caption-sparse videos escalate to Gemini video understanding; results dedupe against existing saved places.
- **Booking**: a real Duffel Airways test order was created and returned a live booking reference (`ord_0000BANcAJzbUvwMotBqG8` / PNR `EMDGNJ`).
- **Streaming**: Redis-buffered token streams replay after refresh/disconnect mid-turn.

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
GOOGLE_CLIENT_ID=...                # sign-in + Gmail + Calendar OAuth
GOOGLE_CLIENT_SECRET=...
GOOGLE_VIDEO_UNDERSTANDING_KEY=...  # Gemini — link import video tier
DUFFEL_ACCESS_TOKEN=duffel_test_... # flight search + booking (free test token)
APIFY_TOKEN=...                     # optional scraper fallback
LANGSMITH_API_KEY=...               # tracing + eval datasets
LANGSMITH_TRACING=true
```

## Architecture

- **Backend**: FastAPI + Socket.IO + LangGraph + PostgreSQL (checkpointed agent state) + Redis (stream buffering)
- **Frontend**: React 18 + Vite + Tailwind + Zustand
- **Agent**: `create_agent` with `InjectedState` tools, `SummarizationMiddleware`, native `interrupt()`/`Command(resume)` human-in-the-loop
- **Link import**: yt-dlp metadata → Gemini video understanding → Apify fallback → Places top-3 re-rank → `SavedItem`

---

## Why TripWhat

The travel-AI category is full of demos that stop at a bulleted list. TripWhat is the only one where the loop actually closes: the reel you scrolled past becomes saved places, the saved places become an itinerary, the itinerary becomes calendar events and a confirmed booking — and your real inbox bookings fold in along the way. Every step is a real API call to a real external system, and every step is observable in LangSmith.

## Why this is a strong fit for the Multi-App AI Agent Hackathon

- **12+ external apps, one coherent story.** Instagram/TikTok/YouTube, Gemini, Places, Gmail, Calendar, Duffel, OpenAI, Tavily, OpenTripMap, Geoapify, SerpApi, OpenWeather — each carries real weight in a single user journey, not bolted on to hit a count.
- **Real actions, not read-only demos.** The agent creates calendar events, merges email bookings into trip state, and creates actual Duffel orders with booking references. Test mode is real infrastructure — the same code path runs live with a production token.
- **Evaluation is a feature, not an afterthought.** 170 automated tests, an 80-case LLM-judged benchmark, LangSmith datasets + `evaluate()` integration, and full trace observability on every agent run — the "show how you know it works" criterion has a concrete answer.


https://github.com/user-attachments/assets/68930966-7072-4364-a773-216e74dc9bf0

<img width="1467" height="811" alt="Screenshot 2026-09-14 at 4 57 34 AM" src="https://github.com/user-attachments/assets/cca82f3e-d02c-42dd-88b8-3f88e7d5c145" />

- **Production-grade engineering.** Durable agent state via Postgres checkpointing, PKCE-secured OAuth with encrypted tokens and incremental scope merging, Redis-backed resumable streaming, bounded-concurrency enrichment, checkpoint-synced manual edits.
- **Human-in-the-loop done right.** Questions suspend the graph via `interrupt()` and resume with `Command(resume)` — pending prompts survive reloads and multi-question chains.
- **Original mechanism.** The reel→places cascade (metadata → video understanding → scraper fallback → Places re-rank) is a genuinely novel pipeline for this category — inspiration ingestion is the unsolved edge of travel planning.

## What to look at in the code

- `backend-python/app/services/link_import.py` — the tiered link→places cascade
- `backend-python/app/agents/travel_agent.py` — agent orchestration, checkpoint state, interrupt resume
- `backend-python/app/services/duffel_service.py` — flight search → real order creation
- `backend-python/app/services/google_oauth.py` — encrypted tokens, incremental scopes, PKCE state
- `backend-python/app/services/checkpoint_sync.py` — manual edits synced into live agent state
- `backend-python/tests/eval/` — benchmark cases, LLM judges, LangSmith integration

## Team

- _Add team member names + emails here_
