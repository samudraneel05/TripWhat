import socket

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.routes import image_proxy

REAL_CLIENT = httpx.AsyncClient


@pytest.fixture
def proxy(monkeypatch, test_engine):
    factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(image_proxy, "async_session", factory)
    monkeypatch.setattr(image_proxy, "_last_cleanup", None)
    resolved = {"ip": "142.250.80.46"}

    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(2, 1, 6, "", (resolved["ip"], port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

    def install(handler):
        def factory(*args, **kwargs):
            return REAL_CLIENT(*args, transport=httpx.MockTransport(handler), **kwargs)

        monkeypatch.setattr(image_proxy.httpx, "AsyncClient", factory)

    return resolved, install


def _ok(request):
    return httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})


@pytest.mark.asyncio
async def test_internal_url_rejected(client, proxy):
    r = await client.get("/api/image", params={"url": "http://127.0.0.1:5000/health"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_non_allowlisted_host_rejected(client, proxy):
    r = await client.get("/api/image", params={"url": "https://example.com/"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_lookalike_suffix_rejected(client, proxy):
    r = await client.get("/api/image", params={"url": "https://evilgooglecontent.com/a.png"})
    assert r.status_code == 400
    r = await client.get("/api/image", params={"url": "http://lh3.googleusercontent.com/a.png"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_allowlisted_host_resolving_private_rejected(client, proxy):
    resolved, install = proxy
    install(_ok)
    resolved["ip"] = "10.0.0.1"
    r = await client.get("/api/image", params={"url": "https://lh3.googleusercontent.com/a.png"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_non_image_content_type_returns_415(client, proxy):
    _, install = proxy
    install(lambda req: httpx.Response(200, text="<html>", headers={"content-type": "text/html"}))
    r = await client.get("/api/image", params={"url": "https://lh3.googleusercontent.com/a.png"})
    assert r.status_code == 415


@pytest.mark.asyncio
async def test_redirect_to_disallowed_host_rejected(client, proxy):
    _, install = proxy

    def handler(req):
        return httpx.Response(302, headers={"location": "https://example.com/x.png"})

    install(handler)
    r = await client.get("/api/image", params={"url": "https://lh3.googleusercontent.com/a.png"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_allowlisted_image_served_with_nosniff(client, proxy):
    _, install = proxy
    install(_ok)
    r = await client.get("/api/image", params={"url": "https://lh3.googleusercontent.com/a.png"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"] == "default-src 'none'"
    assert r.content == b"\x89PNG"
