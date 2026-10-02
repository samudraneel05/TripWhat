"""Itinerary editor — add/remove/replace/move activities, add/remove days.

Uses places_search service to look up real place data (coordinates, rating,
description) before adding activities to the itinerary.
"""

import re
import uuid
from app.schemas.itinerary import Activity, ActivityLocation, create_time_slot, create_day_plan
from app.services.places_search import places_search
from app.utils.logger import logger

# Canonical slot ordering used to keep days coherent after edits
_PERIOD_ORDER = ["morning", "afternoon", "evening"]


def _sort_day_slots(day: dict) -> None:
    day["timeSlots"] = sorted(
        day.get("timeSlots", []),
        key=lambda s: _PERIOD_ORDER.index(s.get("period"))
        if s.get("period") in _PERIOD_ORDER else len(_PERIOD_ORDER),
    )


def _period_for(hint: str | None) -> str:
    """Map a free-text time hint ("11am", "evening", "after lunch") to a slot period."""
    if not hint:
        return "morning"
    h = str(hint).lower().strip()
    if h in _PERIOD_ORDER:
        return h
    if any(w in h for w in ("dinner", "sunset", "night", "evening")):
        return "evening"
    if any(w in h for w in ("afternoon", "noon", "midday", "lunch", "siesta")):
        return "afternoon"
    if any(w in h for w in ("morning", "brunch", "breakfast", "sunrise", "early")):
        return "morning"
    m = re.search(r"(\d{1,2})(?::\d{2})?\s*(am|pm)?", h)
    if m:
        hour = int(m.group(1))
        if m.group(2) == "pm" and hour != 12:
            hour += 12
        elif m.group(2) == "am" and hour == 12:
            hour = 0
        if hour < 12:
            return "morning"
        if hour < 17:
            return "afternoon"
        return "evening"
    return "morning"


