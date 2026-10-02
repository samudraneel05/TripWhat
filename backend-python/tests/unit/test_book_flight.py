import pytest

from app.agents.tools import flight_tools
from app.config import settings
from app.services import duffel_service

OFFER = {
    "id": "off_1",
    "total_amount": "123.45",
    "total_currency": "USD",
    "owner": {"name": "Duffel Airways"},
    "slices": [{
        "origin": {"iata_code": "LHR"},
        "destination": {"iata_code": "JFK"},
        "segments": [{"departing_at": "2026-12-01T10:00:00"}],
    }],
}
ARGS = {
    "offer_id": "off_1",
    "passenger_given_name": "Ada",
    "passenger_family_name": "Lovelace",
    "passenger_born_on": "1990-01-01",
    "passenger_email": "ada@example.com",
}
ORDER = {
    "bookingReference": "ABC123", "liveMode": False, "currency": "USD",
    "total": "123.45", "passenger": "Ada Lovelace", "route": ["LHR-JFK"],
}


@pytest.fixture
def duffel(monkeypatch):
    calls = {"create_order": 0}

    async def get_offer(offer_id):
        return OFFER

    async def create_order(*args, **kwargs):
        calls["create_order"] += 1
        return ORDER

    monkeypatch.setattr(duffel_service, "get_offer", get_offer)
    monkeypatch.setattr(duffel_service, "create_order", create_order)
    monkeypatch.setattr(settings, "duffel_access_token", "duffel_test_abc")
    return calls


def _fake_interrupt(monkeypatch, duffel_calls, answer):
    seen = []

    def fake(payload):
        seen.append(payload)
        assert duffel_calls["create_order"] == 0, "order created before confirmation"
        return answer

    monkeypatch.setattr(flight_tools, "interrupt", fake)
    return seen


@pytest.mark.asyncio
async def test_confirm_creates_order_after_interrupt(monkeypatch, duffel):
    seen = _fake_interrupt(monkeypatch, duffel, "confirm_booking")
    result = await flight_tools.book_flight.ainvoke(ARGS)
    assert duffel["create_order"] == 1
    assert "ABC123" in result
    payload = seen[0]
    assert payload["question"] == (
        "Confirm booking: Duffel Airways LHR->JFK on 2026-12-01 for USD 123.45 (Ada Lovelace)?"
    )
    assert [o["value"] for o in payload["options"]] == ["confirm_booking", "cancel_booking"]
    assert payload["allowCustom"] is False


@pytest.mark.asyncio
async def test_cancel_does_not_create_order(monkeypatch, duffel):
    _fake_interrupt(monkeypatch, duffel, "cancel_booking")
    result = await flight_tools.book_flight.ainvoke(ARGS)
    assert duffel["create_order"] == 0
    assert result == "Booking cancelled by user."


@pytest.mark.asyncio
async def test_free_text_answer_is_not_confirmation(monkeypatch, duffel):
    _fake_interrupt(monkeypatch, duffel, "yes sure")
    await flight_tools.book_flight.ainvoke(ARGS)
    assert duffel["create_order"] == 0


@pytest.mark.asyncio
async def test_live_token_refused_when_flag_off(monkeypatch, duffel):
    monkeypatch.setattr(settings, "duffel_access_token", "duffel_live_abc")
    monkeypatch.setattr(settings, "allow_live_bookings", False)

    def boom(payload):
        raise AssertionError("interrupt should not be reached")

    monkeypatch.setattr(flight_tools, "interrupt", boom)
    result = await flight_tools.book_flight.ainvoke(ARGS)
    assert "disabled" in result
    assert duffel["create_order"] == 0
