"""plan_trip route reconciliation, date normalization, and state writes."""

import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from app.agents.state import normalize_dates
from app.agents.tools import plan_tools
from app.agents.tools.plan_tools import _generate_route


def _llm_response(content):
    resp = MagicMock()
    resp.content = content
    return resp


async def _route(cities, nights, llm_content):
    """Run _generate_route with a fake ChatOpenAI returning llm_content."""
    class FakeModel:
        async def ainvoke(self, msgs):
            return _llm_response(llm_content)

    with patch.object(plan_tools, "ChatOpenAI", return_value=FakeModel()):
        return await _generate_route([{"name": c} for c in cities], nights)


# --- Route reconciliation ---------------------------------------------------

async def test_route_reconciles_undershooting_llm_split():
    """LLM proposes 10 nights for a 14-night trip — splits must fill 14."""
    proposal = await _route(["Rome", "Florence", "Venice"], 13, json.dumps({
        "cities": [
            {"name": "Rome", "nights": 5},
            {"name": "Florence", "nights": 3},
            {"name": "Venice", "nights": 2},
        ],
        "rationale": "test",
    }))
    assert sum(c["nights"] for c in proposal["cities"]) == 13
    assert proposal["totalNights"] == 13


async def test_route_reconciles_overshooting_llm_split():
    proposal = await _route(["Rome", "Florence"], 6, json.dumps({
        "cities": [{"name": "Rome", "nights": 6}, {"name": "Florence", "nights": 6}],
    }))
    assert sum(c["nights"] for c in proposal["cities"]) == 6
    assert all(c["nights"] >= 1 for c in proposal["cities"])


async def test_route_restores_dropped_city():
    proposal = await _route(["Rome", "Venice"], 9, json.dumps({
        "cities": [{"name": "Rome", "nights": 9}],
    }))
    names = [c["name"] for c in proposal["cities"]]
    assert names == ["Rome", "Venice"]
    assert sum(c["nights"] for c in proposal["cities"]) == 9
    assert all(c["nights"] >= 1 for c in proposal["cities"])


async def test_route_parses_content_blocks():
    """OpenAI can return content as [{'type':'text','text':...}] — the old
    code stringified the list and JSON parsing always failed (audit P1-3)."""
    blocks = [{"type": "text", "text": json.dumps({
        "cities": [{"name": "Tokyo", "nights": 3}, {"name": "Kyoto", "nights": 3}],
        "rationale": "geo order",
    })}]
    proposal = await _route(["Tokyo", "Kyoto"], 6, blocks)
    assert [c["name"] for c in proposal["cities"]] == ["Tokyo", "Kyoto"]
    assert [c["nights"] for c in proposal["cities"]] == [3, 3]


async def test_route_fallback_when_llm_returns_garbage():
    proposal = await _route(["Tokyo", "Kyoto"], 6, "not json at all")
    assert sum(c["nights"] for c in proposal["cities"]) == 6
    assert {c["name"] for c in proposal["cities"]} == {"Tokyo", "Kyoto"}


# --- Date normalization ------------------------------------------------------

def test_normalize_dates_late_october():
    today = datetime.today()
    year = today.year if today.month < 10 else today.year + 1
    # On/after Oct 15 the "same month" rule already pushes to next year.
    if today.month == 10 and today.day <= 15:
        year = today.year
    d = normalize_dates("late October", 5)
    assert d["assumed"] is True
    start = datetime.fromisoformat(d["start"])
    # Last week of the month (last Friday or later)
    assert start.month == 10
    assert start.day >= 24


def test_normalize_dates_mid_november():
    d = normalize_dates("mid-November", 4)
    start = datetime.fromisoformat(d["start"])
    assert start.month == 11
    assert 12 <= start.day <= 20


def test_normalize_dates_christmas():
    d = normalize_dates("around christmas", 4)
    start = datetime.fromisoformat(d["start"])
    assert start.month == 12 and 20 <= start.day <= 26


def test_normalize_dates_new_year():
    d = normalize_dates("new year", 5)
    start = datetime.fromisoformat(d["start"])
    assert start.month == 12 and 28 <= start.day <= 31


def test_normalize_dates_this_weekend():
    d = normalize_dates("this weekend", None)
    start = datetime.fromisoformat(d["start"])
    assert start.weekday() == 4  # Friday
    end = datetime.fromisoformat(d["end"])
    assert (end - start).days == 2


def test_normalize_dates_explicit_range_unchanged():
    d = normalize_dates("2027-06-10 to 2027-06-17")
    assert d == {"start": "2027-06-10", "end": "2027-06-17", "assumed": False}


def test_normalize_dates_past_range_is_returned_for_caller_flag():
    d = normalize_dates("2020-01-10 to 2020-01-14")
    assert d["start"] == "2020-01-10"  # caller (plan_trip) flags it as past
