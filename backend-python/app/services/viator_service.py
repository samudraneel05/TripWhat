"""Viator Partner API — tours & activities linked to a place.

Free affiliate tier: sign up at viator.com/partners → API key in dashboard.
Basic Access covers /search/freetext + /products/search. Transactions happen
on viator.com (affiliate referral). No key configured → empty results, the
Activities tab in the place panel stays hidden.
"""

import time

import httpx

from app.config import settings
from app.utils.logger import logger

_TTL_SECONDS = 6 * 3600


class ViatorService:
    def __init__(self):
        self._cache: dict[str, tuple[float, list[dict]]] = {}

    def _key(self) -> str:
        return settings.viator_api_key

    def _headers(self) -> dict:
        return {
            "exp-api-key": self._key(),
            "Accept": "application/json;version=2.0",
            "Accept-Language": "en-US",
            "Content-Type": "application/json",
        }

    async def search_activities(
        self, place_name: str, city: str | None = None, limit: int = 6
    ) -> list[dict]:
        """Tours/activities mentioning a place — freetext product search.

        Returns normalized product dicts; [] when unconfigured or on failure.
        """
        if not self._key() or not place_name:
            return []

        term = f"{place_name} {city}".strip() if city else place_name
        cache_key = f"{term.lower()}:{limit}"
        hit = self._cache.get(cache_key)
        if hit and time.time() - hit[0] < _TTL_SECONDS:
            return hit[1]

        body = {
            "searchTerm": term,
            "searchTypes": [{"searchType": "PRODUCTS", "pagination": {"start": 1, "count": limit}}],
            "sorting": {"sort": "DEFAULT", "order": "DESCENDING"},
            "currency": "USD",
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{settings.viator_base_url}/search/freetext",
                    headers=self._headers(),
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            logger.warning(f"[VIATOR] freetext search failed for '{term}': {e}")
            return []

        products = [
            self._normalize(p)
            for t in (data.get("products") or {}).get("results", []) or []
            for p in [t]
        ]
        products = [p for p in products if p]
        self._cache[cache_key] = (time.time(), products)
        if len(self._cache) > 500:
            oldest = sorted(self._cache.items(), key=lambda kv: kv[1][0])[:100]
            for k, _ in oldest:
                self._cache.pop(k, None)
        return products

    @staticmethod
    def _normalize(p: dict) -> dict | None:
        code = p.get("productCode")
        title = p.get("title")
        if not code or not title:
            return None
        image = ""
        for img in p.get("images") or []:
            variants = img.get("variants") or []
            best = max(variants, key=lambda v: v.get("width", 0), default=None)
            if best and best.get("url"):
                image = best["url"]
                break
        reviews = p.get("reviews") or {}
        pricing = ((p.get("pricing") or {}).get("summary") or {})
        return {
            "productCode": code,
            "title": title,
            "imageUrl": image,
            "rating": reviews.get("combinedAverageRating"),
            "reviewCount": reviews.get("totalReviews"),
            "fromPrice": pricing.get("fromPrice"),
            "currency": pricing.get("currencyCode") or "USD",
            "productUrl": p.get("productUrl") or "",
        }


viator_service = ViatorService()
