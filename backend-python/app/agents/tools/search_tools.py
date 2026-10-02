"""Search tools — web_search only.

Place search is handled by mcp_search_places (in mcp_tools.py) which uses a
cache-first chain (Google Maps MCP → Google Places API → OpenTripMap).
Place name resolution is handled by mcp_resolve_names.
"""

from langchain_core.tools import tool
from langchain_tavily import TavilySearch

from app.config import settings
from app.utils.logger import logger


@tool
async def web_search(query: str) -> str:
    """Search the web for travel information that requires current data — visa requirements,
    travel advisories, seasonal events, news, or anything you can't answer from knowledge.
    Do NOT use this for finding places (use mcp_search_places instead).

    Args:
        query: What to search for (e.g., "Japan visa requirements for US citizens")
    """
    if not settings.tavily_api_key:
        return "Web search unavailable: Tavily API key not configured."

    try:
        tavily = TavilySearch(
            max_results=5,
            search_depth="basic",
            include_answer=True,
            tavily_api_key=settings.tavily_api_key,
        )
        result = await tavily.ainvoke(query)

        # TavilySearch returns a list of content blocks or a dict
        if isinstance(result, list):
            parts = []
            for block in result:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block["text"])
                elif isinstance(block, str):
                    parts.append(block)
            return "\n\n".join(parts)[:2000] if parts else str(result)[:2000]
        elif isinstance(result, dict):
            answer = result.get("answer", "")
            results_list = result.get("results", [])
            parts = []
            if answer:
                parts.append(answer)
            for r in results_list[:5]:
                parts.append(f"**{r.get('title', '')}**: {r.get('content', '')[:200]}")
            return "\n\n".join(parts)[:2000] if parts else str(result)[:2000]
        else:
            return str(result)[:2000]
    except Exception as e:
        logger.error(f"Web search failed: {e}")
        return f"Web search failed: {e}"


def make_search_tools(all_tools: list):
    """Build the `search_tools` meta-tool over the agent's full catalog.

    Progressive disclosure: situational tools are hidden from the model
    until the conversation signals them. If the model needs a capability it
    can't see, it calls this tool — the middleware then un-hides matching
    tools on the next model call.
    """
    catalog = all_tools  # captured by closure

    @tool
    async def search_tools(query: str) -> str:
        """Discover which capabilities are available for a task. Call this when
        the user's request needs something that isn't among your current tools
        (e.g., email bookings, calendar, flights, weather, routes). The matched
        tool becomes available immediately after this returns.

        Args:
            query: What you need to do (e.g., "import bookings from email")
        """
        words = {w for w in query.lower().split() if len(w) > 2}
        matches = [
            f"- {t.name}: {(t.description or '').split(chr(10))[0].strip()[:120]}"
            for t in catalog
            if t.name != "search_tools"
            and words & set((t.name + " " + (t.description or "")).lower().split())
        ]
        if not matches:
            return "No matching tools. Available capabilities are already loaded."
        return "Matched tools (now available):\n" + "\n".join(matches[:8])

    return search_tools
