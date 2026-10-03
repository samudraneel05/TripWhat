"""Places routes — search, autocomplete, and details."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import get_current_user
from app.services.places_service import places_service
from app.services.google_places import google_places
from app.utils.logger import logger

router = APIRouter()


@router.get("/search")
async def search_places(query: str = Query(...), limit: int = 10, _user=Depends(get_current_user)):
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Query parameter is required")
    places = await places_service.search_places(query.strip(), limit)
    return places


@router.get("/details")
async def get_place_details(placeId: str = Query(...), _user=Depends(get_current_user)):
    """Get detailed place information including photos, reviews, hours, contact info,
    editorial summary, business status, and nearby alternates."""
    if not placeId:
        raise HTTPException(status_code=400, detail="placeId parameter is required")

    details = await google_places.get_place_details(placeId)
    if not details:
        raise HTTPException(status_code=404, detail="Place not found")

    # Resolve up to 5 photo references to direct URLs
    photos = details.get("photos", [])
    photo_urls = []
    for p in photos[:5]:
        ref = p.get("photo_reference", "")
        if ref:
            url = await google_places.resolve_photo_url(ref)
            if url:
                photo_urls.append(url)

    # Extract reviews
    reviews = []
    for r in details.get("reviews", [])[:5]:
        reviews.append({
            "author": r.get("author_name", ""),
            "rating": r.get("rating", 0),
            "text": r.get("text", ""),
            "time": r.get("time", 0),
            "profilePhoto": r.get("profile_photo_url", ""),
            "language": r.get("language", ""),
        })

    # Opening hours
    opening_hours = details.get("opening_hours", {})
    weekday_text = opening_hours.get("weekday_text", []) if opening_hours else []

    # Address components — extract area and locality for display
    address_components = details.get("address_components", [])
    area = ""
    locality = ""
    country = ""
    for comp in address_components:
        types = comp.get("types", [])
        if "sublocality" in types or "locality" in types:
            area = area or comp.get("long_name", "")
        if "locality" in types:
            locality = comp.get("long_name", "")
        if "country" in types:
            country = comp.get("long_name", "")

    # Editorial summary (Google's description)
    editorial = details.get("editorial_summary", {})
    description = editorial.get("overview", "") if editorial else ""

    # Coordinates for nearby search
    geom = details.get("geometry", {}).get("location", {})
    lat = geom.get("lat", 0)
    lng = geom.get("lng", 0)

    # Fetch nearby alternates (exclude current place)
    alternates = []
    if lat and lng:
        try:
            # Determine place type from types for better nearby search
            place_types = details.get("types", [])
            nearby_type = "tourist_attraction"
            if "restaurant" in place_types or "meal_takeaway" in place_types:
                nearby_type = "restaurant"
            elif "lodging" in place_types:
                nearby_type = "lodging"
            elif "museum" in place_types:
                nearby_type = "museum"
            elif "amusement_park" in place_types:
                nearby_type = "amusement_park"

            nearby = await google_places.find_nearby(lat, lng, radius=3000, place_type=nearby_type)
            alternates = [
                {
                    "placeId": n.get("placeId", ""),
                    "name": n.get("name", ""),
                    "address": n.get("address", ""),
                    "rating": n.get("rating"),
                    "coordinates": n.get("coordinates", {}),
                }
                for n in nearby
                if n.get("placeId") != placeId
            ][:4]
        except Exception as e:
            logger.warning(f"[PLACES] Nearby search failed for placeId={placeId}: {e}")

    result = {
        "placeId": placeId,
        "name": details.get("name", ""),
        "address": details.get("formatted_address", ""),
        "phoneNumber": details.get("formatted_phone_number", ""),
        "internationalPhone": details.get("international_phone_number", ""),
        "website": details.get("website", ""),
        "mapsUrl": details.get("url", ""),
        "rating": details.get("rating"),
        "userRatingsTotal": details.get("user_ratings_total", 0),
        "photos": photo_urls,
        "reviews": reviews,
        "openingHours": weekday_text,
        "isOpen": opening_hours.get("open_now") if opening_hours else None,
        "priceLevel": details.get("price_level"),
        "businessStatus": details.get("business_status", ""),
        "types": details.get("types", []),
        "coordinates": {"lat": lat, "lng": lng},
        "description": description,
        "area": area,
        "locality": locality,
        "country": country,
        "alternates": alternates,
    }

    logger.info(
        f"[PLACES] Details for placeId={placeId} → {len(photo_urls)} photos, "
        f"{len(reviews)} reviews, {len(alternates)} alternates"
    )
    return result
