import jwt
import pytest
import socketio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import main
from app.config import settings
from app.models import Conversation, User
from app.services import link_import


def _token(user_id):
    return jwt.encode({"sub": str(user_id)}, settings.jwt_secret, algorithm="HS256")


@pytest.fixture
def sio_calls(monkeypatch):
    calls = {"enter_room": [], "emit": [], "sessions": {}}

    async def enter_room(sid, room):
        calls["enter_room"].append((sid, room))

    async def save_session(sid, data):
        calls["sessions"][sid] = data

    async def get_session(sid):
        return calls["sessions"].get(sid, {})

    async def emit(event, data=None, room=None, **kwargs):
        calls["emit"].append((event, data, room))

    monkeypatch.setattr(main.sio, "enter_room", enter_room)
    monkeypatch.setattr(main.sio, "save_session", save_session)
    monkeypatch.setattr(main.sio, "get_session", get_session)
    monkeypatch.setattr(main.sio, "emit", emit)
    return calls


@pytest.fixture
async def seeded(monkeypatch, test_engine):
    factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(main, "async_session", factory)
    async with factory() as db:
        owner = User(name="A", email="a@x.com", password="x")
        other = User(name="B", email="b@x.com", password="x")
        db.add_all([owner, other])
        await db.flush()
        db.add(Conversation(conversation_id="conv-a", user_id=owner.id, messages=[]))
        await db.commit()
        return owner.id, other.id


@pytest.mark.asyncio
async def test_connect_without_token_refused(sio_calls):
    with pytest.raises(socketio.exceptions.ConnectionRefusedError):
        await main.connect("s1", {}, None)
    with pytest.raises(socketio.exceptions.ConnectionRefusedError):
        await main.connect("s1", {}, {})
    assert sio_calls["enter_room"] == []


@pytest.mark.asyncio
async def test_connect_with_bad_token_refused(sio_calls):
    with pytest.raises(socketio.exceptions.ConnectionRefusedError):
        await main.connect("s1", {}, {"token": "not-a-jwt"})
    assert sio_calls["enter_room"] == []


@pytest.mark.asyncio
async def test_connect_with_valid_token_joins_user_room(sio_calls):
    await main.connect("s1", {}, {"token": _token(7)})
    assert sio_calls["sessions"]["s1"] == {"user_id": 7}
    assert sio_calls["enter_room"] == [("s1", "user:7")]


@pytest.mark.asyncio
async def test_join_foreign_conversation_denied(sio_calls, seeded):
    owner_id, other_id = seeded
    await main.connect("s2", {}, {"token": _token(other_id)})
    sio_calls["enter_room"].clear()
    await main.join_conversation("s2", "conv-a")
    assert sio_calls["enter_room"] == []


@pytest.mark.asyncio
async def test_join_unknown_conversation_denied(sio_calls, seeded):
    owner_id, _ = seeded
    await main.connect("s1", {}, {"token": _token(owner_id)})
    sio_calls["enter_room"].clear()
    await main.join_conversation("s1", "nope")
    assert sio_calls["enter_room"] == []


@pytest.mark.asyncio
async def test_join_own_conversation_allowed(sio_calls, seeded):
    owner_id, _ = seeded
    await main.connect("s1", {}, {"token": _token(owner_id)})
    sio_calls["enter_room"].clear()
    await main.join_conversation("s1", "conv-a")
    assert sio_calls["enter_room"] == [("s1", "conv-a")]


@pytest.mark.asyncio
async def test_saved_imported_emitted_to_user_room(sio_calls, monkeypatch):
    async def fake_extract(url):
        return {"places": [], "platform": "x", "source": "y", "errors": []}

    monkeypatch.setattr(link_import, "extract_places", fake_extract)
    await link_import.run_import("https://example.com/reel", 42)
    assert sio_calls["emit"][0][0] == "saved:imported"
    assert sio_calls["emit"][0][2] == "user:42"
