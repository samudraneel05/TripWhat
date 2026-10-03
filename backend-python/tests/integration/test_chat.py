"""Integration tests for the chat endpoint."""

import pytest
from unittest.mock import AsyncMock, patch


async def _get_auth_token(client) -> str:
    resp = await client.post("/api/auth/register", json={
        "name": "Test User",
        "email": "test@example.com",
        "password": "password123",
    })
    return resp.json()["token"]


@pytest.mark.asyncio
async def test_send_message_no_auth(client):
    resp = await client.post("/api/chat", json={"message": "hello"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_send_message_empty(client):
    token = await _get_auth_token(client)
    resp = await client.post("/api/chat", json={"message": ""}, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400
