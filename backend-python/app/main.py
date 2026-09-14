"""FastAPI application entry point with Socket.IO."""

from dotenv import load_dotenv
load_dotenv()

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.config import settings
from app.database import init_db
from app.utils.logger import logger

# --- Socket.IO server (async mode, ASGI) ---
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[settings.frontend_url],
)


@sio.event
async def connect(sid, environ):
    logger.info(f"Client connected: {sid}")


@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")


@sio.on("join:conversation")
async def join_conversation(sid, conversation_id):
    await sio.enter_room(sid, conversation_id)
    logger.info(f"Socket {sid} joined conversation: {conversation_id}")


@sio.on("leave:conversation")
async def leave_conversation(sid, conversation_id):
    await sio.leave_room(sid, conversation_id)
    logger.info(f"Socket {sid} left conversation: {conversation_id}")


# --- FastAPI app ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("Database initialized")

    # Wire LangGraph persistence: Postgres checkpointer + cross-conversation store
    conn_str = settings.database_url.replace("+asyncpg", "")
    yielded = False
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        from langgraph.store.postgres.aio import AsyncPostgresStore
        from app.agents.travel_agent import travel_agent
        from app.services.memory import set_store
        from app.services.stream_buffer import stream_buffer
        from app.services.mcp_client import maps_mcp

        async with AsyncPostgresSaver.from_conn_string(conn_str) as checkpointer, \
                   AsyncPostgresStore.from_conn_string(conn_str) as store:
            await checkpointer.setup()
            await store.setup()
            travel_agent.set_persistence(checkpointer, store)
            set_store(store)
            logger.info("LangGraph Postgres checkpointer + store initialized")

            # In-process agent tasks die with the process — clear any
            # active:* flags left behind so those conversations aren't
            # locked out by the 409 concurrency guard on the next send.
            cleared = await stream_buffer.clear_all_active()
            if cleared:
                logger.info(f"Cleared {cleared} stale active-stream flags")
            yielded = True
            yield
    except Exception:
        logger.exception("LangGraph Postgres persistence unavailable — falling back to in-memory")
        if not yielded:
            yield
    finally:
        # Close external connections on shutdown
        try:
            await stream_buffer.close()
        except Exception:
            logger.warning("stream_buffer close failed on shutdown")
        try:
            await maps_mcp.close()
        except Exception:
            logger.warning("maps_mcp close failed on shutdown")


app = FastAPI(title="TripWhat API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes
from app.routes.auth import router as auth_router
from app.routes.chat import router as chat_router
from app.routes.trips import router as trips_router
from app.routes.travel import router as travel_router
from app.routes.flights import router as flights_router
from app.routes.hotels import router as hotels_router
from app.routes.places import router as places_router
from app.routes.calendar import router as calendar_router
from app.routes.gmail import router as gmail_router
from app.routes.saved import router as saved_router
from app.routes.itinerary_edit import router as itinerary_edit_router
from app.routes.image_proxy import router as image_proxy_router

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])
app.include_router(trips_router, prefix="/api/saved-trips", tags=["trips"])
app.include_router(travel_router, prefix="/api/travel", tags=["travel"])
app.include_router(flights_router, prefix="/api/flights", tags=["flights"])
app.include_router(hotels_router, prefix="/api/hotels", tags=["hotels"])
app.include_router(places_router, prefix="/api/places", tags=["places"])
app.include_router(calendar_router, prefix="/api/google", tags=["calendar"])
app.include_router(gmail_router, prefix="/api/google", tags=["gmail"])
app.include_router(saved_router, tags=["saved"])
app.include_router(itinerary_edit_router, tags=["itinerary-edit"])
app.include_router(image_proxy_router, tags=["image-proxy"])


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api")
async def api_root():
    return {"message": "TripWhat API is running"}


# Keep a reference to the FastAPI app for tests and dependency overrides
fastapi_app = app

# Combine FastAPI + Socket.IO into one ASGI app
asgi_app = socketio.ASGIApp(sio, app)
