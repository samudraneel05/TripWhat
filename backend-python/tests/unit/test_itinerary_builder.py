"""Tests for the itinerary builder."""

import pytest
from app.services.itinerary_builder import itinerary_builder


@pytest.mark.asyncio
async def test_build_single_city():
    result = await itinerary_builder.build({
        "destination": "Tokyo",
        "duration": 5,
    })
    assert result is not None
    itinerary = result["itinerary"]
    assert len(itinerary["days"]) == 5
    assert itinerary["tripMetadata"]["destination"] == "Tokyo"


@pytest.mark.asyncio
async def test_build_multi_city():
    result = await itinerary_builder.build({
        "destination": "Tokyo",
        "duration": 7,
        "cities": [
            {"name": "Tokyo", "days": 4},
            {"name": "Kyoto", "days": 3},
        ],
        "totalDays": 7,
    })
    assert result is not None
    itinerary = result["itinerary"]
    assert len(itinerary["days"]) == 7
    # First 4 days should be Tokyo
    assert itinerary["days"][0]["location"] == "Tokyo"
    assert itinerary["days"][4]["location"] == "Kyoto"


@pytest.mark.asyncio
async def test_build_with_start_date():
    result = await itinerary_builder.build({
        "destination": "Paris",
        "duration": 3,
        "startDate": "2024-10-01",
    })
    itinerary = result["itinerary"]
    assert itinerary["days"][0]["date"] == "2024-10-01"
    assert itinerary["days"][1]["date"] == "2024-10-02"


@pytest.mark.asyncio
async def test_curate_activities_llm_includes_used_names_in_prompt():
    """Verify that used_names appears in the LLM prompt when provided."""
    places = [
        {"name": "Senso-ji Temple", "rating": 4.5, "types": ["temple"], "description": "Historic temple"},
        {"name": "Shibuya Crossing", "rating": 4.3, "types": ["landmark"], "description": "Busy crossing"},
        {"name": "Tokyo Tower", "rating": 4.2, "types": ["landmark"], "description": "Iconic tower"},
        {"name": "Meiji Shrine", "rating": 4.6, "types": ["shrine"], "description": "Peaceful shrine"},
    ]

    captured_prompt = []

    class MockModel:
        async def ainvoke(self, messages):
            captured_prompt.append(messages[1]["content"])
            class MockResponse:
                content = '[{"period":"morning","name":"Senso-ji Temple","type":"temple","description":"test","duration":"2h"},{"period":"afternoon","name":"Shibuya Crossing","type":"landmark","description":"test","duration":"1h"},{"period":"evening","name":"Tokyo Tower","type":"landmark","description":"test","duration":"1h"}]'
            return MockResponse()

    original_model = itinerary_builder._model
    itinerary_builder._model = MockModel()
    try:
        await itinerary_builder._curate_activities_llm(
            places, "Tokyo", 2, 5, "culture", ["Tokyo"],
            used_names=["Meiji Shrine", "Ueno Park"],
        )
    finally:
        itinerary_builder._model = original_model

    assert len(captured_prompt) == 1
    assert "Meiji Shrine" in captured_prompt[0]
    assert "Ueno Park" in captured_prompt[0]
    assert "DO NOT pick these again" in captured_prompt[0]


@pytest.mark.asyncio
async def test_curate_activities_llm_no_used_names_no_clause():
    """Verify that no used_clause appears when used_names is None or empty."""
    places = [
        {"name": "Senso-ji Temple", "rating": 4.5, "types": ["temple"], "description": "Historic temple"},
        {"name": "Shibuya Crossing", "rating": 4.3, "types": ["landmark"], "description": "Busy crossing"},
        {"name": "Tokyo Tower", "rating": 4.2, "types": ["landmark"], "description": "Iconic tower"},
    ]

    captured_prompt = []

    class MockModel:
        async def ainvoke(self, messages):
            captured_prompt.append(messages[1]["content"])
            class MockResponse:
                content = '[{"period":"morning","name":"Senso-ji Temple","type":"temple","description":"test","duration":"2h"},{"period":"afternoon","name":"Shibuya Crossing","type":"landmark","description":"test","duration":"1h"},{"period":"evening","name":"Tokyo Tower","type":"landmark","description":"test","duration":"1h"}]'
            return MockResponse()

    original_model = itinerary_builder._model
    itinerary_builder._model = MockModel()
    try:
        await itinerary_builder._curate_activities_llm(
            places, "Tokyo", 1, 3, "culture", ["Tokyo"],
            used_names=None,
        )
    finally:
        itinerary_builder._model = original_model

    assert "DO NOT pick these again" not in captured_prompt[0]


