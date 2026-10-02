"""Itinerary editor — structured results, positional ops, day swaps."""

from app.services.itinerary_editor import ItineraryEditor, _period_for
from app.schemas.itinerary import create_itinerary, create_time_slot, Activity


def _itinerary_with_days(days=4):
    itin = create_itinerary("Lisbon", days, "2027-03-05")
    for i, d in enumerate(itin.days):
        slots = []
        for period in ("morning", "afternoon", "evening"):
            act = Activity(
                id=f"act-d{i + 1}-{period}",
                title=f"{period.title()} activity D{i + 1}",
                name=f"{period.title()} activity D{i + 1}",
                type="attraction",
            )
            slots.append(create_time_slot(period, act))
        d.timeSlots = slots
    return itin.model_dump()


def test_swap_days_swaps_schedules_and_dates():
    editor = ItineraryEditor()
    itin = _itinerary_with_days()
    day2_slots = [s["activity"]["title"] for s in itin["days"][1]["timeSlots"]]
    day3_slots = [s["activity"]["title"] for s in itin["days"][2]["timeSlots"]]

    result = editor.swap_days(itin, 2, 3)
    assert result["ok"] is True
    assert result["itinerary"]["days"][1]["dayNumber"] == 2
    after2 = [s["activity"]["title"] for s in result["itinerary"]["days"][1]["timeSlots"]]
    after3 = [s["activity"]["title"] for s in result["itinerary"]["days"][2]["timeSlots"]]
    assert after2 == day3_slots
    assert after3 == day2_slots


def test_swap_days_rejects_bad_day():
    editor = ItineraryEditor()
    itin = _itinerary_with_days()
    result = editor.swap_days(itin, 2, 99)
    assert result["ok"] is False
    # Itinerary untouched
    assert result["itinerary"]["days"][1]["timeSlots"][0]["activity"]["title"] == "Morning activity D2"


def test_remove_activity_by_index():
    editor = ItineraryEditor()
    itin = _itinerary_with_days()
    result = editor.remove_activity(itin, {
        "target": {"day": 1, "activityIndex": 2},
    })
    assert result["ok"] is True
    remaining = [s["activity"]["title"] for s in result["itinerary"]["days"][0]["timeSlots"]]
    assert "Afternoon activity D1" not in remaining
    assert len(remaining) == 2


def test_remove_activity_index_out_of_range_fails():
    editor = ItineraryEditor()
    itin = _itinerary_with_days()
    result = editor.remove_activity(itin, {
        "target": {"day": 1, "activityIndex": 9},
    })
    assert result["ok"] is False
    assert len(result["itinerary"]["days"][0]["timeSlots"]) == 3


def test_remove_activity_fuzzy_name():
    editor = ItineraryEditor()
    itin = _itinerary_with_days()
    result = editor.remove_activity(itin, {
        "target": {"day": 2, "activityName": "evening activity"},
    })
    assert result["ok"] is True
    remaining = [s["activity"]["title"] for s in result["itinerary"]["days"][1]["timeSlots"]]
    assert not any("Evening" in t for t in remaining)


def test_remove_activity_reports_failure():
    editor = ItineraryEditor()
    itin = _itinerary_with_days()
    result = editor.remove_activity(itin, {
        "target": {"day": 2, "activityName": "nonexistent place"},
    })
    assert result["ok"] is False
    assert "not found" in result["message"].lower()
    assert len(result["itinerary"]["days"][1]["timeSlots"]) == 3


def test_move_activity_keeps_slot_order():
    editor = ItineraryEditor()
    itin = _itinerary_with_days()
    result = editor.move_activity(itin, {
        "target": {"day": 1, "activityName": "morning activity d1"},
        "details": {"newDay": 2, "newTimeSlot": "evening"},
    })
    assert result["ok"] is True
    day2 = result["itinerary"]["days"][1]
    periods = [s["period"] for s in day2["timeSlots"]]
    assert periods == sorted(periods, key=["morning", "afternoon", "evening"].index)
    assert day2["timeSlots"][-1]["activity"]["title"] == "Morning activity D1"
    remaining_d1 = [s["activity"]["title"] for s in result["itinerary"]["days"][0]["timeSlots"]]
    assert "Morning activity D1" not in remaining_d1


def test_move_activity_bad_target_day_fails_without_mutation():
    editor = ItineraryEditor()
    itin = _itinerary_with_days()
    result = editor.move_activity(itin, {
        "target": {"day": 1, "activityName": "morning activity d1"},
        "details": {"newDay": 99},
    })
    assert result["ok"] is False
    # Not silently dropped — the activity must still be on day 1
    titles = [s["activity"]["title"] for s in result["itinerary"]["days"][0]["timeSlots"]]
    assert "Morning activity D1" in titles


def test_remove_day_out_of_range_fails():
    editor = ItineraryEditor()
    itin = _itinerary_with_days()
    result = editor.remove_day(itin, 99)
    assert result["ok"] is False
    assert len(result["itinerary"]["days"]) == 4


def test_period_for_time_hints():
    assert _period_for("morning") == "morning"
    assert _period_for("evening") == "evening"
    assert _period_for("11am") == "morning"
    assert _period_for("2pm") == "afternoon"
    assert _period_for("8pm") == "evening"
    assert _period_for("after lunch") == "afternoon"
    assert _period_for(None) == "morning"