class ItineraryEditor:

    async def add_activity(self, itinerary: dict, action: dict, destination: str) -> dict:
        target_day = action.get("target", {}).get("day")
        details = action.get("details", {})
        target_slot = _period_for(
            details.get("timeOfDay") or action.get("target", {}).get("timeSlot")
        )
        place_name = details.get("placeName") or action.get("target", {}).get("activityName", "New Activity")


        # Search for real place data
        place_data = None
        try:
            place_data = await places_search.search_by_name(place_name, destination)
        except Exception as e:
            logger.warning(f"[ITINERARY_EDITOR] Place search failed for '{place_name}': {e}")

        if place_data:
            coords = place_data.get("coordinates", {})
            activity = Activity(
                id=str(uuid.uuid4()),
                title=place_data.get("name", place_name),
                name=place_data.get("name", place_name),
                type=", ".join(place_data.get("types", [])[:2]) if place_data.get("types") else "attraction",
                description=place_data.get("description", ""),
                rating=place_data.get("rating"),
                placeId=place_data.get("placeId"),
                address=place_data.get("address", ""),
                coordinates=coords,
                location=ActivityLocation(
                    name=place_data.get("name", place_name),
                    address=place_data.get("address", ""),
                    coordinates=coords,
                ),
                websiteUrl=place_data.get("website"),
                phoneNumber=place_data.get("phone"),
                metadata={"addedBy": "ai", "source": "user_request"},
            )
            display_name = place_data.get("name", place_name)
        else:
            activity = Activity(
                id=str(uuid.uuid4()),
                title=place_name,
                name=place_name,
                type="attraction",
                metadata={"addedBy": "ai", "source": "user_request"},
            )
            display_name = place_name

        days = itinerary.get("days", [])
        if not target_day or not (1 <= target_day <= len(days)):
            return {
                "itinerary": itinerary,
                "ok": False,
                "message": f"Day {target_day} not found — itinerary has {len(days)} days",
                "changeSummary": {"action": "add", "target": display_name, "failed": True},
            }
        day = days[target_day - 1]
        slots = day.get("timeSlots", [])
        slot = next((s for s in slots if s.get("period") == target_slot), None)
        if slot:
            slot.setdefault("activities", [])
            slot["activities"].append(activity.model_dump())
            if not slot.get("activity"):
                slot["activity"] = activity.model_dump()
        else:
            new_slot = create_time_slot(target_slot, activity).model_dump()
            day["timeSlots"].append(new_slot)
            _sort_day_slots(day)

        return {
            "itinerary": itinerary,
            "ok": True,
            "message": f"Added {display_name} to Day {target_day}",
            "changeSummary": {"action": "add", "target": display_name, "added": [display_name]},
        }

    def remove_activity(self, itinerary: dict, action: dict) -> dict:
        target_day = action.get("target", {}).get("day")
        activity_id = action.get("target", {}).get("activityId")
        activity_name = action.get("target", {}).get("activityName")
        activity_index = action.get("target", {}).get("activityIndex")

        days = itinerary.get("days", [])
        if not target_day or not (1 <= target_day <= len(days)):
            return {
                "itinerary": itinerary,
                "ok": False,
                "message": f"Day {target_day} not found — itinerary has {len(days)} days",
                "changeSummary": {"action": "remove", "target": "activity", "failed": True},
            }
        day = days[target_day - 1]

        # Positional removal — "remove the third activity on day 2"
        if activity_index is not None:
            acts = [s.get("activity") for s in day.get("timeSlots", []) if s.get("activity")]
            if not 1 <= activity_index <= len(acts):
                return {
                    "itinerary": itinerary,
                    "ok": False,
                    "message": f"Day {target_day} has {len(acts)} activities — no #{activity_index}",
                    "changeSummary": {"action": "remove", "target": f"#{activity_index}", "failed": True},
                }
            action["target"]["activityId"] = acts[activity_index - 1].get("id")

        removed = self._extract_activity(day, action)
        name = removed.get("title", "activity") if removed else "activity"
        return {
            "itinerary": itinerary,
            "ok": bool(removed),
            "message": (
                f"Removed {name} from Day {target_day}" if removed
                else f"Activity not found on Day {target_day} "
                     f"(id={activity_id!r}, name={activity_name!r})"
            ),
            "changeSummary": {"action": "remove", "target": name,
                              "removed": [name] if removed else [],
                              "failed": not removed},
        }

    @staticmethod
    def _name_matches(act: dict, activity_name: str) -> bool:
        """Fuzzy name match — the model often passes a substring ("Fado")."""
        needle = (activity_name or "").lower().strip()
        if not needle:
            return False
        for field in (act.get("title"), act.get("name")):
            if field and needle in str(field).lower():
                return True
        return False

    def _extract_activity(self, day: dict, action: dict):
        """Remove and return the matching activity from a day's slots."""
        target = action.get("target", {})
        activity_id = target.get("activityId")
        activity_name = target.get("activityName")
        slots = day.get("timeSlots", [])
        for si, slot in enumerate(slots):
            slot_act = slot.get("activity")
            if slot_act and (
                (activity_id and slot_act.get("id") == activity_id) or
                self._name_matches(slot_act, activity_name)
            ):
                # Whole-slot removal when the slot only holds this activity
                if len(slot.get("activities", [])) <= 1:
                    slots.pop(si)
                    return slot_act
                slot["activity"] = None
                for i, act in enumerate(slot.get("activities", [])):
                    if act.get("id") == slot_act.get("id"):
                        slot["activities"].pop(i)
                        break
                return slot_act
            for i, act in enumerate(slot.get("activities", [])):
                if (activity_id and act.get("id") == activity_id) or \
                   self._name_matches(act, activity_name):
                    removed = slot["activities"].pop(i)
                    if slot.get("activity", {}).get("id") == act.get("id") if slot.get("activity") else False:
                        slot["activity"] = slot["activities"][0] if slot["activities"] else None
                    return removed
        return None

    async def replace_activity(self, itinerary: dict, action: dict, destination: str) -> dict:
        removed = self.remove_activity(itinerary, action)
        if not removed.get("ok"):
            return {
                "itinerary": itinerary,
                "ok": False,
                "message": f"Couldn't find the activity to replace — {removed['message']}",
                "changeSummary": {"action": "replace", "failed": True},
            }
        add_result = await self.add_activity(removed["itinerary"], action, destination)
        new_name = action.get("details", {}).get("placeName", "new activity")
        return {
            "itinerary": add_result["itinerary"],
            "ok": add_result.get("ok", False),
            "message": (
                f"Replaced with {new_name}" if add_result.get("ok")
                else f"Removed the old activity but the add failed — {add_result['message']}"
            ),
            "changeSummary": {"action": "replace", "target": new_name,
                              "failed": not add_result.get("ok", False)},
        }

    def move_activity(self, itinerary: dict, action: dict) -> dict:
        target_day = action.get("target", {}).get("day")
        new_day = action.get("details", {}).get("newDay", target_day)
        activity_id = action.get("target", {}).get("activityId")
        activity_name = action.get("target", {}).get("activityName")
        new_slot = action.get("details", {}).get("newTimeSlot", "morning")

        days = itinerary.get("days", [])
        if not target_day or not (1 <= target_day <= len(days)):
            return {
                "itinerary": itinerary,
                "ok": False,
                "message": f"Day {target_day} not found — itinerary has {len(days)} days",
                "changeSummary": {"action": "move", "failed": True},
            }
        # Validate the destination BEFORE extracting — a bad new_day must not
        # silently drop the activity.
        if not new_day or not (1 <= new_day <= len(days)):
            return {
                "itinerary": itinerary,
                "ok": False,
                "message": f"Day {new_day} not found — activity was not moved",
                "changeSummary": {"action": "move", "failed": True},
            }
        moved_activity = self._extract_activity(days[target_day - 1], action)

        if not moved_activity:
            return {
                "itinerary": itinerary,
                "ok": False,
                "message": (
                    f"Activity not found on Day {target_day} "
                    f"(id={activity_id!r}, name={activity_name!r})"
                ),
                "changeSummary": {"action": "move", "failed": True},
            }

        target = days[new_day - 1]
        target["timeSlots"].append(create_time_slot(new_slot, Activity(**moved_activity)).model_dump())
        _sort_day_slots(target)

        return {
            "itinerary": itinerary,
            "ok": True,
            "message": f"Moved {moved_activity.get('title', 'activity')} to Day {new_day}",
            "changeSummary": {"action": "move", "target": moved_activity.get("title", "activity")},
        }

    def swap_days(self, itinerary: dict, day_a: int, day_b: int) -> dict:
        """Swap two days' full schedules (timeSlots and date), keeping positions."""
        days = itinerary.get("days", [])
        if not (1 <= day_a <= len(days)) or not (1 <= day_b <= len(days)):
            return {
                "itinerary": itinerary,
                "ok": False,
                "message": (
                    f"Can't swap days {day_a} and {day_b} — itinerary has {len(days)} days"
                ),
                "changeSummary": {"action": "swap_days", "failed": True},
            }
        a, b = days[day_a - 1], days[day_b - 1]
        a["timeSlots"], b["timeSlots"] = b.get("timeSlots", []), a.get("timeSlots", [])
        a["date"], b["date"] = b.get("date"), a.get("date")
        a["location"], b["location"] = b.get("location"), a.get("location")
        return {
            "itinerary": itinerary,
            "ok": True,
            "message": f"Swapped Day {day_a} and Day {day_b}",
            "changeSummary": {"action": "swap_days", "target": f"Day {day_a} ↔ Day {day_b}"},
        }

    def add_day(self, itinerary: dict) -> dict:
        days = itinerary.get("days", [])
        day_num = len(days) + 1
        last_location = days[-1].get("location", itinerary.get("tripMetadata", {}).get("destination", "Destination")) if days else "Destination"
        new_day = create_day_plan(day_num, "", last_location).model_dump()
        days.append(new_day)
        return {
            "itinerary": itinerary,
            "message": f"Added Day {day_num}",
            "changeSummary": {"action": "add", "target": f"Day {day_num}"},
        }

    def remove_day(self, itinerary: dict, day_number: int) -> dict:
        days = itinerary.get("days", [])
        if 1 <= day_number <= len(days):
            days.pop(day_number - 1)
            for i, d in enumerate(days):
                d["dayNumber"] = i + 1
            return {
                "itinerary": itinerary,
                "ok": True,
                "message": f"Removed Day {day_number}",
                "changeSummary": {"action": "remove", "target": f"Day {day_number}"},
            }
        return {
            "itinerary": itinerary,
            "ok": False,
            "message": f"Day {day_number} not found — itinerary has {len(days)} days",
            "changeSummary": {"action": "remove", "target": f"Day {day_number}", "failed": True},
        }

    def edit_time(self, itinerary: dict, day: int, slot_id: str, start_time: str, end_time: str) -> dict:
        """Update the start/end time of a time slot."""
        days = itinerary.get("days", [])
        if 1 <= day <= len(days):
            for slot in days[day - 1].get("timeSlots", []):
                if slot.get("id") == slot_id:
                    slot["startTime"] = start_time
                    slot["endTime"] = end_time
                    slot["time"] = f"{start_time}-{end_time}"
                    break
        return {
            "itinerary": itinerary,
            "message": f"Updated time for Day {day}",
            "changeSummary": {"action": "edit_time", "target": f"Day {day}"},
        }

    def update_caption(self, itinerary: dict, day: int, activity_id: str, caption: str) -> dict:
        """Update the description/caption of an activity."""
        days = itinerary.get("days", [])
        if 1 <= day <= len(days):
            for slot in days[day - 1].get("timeSlots", []):
                updated = False
                # Check slot.activity (single-activity field — what the frontend reads)
                slot_act = slot.get("activity")
                if slot_act and slot_act.get("id") == activity_id:
                    slot_act["description"] = caption
                    updated = True
                # Also update in slot.activities list (may be a separate dict copy)
                for act in slot.get("activities", []):
                    if act.get("id") == activity_id:
                        act["description"] = caption
                        updated = True
                if updated:
                    return {
                        "itinerary": itinerary,
                        "message": f"Updated caption for activity on Day {day}",
                        "changeSummary": {"action": "caption", "target": activity_id},
                    }
        return {
            "itinerary": itinerary,
            "message": f"Activity not found on Day {day}",
            "changeSummary": {"action": "caption", "target": activity_id},
        }

    def reorder_activity(self, itinerary: dict, day: int, activity_id: str, new_position: int) -> dict:
        """Reorder an activity within a day's time slots."""
        days = itinerary.get("days", [])
        if not (1 <= day <= len(days)):
            return {
                "itinerary": itinerary,
                "message": f"Day {day} not found",
                "changeSummary": {"action": "reorder", "target": activity_id},
            }

        day_data = days[day - 1]
        slots = day_data.get("timeSlots", [])

        # Flatten all activities across slots in order, tracking which slot each came from
        all_activities = []
        slot_map = []  # (slot_index, activity_index_in_slot)
        for si, slot in enumerate(slots):
            acts = slot.get("activities", [])
            for ai, act in enumerate(acts):
                all_activities.append(act)
                slot_map.append((si, ai))

        # Find the activity and move it
        found_idx = None
        for i, act in enumerate(all_activities):
            if act.get("id") == activity_id:
                found_idx = i
                break

        if found_idx is None:
            return {
                "itinerary": itinerary,
                "message": f"Activity not found on Day {day}",
                "changeSummary": {"action": "reorder", "target": activity_id},
            }

        # Clamp new_position
        new_position = max(0, min(new_position, len(all_activities) - 1))
        moved = all_activities.pop(found_idx)
        all_activities.insert(new_position, moved)

        # Rebuild: distribute activities back to slots, preserving slot boundaries
        # We keep the same number of activities per slot as before
        slot_sizes = [len(slot.get("activities", [])) for slot in slots]
        offset = 0
        for si, slot in enumerate(slots):
            count = slot_sizes[si]
            slot["activities"] = all_activities[offset:offset + count]
            # Update slot.activity to the first activity if any
            if slot["activities"]:
                slot["activity"] = slot["activities"][0]
            offset += count

        return {
            "itinerary": itinerary,
            "message": f"Reordered activity on Day {day}",
            "changeSummary": {"action": "reorder", "target": activity_id},
        }


itinerary_editor = ItineraryEditor()