@pytest.mark.asyncio
async def test_build_single_city_parallel_curation():
    """Days are curated concurrently — no day sees another's picks at call time.

    Cross-day dedup is reconciled post-hoc via _reconcile_used_names.
    """
    call_args = []

    original = itinerary_builder._search_and_curate_activities

    async def mock_search(city, day_num, total_days, trip_style, help_with, all_city_names, used_names=None, **kwargs):
        call_args.append({
            "day": day_num,
            "used_names": list(used_names) if used_names else [],
        })
        return [
            {"period": "morning", "name": f"Place D{day_num}A", "type": "attraction", "description": "test", "duration": "2h"},
            {"period": "afternoon", "name": f"Place D{day_num}B", "type": "attraction", "description": "test", "duration": "2h"},
            {"period": "evening", "name": f"Place D{day_num}C", "type": "attraction", "description": "test", "duration": "1h"},
        ]

    itinerary_builder._search_and_curate_activities = mock_search
    try:
        result = await itinerary_builder.build({"destination": "Tokyo", "duration": 3})
    finally:
        itinerary_builder._search_and_curate_activities = original

    assert len(call_args) == 3
    # Parallel curation: every day starts with an empty used_names
    assert all(c["used_names"] == [] for c in call_args)
    # All days were still curated (order of completion may vary)
    assert sorted(c["day"] for c in call_args) == [1, 2, 3]
    # All curated activities land in the itinerary
    names = [
        slot["activity"]["name"]
        for day in result["itinerary"]["days"]
        for slot in day["timeSlots"]
    ]
    assert len(names) == 9


def test_reconcile_used_names_swaps_duplicates():
    """Post-hoc dedup: a duplicated pick is swapped for an unused cluster place."""
    used: set[str] = set()
    day1 = [{"name": "Temple A", "period": "morning"}, {"name": "Park B", "period": "afternoon"}]
    day1 = itinerary_builder._reconcile_used_names(day1, [], used)
    assert [a["name"] for a in day1] == ["Temple A", "Park B"]
    assert used == {"temple a", "park b"}

    cluster2 = [
        {"name": "Temple A", "rating": 4.9},   # already used by day 1
        {"name": "Museum C", "rating": 4.8},   # unused, high-rated candidate
        {"name": "Gallery D", "rating": 4.1},  # unused, lower-rated candidate
    ]
    day2 = [{"name": "Temple A", "period": "morning"}, {"name": "River E", "period": "evening"}]
    day2 = itinerary_builder._reconcile_used_names(day2, cluster2, used)
    # "Temple A" was a duplicate → swapped for the best unused cluster place
    assert [a["name"] for a in day2] == ["Museum C", "River E"]
    # Swap preserves the original period
    assert day2[0]["period"] == "morning"


def test_reconcile_used_names_keeps_dup_when_no_replacement():
    """If the day's cluster has no unused places, the duplicate pick is kept."""
    used = {"temple a"}
    day = [{"name": "Temple A", "period": "morning"}]
    result = itinerary_builder._reconcile_used_names(day, [{"name": "Temple A"}], used)
    assert result[0]["name"] == "Temple A"


@pytest.mark.asyncio
async def test_build_multi_city_parallel_curation_per_city():
    """All days across all cities curate in parallel with empty used_names."""
    call_args = []

    original = itinerary_builder._search_and_curate_activities

    async def mock_search(city, day_num, total_days, trip_style, help_with, all_city_names, used_names=None, **kwargs):
        call_args.append({
            "city": city,
            "day": day_num,
            "used_names": list(used_names) if used_names else [],
        })
        return [
            {"period": "morning", "name": f"{city} D{day_num}A", "type": "attraction", "description": "test", "duration": "2h"},
            {"period": "afternoon", "name": f"{city} D{day_num}B", "type": "attraction", "description": "test", "duration": "2h"},
            {"period": "evening", "name": f"{city} D{day_num}C", "type": "attraction", "description": "test", "duration": "1h"},
        ]

    itinerary_builder._search_and_curate_activities = mock_search
    try:
        result = await itinerary_builder.build({
            "destination": "Tokyo",
            "duration": 4,
            "cities": [
                {"name": "Tokyo", "days": 2},
                {"name": "Kyoto", "days": 2},
            ],
            "totalDays": 4,
        })
    finally:
        itinerary_builder._search_and_curate_activities = original

    assert len(call_args) == 4
    # Parallel curation: every day starts with an empty used_names
    assert all(c["used_names"] == [] for c in call_args)
    # 2 days per city, globally numbered
    tokyo_days = sorted(c["day"] for c in call_args if c["city"] == "Tokyo")
    kyoto_days = sorted(c["day"] for c in call_args if c["city"] == "Kyoto")
    assert tokyo_days == [1, 2]
    assert kyoto_days == [3, 4]
    # Day locations still assigned correctly
    days = result["itinerary"]["days"]
    assert days[0]["location"] == "Tokyo"
    assert days[2]["location"] == "Kyoto"
    assert "Tokyo D1A" not in call_args[3]["used_names"]
