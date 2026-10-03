"""Integration tests for trips routes."""

from datetime import datetime, timedelta, timezone

import pytest


def _future_z_date(days_ahead: int = 30) -> str:
    """ISO 8601 date with Z suffix (JS toISOString style), always in the future."""
    dt = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    return dt.isoformat().replace("+00:00", "Z")


async def _get_auth_token(client) -> str:
    resp = await client.post("/api/auth/register", json={
        "name": "Test User",
        "email": "test@example.com",
        "password": "password123",
    })
    return resp.json()["token"]


@pytest.mark.asyncio
async def test_create_trip(client):
    token = await _get_auth_token(client)
    resp = await client.post("/api/saved-trips", json={
        "title": "Japan Trip",
        "cities": [{"name": "Tokyo", "days": 5}],
        "totalDays": 5,
        "people": 1,
        "travelType": "cultural",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["savedTrip"]["title"] == "Japan Trip"


@pytest.mark.asyncio
async def test_list_trips(client):
    token = await _get_auth_token(client)
    # Create a trip first
    await client.post("/api/saved-trips", json={
        "title": "Japan Trip",
        "totalDays": 5,
    }, headers={"Authorization": f"Bearer {token}"})
    # List
    resp = await client.get("/api/saved-trips", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["savedTrips"]) >= 1


@pytest.mark.asyncio
async def test_get_trip(client):
    token = await _get_auth_token(client)
    create = await client.post("/api/saved-trips", json={
        "title": "Japan Trip",
        "totalDays": 5,
    }, headers={"Authorization": f"Bearer {token}"})
    trip_id = create.json()["savedTrip"]["id"]
    resp = await client.get(f"/api/saved-trips/{trip_id}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Japan Trip"


@pytest.mark.asyncio
async def test_delete_trip(client):
    token = await _get_auth_token(client)
    create = await client.post("/api/saved-trips", json={
        "title": "Japan Trip",
        "totalDays": 5,
    }, headers={"Authorization": f"Bearer {token}"})
    trip_id = create.json()["savedTrip"]["id"]
    resp = await client.delete(f"/api/saved-trips/{trip_id}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_statistics(client):
    token = await _get_auth_token(client)
    resp = await client.get("/api/saved-trips/statistics", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert "statistics" in resp.json()


@pytest.mark.asyncio
async def test_create_trip_with_trip_state_cities(client):
    """Test creating a trip with tripState cities that have nights/order shape.
    This reproduces the 422 error — backend CityDestination expects {name, days: int},
    but frontend sends {name, nights, order}. The frontend now maps nights→days."""
    token = await _get_auth_token(client)
    trip_state = {
        "cities": [
            {"name": "Tokyo", "nights": 3, "order": 0},
            {"name": "Kyoto", "nights": 2, "order": 1},
        ],
        "duration": 6,
        "dates": {"flexible": True},
        "onboarding": {"slotsFilled": ["destination", "dates", "duration", "travelers", "trip_style", "help_with"], "completed": True},
    }
    resp = await client.post("/api/saved-trips", json={
        "title": "Japan Trip",
        "cities": [
            {"name": "Tokyo", "days": 4},
            {"name": "Kyoto", "days": 3},
        ],
        "totalDays": 7,
        "people": 1,
        "travelType": "cultural",
        "tripState": trip_state,
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["savedTrip"]["title"] == "Japan Trip"
    assert data["savedTrip"]["tripState"] == trip_state


@pytest.mark.asyncio
async def test_create_trip_with_trip_state_dates_sets_upcoming(client):
    """Test that creating a trip with future dates in tripState auto-sets is_upcoming."""
    token = await _get_auth_token(client)
    from datetime import datetime, timedelta
    future_date = (datetime.utcnow() + timedelta(days=30)).isoformat()
    resp = await client.post("/api/saved-trips", json={
        "title": "Future Trip",
        "cities": [{"name": "Paris", "days": 5}],
        "totalDays": 5,
        "people": 1,
        "travelType": "cultural",
        "tripState": {
            "dates": {"start": future_date},
            "cities": [{"name": "Paris", "nights": 4, "order": 0}],
            "duration": 5,
        },
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["savedTrip"]["isUpcoming"] is True
    assert data["savedTrip"]["tripStartDate"] is not None


@pytest.mark.asyncio
async def test_create_trip_with_invalid_cities_shape_returns_422(client):
    """Test that sending cities with wrong shape (missing days field) returns 422."""
    token = await _get_auth_token(client)
    resp = await client.post("/api/saved-trips", json={
        "title": "Bad Trip",
        "cities": [{"name": "Tokyo", "nights": 3}],
        "totalDays": 5,
        "people": 1,
        "travelType": "cultural",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_trip_with_z_suffix_date(client):
    """Test that ISO 8601 dates with Z suffix (from JS toISOString) don't cause 500.
    Python 3.10's datetime.fromisoformat doesn't support Z — the _parse_iso helper handles it."""
    token = await _get_auth_token(client)
    resp = await client.post("/api/saved-trips", json={
        "title": "Paris Trip",
        "cities": [{"name": "Paris", "days": 5}],
        "totalDays": 5,
        "people": 1,
        "travelType": "cultural",
        "startDate": "2026-08-18T06:17:36.248Z",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["savedTrip"]["title"] == "Paris Trip"


@pytest.mark.asyncio
async def test_create_trip_with_trip_state_z_suffix_date(client):
    """Test that tripState dates with Z suffix don't cause 500."""
    token = await _get_auth_token(client)
    resp = await client.post("/api/saved-trips", json={
        "title": "Paris Trip",
        "cities": [{"name": "Paris", "days": 5}],
        "totalDays": 5,
        "people": 1,
        "travelType": "cultural",
        "tripState": {
            "dates": {"start": _future_z_date()},
            "cities": [{"name": "Paris", "nights": 4, "order": 0}],
            "duration": 5,
        },
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["savedTrip"]["isUpcoming"] is True
