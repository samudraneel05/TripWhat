"""Pytest configuration and fixtures."""

import asyncio
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.models import *  # noqa: F401,F403
from app.services import rate_limit, run_registry


@pytest.fixture(autouse=True)
def _in_memory_rate_limit(monkeypatch):
    async def no_redis():
        raise ConnectionError("redis disabled in tests")

    monkeypatch.setattr(rate_limit, "_redis", no_redis)
    rate_limit._memory.clear()
    yield
    rate_limit._memory.clear()


@pytest.fixture(autouse=True)
def _in_memory_run_registry(monkeypatch):
    async def no_redis():
        raise ConnectionError("redis disabled in tests")

    monkeypatch.setattr(run_registry, "_redis", no_redis)
    run_registry._mem_conv.clear()
    run_registry._mem_user.clear()
    yield
    run_registry._mem_conv.clear()
    run_registry._mem_user.clear()


@pytest_asyncio.fixture
async def test_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def test_db(test_engine):
    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(test_engine):
    from app.main import fastapi_app as app

    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    # Override the dependency
    from app.database import get_db
    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def auth_headers(client):
    resp = await client.post("/api/auth/register", json={
        "name": "Auth User",
        "email": "authuser@example.com",
        "password": "password123",
    })
    return {"Authorization": f"Bearer {resp.json()['token']}"}
