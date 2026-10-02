"""Integration tests for places routes."""

import pytest


@pytest.mark.asyncio
async def test_places_search_empty_query(client, auth_headers):
    resp = await client.get("/api/places/search", params={"query": ""}, headers=auth_headers)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_autocomplete_short_query(client, auth_headers):
    resp = await client.get("/api/places/autocomplete", params={"query": "a"}, headers=auth_headers)
    # Should return empty results (too short) or 400
    assert resp.status_code in (200, 400)


@pytest.mark.asyncio
@pytest.mark.parametrize("path,params", [
    ("/api/places/search", {"query": "cafe"}),
    ("/api/places/autocomplete", {"query": "cafe"}),
    ("/api/places/details", {"placeId": "abc"}),
])
async def test_places_routes_require_auth(client, path, params):
    resp = await client.get(path, params=params)
    assert resp.status_code == 401
