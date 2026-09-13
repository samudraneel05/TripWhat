"""Shared robust JSON parsing for LLM outputs.

Canonical home for the _repair_json / _parse_json_robust helpers that are
currently duplicated in app/agents/tools/plan_tools.py and
app/services/itinerary_builder.py. New code should import from here; the
private copies can be removed in a follow-up cleanup.
"""

import json
import re
from typing import Any


def repair_json(text: str) -> str:
    """Attempt to fix common LLM JSON mistakes.

    Handles:
    - Markdown code fences (```json ... ```)
    - Single-quoted strings → double-quoted
    - Unquoted property names → quoted
    - Trailing commas before } or ]
    - Smart quotes → straight quotes
    - Missing commas between items
    """
    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```\s*$", "", text)

    # Replace smart quotes with straight quotes
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2018", "'").replace("\u2019", "'")

    # Replace single-quoted strings with double-quoted ones.
    # Match '...' that appear in JSON delimiter positions:
    # After [, {, :, ,  or  before ], }, :, ,
    text = re.sub(r"([\[{,:])\s*'([^']*)'", r'\1 "\2"', text)
    text = re.sub(r"'([^']*)'\s*([,\]}:])", r'"\1" \2', text)
    # Handle single-quoted strings at the very start/end
    text = re.sub(r"^\s*'([^']*)'", r'"\1"', text)
    text = re.sub(r"'([^']*)'\s*$", r'"\1"', text)

    # Quote unquoted property names: {name: ... → {"name": ...
    text = re.sub(r'([{,]\s*)([a-zA-Z_]\w*)\s*:', r'\1"\2":', text)

    # Remove trailing commas before } or ]
    text = re.sub(r",\s*([}\]])", r"\1", text)

    # Fix missing commas between items: }" → },"  ]" → ],"  }{ → },{  ]{ → ],{
    text = re.sub(r'(["\d\w\]\}])\s*(\{["\[])', r'\1,\2', text)
    # Fix missing comma between number/bool/null and a quoted property name: 4 "order" → 4, "order"
    text = re.sub(r'(\b\d+|true|false|null)\s+(")', r'\1, \2', text)
    # Fix missing comma between adjacent strings: "value" "key" → "value", "key"
    # (safe because in valid JSON, "": "" has a colon between the quotes)
    text = re.sub(r'"\s+"', '", "', text)

    return text


def parse_json_robust(text: str) -> Any | None:
    """Parse JSON from LLM output with multiple repair attempts.

    Tries direct parse, then regex extraction (array or object), then repair.
    Returns None if all attempts fail.
    """
    if not text:
        return None

    # Attempt 1: direct parse
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass

    # Attempt 2: extract JSON array or object via regex, then parse
    for pattern in [r"\[[\s\S]*\]", r"\{[\s\S]*\}"]:
        match = re.search(pattern, text)
        if match:
            raw = match.group()
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                # Attempt 3: repair and retry
                repaired = repair_json(raw)
                try:
                    return json.loads(repaired)
                except json.JSONDecodeError:
                    # Attempt 4: extract again after repair
                    match2 = re.search(pattern, repaired)
                    if match2:
                        try:
                            return json.loads(match2.group())
                        except json.JSONDecodeError:
                            pass

    return None
