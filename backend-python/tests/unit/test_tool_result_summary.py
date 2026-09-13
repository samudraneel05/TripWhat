"""Unit tests for TravelAgent._tool_result_summary.

Regression coverage for the repr-leak bug: tool outputs arriving as
ToolMessage-like objects or content-block lists used to surface raw reprs
like "{'text': ...}" or "content=[TextContent(...)]" in the tool bar.
"""

from types import SimpleNamespace

from app.agents.travel_agent import TravelAgent


def _summary(output):
    return TravelAgent._tool_result_summary("mcp_search_places", {}, output)


class TestToolResultSummary:
    def test_none_output_returns_empty(self):
        assert _summary(None) == ""

    def test_plain_string_output(self):
        assert _summary("Found 5 temples in Tokyo") == "Found 5 temples in Tokyo"

    def test_dict_with_places_count(self):
        assert _summary({"places": [{"name": "a"}, {"name": "b"}]}) == "2 places found"

    def test_dict_with_results_count(self):
        assert _summary({"results": [1, 2, 3]}) == "3 results found"

    def test_dict_with_routes_count(self):
        assert _summary({"routes": [{"a": 1}]}) == "1 routes found"

    def test_message_content_string(self):
        # ToolMessage-like object with a plain string content
        msg = SimpleNamespace(content="Found 4 hotels")
        assert _summary(msg) == "Found 4 hotels"

    def test_message_content_block_dicts(self):
        # content=[{"type": "text", "text": "..."}] — must not leak the dict repr
        msg = SimpleNamespace(content=[{"type": "text", "text": "Found 7 cafes"}])
        assert _summary(msg) == "Found 7 cafes"

    def test_message_content_block_objects(self):
        # content=[TextContent(text="...")]-style objects with a .text attr
        msg = SimpleNamespace(content=[SimpleNamespace(text="Done — 2 routes")])
        out = _summary(msg)
        assert "TextContent" not in out
        assert "content=" not in out
        assert "2 routes" in out

    def test_single_dict_content_block(self):
        # content={"type": "text", "text": "..."}
        msg = SimpleNamespace(content={"type": "text", "text": "All done"})
        assert _summary(msg) == "All done"

    def test_empty_block_list_returns_empty(self):
        # No extractable text — never fall back to a repr
        msg = SimpleNamespace(content=[{"type": "image", "data": "..."}])
        out = _summary(msg)
        assert "{" not in out
        assert "image" not in out

    def test_command_like_object_returns_empty(self):
        # langgraph Command-style objects have no useful text — repr must not leak
        cmd = SimpleNamespace(update={"trip_state": {"x": 1}})
        out = _summary(cmd)
        assert "update" not in out
        assert "trip_state" not in out
        assert out == ""

    def test_strips_markdown_emphasis(self):
        out = _summary("Found **3** hotels")
        assert "**" not in out

    def test_truncates_long_output(self):
        out = _summary("x" * 200)
        assert len(out) <= 81
        assert out.endswith("…")
