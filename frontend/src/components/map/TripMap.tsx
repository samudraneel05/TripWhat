import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { imgUrl } from '../../lib/image';

interface SearchPlacePin {
  placeId: string;
  name: string;
  address?: string;
  rating?: number | null;
  type?: string;
  coordinates: { lat: number; lng: number } | null;
}

interface TripMapProps {
  itinerary: any;
  selectedCity?: string | null;
  destination?: string | null;
  centerOnCoords?: { lat: number; lng: number } | null;
  searchPlaces?: SearchPlacePin[] | null;
  onSelectSearchPlace?: (placeId: string) => void;
  /** placeId of the hovered postcard — lifts its pin so cards and the map
   *  correlate without numbered badges. */
  hoveredSearchPlaceId?: string | null;
  onClearSearchPlaces?: () => void;
}

const MARKER_COLORS = [
  '#EA580C', '#2563EB', '#16A34A', '#9333EA', '#DC2626',
  '#0891B2', '#CA8A04', '#DB2777', '#4F46E5', '#059669',
];

const CITY_COORDS: Record<string, [number, number]> = {
  tokyo: [139.6917, 35.6895], kyoto: [135.7681, 35.0116], osaka: [135.5023, 34.6937],
  paris: [2.3522, 48.8566], bali: [115.1889, -8.4095], japan: [138.2529, 36.2048],
  london: [-0.1276, 51.5074], newyork: [-74.006, 40.7128], 'new york': [-74.006, 40.7128],
  iceland: [-19.0222, 64.9631], reykjavik: [-21.9426, 64.1466], bangkok: [100.5018, 13.7563],
  rome: [12.4964, 41.9028], barcelona: [2.1734, 41.3851], amsterdam: [4.9041, 52.3676],
  berlin: [13.405, 52.52], sydney: [151.2093, -33.8688], seoul: [126.978, 37.5665],
  singapore: [103.8198, 1.3521], dubai: [55.2708, 25.2048], istanbul: [28.9784, 41.0082],
  prague: [14.4378, 50.0755], vienna: [16.3738, 48.2082], madrid: [-3.7038, 40.4168],
  lisbon: [-9.1393, 38.7223], athens: [23.7276, 37.9838], cairo: [31.2357, 30.0444],
  marrakech: [-7.9811, 31.6295], capetown: [18.4241, -33.9249], 'cape town': [18.4241, -33.9249],
  rio: [-43.1729, -22.9068], 'rio de janeiro': [-43.1729, -22.9068],
  mexicocity: [-99.1332, 19.4326], 'mexico city': [-99.1332, 19.4326],
  hanoi: [105.8342, 21.0278], saigon: [106.6297, 10.8231], hochiminh: [106.6297, 10.8231],
};

// Type-icon pin language for explored (uncommitted) places — each kind has
// a fill color + a white glyph, the mindtrip-style map vocabulary.
const PIN_ICONS: Record<string, string> = {
  landmark: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  church: '<path d="m18 7 4 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9l4-2"/><path d="M14 22v-4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v4"/><path d="M18 22V5l-6-3-6 3v17"/><path d="M12 7v3"/><path d="M10 9h4"/>',
  tree: '<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2a1 1 0 0 1-.7-1.7L12 4l3.9 3.3a1 1 0 0 1-.7 1.7H15l3 3.3a1 1 0 0 1-.7 1.7Z"/><path d="M12 22v-3"/>',
  food: '<path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/>',
  camera: '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  bed: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/><path d="M2 21h20"/>',
  shopping: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
};

function pinIconSvg(name: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block">${PIN_ICONS[name] || PIN_ICONS.pin}</svg>`;
}

/** Kind → fill color + glyph. Derived from the place's type string. */
function placeKind(type?: string): { color: string; icon: string } {
  const t = (type || '').toLowerCase();
  if (/museum|gallery|art_|art gallery|monument|memorial|castle|palace|historic/.test(t))
    return { color: '#DB2777', icon: 'landmark' };
  if (/church|cathedral|mosque|temple|synagogue|shrine|basilica|chapel/.test(t))
    return { color: '#7C3AED', icon: 'church' };
  if (/park|garden|nature|zoo|national|forest|botanical|aquarium|falls/.test(t))
    return { color: '#16A34A', icon: 'tree' };
  if (/restaurant|food|cafe|bar|bakery|meal|bistro|coffee|pub|eatery/.test(t))
    return { color: '#D97706', icon: 'food' };
  if (/hotel|lodging|hostel|resort|accommodation/.test(t))
    return { color: '#4F46E5', icon: 'bed' };
  if (/viewpoint|observation|beach|mountain|scenic|bridge|square|piazza|plaza|harbou?r|lake/.test(t))
    return { color: '#0891B2', icon: 'camera' };
  if (/shop|store|market|mall|boutique/.test(t))
    return { color: '#E11D48', icon: 'shopping' };
  return { color: '#15803D', icon: 'pin' };
}

/** placeId/name → day number for every activity already on the itinerary. */
function itineraryPlaceMap(itinerary: any): Map<string, number> {
  const map = new Map<string, number>();
  for (const day of itinerary?.days || []) {
    for (const slot of day.timeSlots || []) {
      const acts = slot.activities || (slot.activity ? [slot.activity] : []);
      for (const act of acts) {
        if (act.placeId) map.set(act.placeId, day.dayNumber);
        if (act.name) map.set(`n:${String(act.name).toLowerCase().trim()}`, day.dayNumber);
      }
    }
  }
  return map;
}

function lookupCityCoord(name: string): [number, number] | null {
  const key = name.toLowerCase().trim();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

export function TripMap({ itinerary, selectedCity, destination, centerOnCoords, searchPlaces, onSelectSearchPlace, hoveredSearchPlaceId, onClearSearchPlaces }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const searchMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const searchPinElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const lastDestRef = useRef<string | null>(null);
  const lastBoundsSigRef = useRef<string>('');
  const lastSearchSigRef = useRef<string>('');
  const [dayFilter, setDayFilter] = useState<number | null>(null); // null = all days

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token || !containerRef.current) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      zoom: 4,
      center: [0, 20],
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));

    mapRef.current = map;

    // Center on the user's location when nothing else has framed the view.
    // maximumAge lets the browser answer from a recent cached fix — without
    // it every mount waits on a fresh GPS/network fix (the "map sits on the
    // world view for seconds" finickiness). Skipped entirely when itinerary
    // or search pins already own the camera.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!mapRef.current) return;
          const viewAlreadySet =
            lastBoundsSigRef.current !== '' || lastSearchSigRef.current !== '';
          if (viewAlreadySet) return;
          mapRef.current.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 10,
            speed: 1.0,
            essential: true,
          });
        },
        (err) => {
          console.debug('[TripMap] geolocation unavailable, keeping world view:', err?.message);
        },
        { timeout: 5000, maximumAge: 300000 }
      );
    }

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      searchMarkersRef.current.forEach((m) => m.remove());
      searchMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !itinerary) return;

    const addMarkers = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const days = itinerary.days || [];
      const bounds = new mapboxgl.LngLatBounds();
      let hasMarkers = false;

      // Helper to create a marker element with a custom style
      const makeMarkerEl = (bg: string, content: string, size = 24) => {
        const el = document.createElement('div');
        el.style.cssText = `
          width: ${size}px; height: ${size}px; border-radius: 50%;
          background: ${bg}; border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          cursor: pointer; display: flex; align-items: center;
          justify-content: center; font-size: 10px; color: #fff;
          font-weight: 600;
        `;
        el.textContent = content;
        return el;
      };

      const makePopup = (name: string, subtitle: string, imageUrl?: string) => {
        const popup = new mapboxgl.Popup({ offset: 16, closeButton: false, closeOnClick: false });
        const imgHtml = imageUrl
          ? `<img src="${imgUrl(imageUrl)}" style="width:100%;height:60px;object-fit:cover;border-radius:4px;margin-bottom:4px;" />`
          : '';
        popup.setHTML(`
          <div style="font-family: Inter, sans-serif; padding: 4px 2px; max-width: 200px;">
            ${imgHtml}
            <div style="font-size: 12px; font-weight: 600; color: #1C1917; margin-bottom: 2px;">${name}</div>
            <div style="font-size: 11px; color: #78716C;">${subtitle}</div>
          </div>
        `);
        return popup;
      };

      const addMarkerWithPopup = (el: HTMLElement, lng: number, lat: number, popup: mapboxgl.Popup) => {
        const marker = new mapboxgl.Marker(el)
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map);
        el.addEventListener('mouseenter', () => popup.addTo(map));
        el.addEventListener('mouseleave', () => popup.remove());
        markersRef.current.push(marker);
        bounds.extend([lng, lat]);
        hasMarkers = true;
      };

      // --- Activity markers (numbered, colored by day) ---
      days.forEach((day: any) => {
        if (selectedCity && day.location !== selectedCity) return;
        if (dayFilter !== null && day.dayNumber !== dayFilter) return;

        const colorIdx = ((day.dayNumber || 1) - 1) % MARKER_COLORS.length;
        const color = MARKER_COLORS[colorIdx];
        const timeSlots = day.timeSlots || [];

        timeSlots.forEach((slot: any) => {
          const activities = slot.activities || (slot.activity ? [slot.activity] : []);
          activities.forEach((act: any) => {
            if (act.coordinates && act.coordinates.lat != null && act.coordinates.lng != null) {
              const el = makeMarkerEl(color, String(day.dayNumber || ''));
              const popup = makePopup(act.name, `Day ${day.dayNumber} · ${day.location || ''}`, act.imageUrl);
              addMarkerWithPopup(el, act.coordinates.lng, act.coordinates.lat, popup);
            }
          });
        });
      });

      // --- Hotel markers (purple, "H" label) ---
      // Show hotels when no day filter is active, or when the hotel's city
      // matches the selected city filter
      const hotels = itinerary.hotelRecommendations || [];
      hotels.forEach((hotel: any) => {
        if (!hotel.coordinates || hotel.coordinates.lat == null || hotel.coordinates.lng == null) return;
        if (selectedCity && hotel.address && !hotel.address.includes(selectedCity) && !hotel.name?.includes(selectedCity)) return;
        const el = makeMarkerEl('#7C3AED', 'H', 22);
        const popup = makePopup(hotel.name, `Hotel · ${hotel.address || ''}`, hotel.imageUrl);
        addMarkerWithPopup(el, hotel.coordinates.lng, hotel.coordinates.lat, popup);
      });

      // --- Restaurant markers (amber, fork/knife emoji) ---
      const restaurants = itinerary.restaurantRecommendations || [];
      restaurants.forEach((rest: any) => {
        if (!rest.coordinates || rest.coordinates.lat == null || rest.coordinates.lng == null) return;
        if (selectedCity && rest.address && !rest.address.includes(selectedCity) && !rest.name?.includes(selectedCity)) return;
        const el = makeMarkerEl('#D97706', '🍽', 22);
        el.style.fontSize = '11px';
        const popup = makePopup(rest.name, `Restaurant · ${rest.cuisine || rest.address || ''}`, rest.imageUrl);
        addMarkerWithPopup(el, rest.coordinates.lng, rest.coordinates.lat, popup);
      });

      if (hasMarkers) {
        // Only refit the camera when the marker set actually changed —
        // re-running fitBounds on every itinerary object churn was the
        // "map keeps fading/jumping" bug.
        const sig = bounds.isEmpty() ? ''
          : `${bounds.getWest().toFixed(3)},${bounds.getSouth().toFixed(3)},${bounds.getEast().toFixed(3)},${bounds.getNorth().toFixed(3)}`;
        if (sig && sig !== lastBoundsSigRef.current) {
          lastBoundsSigRef.current = sig;
          map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
        }
      }
    };

    if (map.loaded()) {
      addMarkers();
    } else {
      map.once('load', addMarkers);
    }
  }, [itinerary, selectedCity, dayFilter]);

  // --- Search-result pins (numbered, teal) + camera fit ---
  // Places the user is *exploring* in chat — distinct from itinerary pins
  // (day colors). Rebuilt when the search set changes; fitBounds only when
  // the itinerary hasn't already framed a view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const renderPins = () => {
      searchMarkersRef.current.forEach((m) => m.remove());
      searchMarkersRef.current = [];
      searchPinElsRef.current.clear();

      const places = (searchPlaces || []).filter(
        (p) => p.coordinates && p.coordinates.lat != null && p.coordinates.lng != null
      );
      if (places.length === 0) {
        lastSearchSigRef.current = '';
        return;
      }

      // Explored vs committed: a place already on the itinerary renders as a
      // day-colored pill (type icon + day number) instead of its type pin.
      const committed = itineraryPlaceMap(itinerary);

      const bounds = new mapboxgl.LngLatBounds();
      places.forEach((p) => {
        const kind = placeKind(p.type);
        const dayNum =
          (p.placeId && committed.get(p.placeId)) ??
          committed.get(`n:${p.name.toLowerCase().trim()}`);
        // Mapbox owns the marker element's transform (positioning) — all
        // our styling, including hover lift, goes on an inner element.
        const el = document.createElement('div');
        const inner = document.createElement('div');
        if (dayNum != null) {
          const dayColor = MARKER_COLORS[((dayNum || 1) - 1) % MARKER_COLORS.length];
          inner.style.cssText = `
            height: 24px; border-radius: 999px; padding: 0 8px 0 5px;
            background: ${dayColor}; border: 2px solid #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.25);
            cursor: pointer; display: flex; align-items: center; gap: 3px;
            font-size: 11px; color: #fff; font-weight: 700;
            transition: transform 150ms ease-out, box-shadow 150ms ease-out;
          `;
          inner.innerHTML = `${pinIconSvg(kind.icon, 12)}<span>${dayNum}</span>`;
        } else {
          inner.style.cssText = `
            width: 26px; height: 26px; border-radius: 8px;
            background: ${kind.color}; border: 2px solid #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.25);
            cursor: pointer; display: flex; align-items: center;
            justify-content: center; color: #fff;
            transition: transform 150ms ease-out, box-shadow 150ms ease-out;
          `;
          inner.innerHTML = pinIconSvg(kind.icon, 14);
        }
        el.appendChild(inner);
        const popup = new mapboxgl.Popup({ offset: 14, closeButton: false, closeOnClick: false });
        popup.setHTML(
          `<div style="font-family: Inter, sans-serif; padding: 4px 2px; max-width: 200px;">
            <div style="font-size: 12px; font-weight: 600; color: #1C1917;">${p.name}</div>
            <div style="font-size: 11px; color: #78716C;">${
              [dayNum != null ? `Day ${dayNum}` : '', p.type, p.rating != null ? `★ ${p.rating}` : ''].filter(Boolean).join(' · ')
            }</div>
          </div>`
        );
        const marker = new mapboxgl.Marker(el)
          .setLngLat([p.coordinates!.lng, p.coordinates!.lat])
          .setPopup(popup)
          .addTo(map);
        inner.addEventListener('mouseenter', () => popup.addTo(map));
        inner.addEventListener('mouseleave', () => popup.remove());
        inner.addEventListener('click', () => onSelectSearchPlace?.(p.placeId));
        searchMarkersRef.current.push(marker);
        if (p.placeId) searchPinElsRef.current.set(p.placeId, inner);
        bounds.extend([p.coordinates!.lng, p.coordinates!.lat]);
      });

      const sig = places.map((p) => p.placeId).sort().join('|') + `|d${[...committed.values()].sort().join(',')}`;
      if (sig === lastSearchSigRef.current) return;
      lastSearchSigRef.current = sig;

      // Itinerary markers own the camera when present (bounds signature set)
      if (lastBoundsSigRef.current) return;

      if (places.length === 1) {
        map.flyTo({ center: [places[0].coordinates!.lng, places[0].coordinates!.lat], zoom: 13, speed: 1.2, essential: true });
      } else {
        map.fitBounds(bounds, { padding: 60, maxZoom: 13 });
      }
    };

    if (map.loaded()) {
      renderPins();
    } else {
      map.once('load', renderPins);
    }
  }, [searchPlaces, itinerary, onSelectSearchPlace]);

  // Card-hover → pin lift: postcards highlight their pin instead of
  // carrying number badges.
  useEffect(() => {
    const els = searchPinElsRef.current;
    for (const [id, el] of els) {
      const active = id === hoveredSearchPlaceId;
      el.style.transform = active ? 'scale(1.25) translateY(-2px)' : '';
      el.style.boxShadow = active ? '0 4px 10px rgba(0,0,0,0.35)' : '';
      el.style.zIndex = active ? '10' : '';
    }
  }, [hoveredSearchPlaceId]);

  // Fly-to animation when destination changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !destination || destination === lastDestRef.current) return;

    const coords = lookupCityCoord(destination);
    if (!coords) return;

    lastDestRef.current = destination;

    const doFlyTo = () => {
      map.flyTo({
        center: coords,
        zoom: 5,
        speed: 1.2,
        curve: 1.5,
        easing: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
        essential: true,
      });
    };

    if (map.loaded()) {
      doFlyTo();
    } else {
      map.once('load', doFlyTo);
    }
  }, [destination]);

  // Fly-to animation when centerOnCoords changes (e.g., user clicks an activity)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !centerOnCoords) return;

    const doFlyTo = () => {
      map.flyTo({
        center: [centerOnCoords.lng, centerOnCoords.lat],
        zoom: 14,
        speed: 1.2,
        curve: 1.5,
        easing: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
        essential: true,
      });
    };

    if (map.loaded()) {
      doFlyTo();
    } else {
      map.once('load', doFlyTo);
    }
  }, [centerOnCoords]);

  const days = itinerary?.days || [];
  const showFilter = days.length > 1;
  const hasHotels = (itinerary?.hotelRecommendations?.length || 0) > 0;
  const hasRestaurants = (itinerary?.restaurantRecommendations?.length || 0) > 0;
  const showLegend = hasHotels || hasRestaurants;

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {showFilter && (
        <div className="absolute top-2 left-2 z-10 flex items-center gap-0.5 bg-white/90 backdrop-blur-sm rounded-md shadow-sm border border-black/5 px-1 py-0.5">
          <button
            onClick={() => setDayFilter(null)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              dayFilter === null ? 'bg-[var(--ink)] text-white' : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            All
          </button>
          {days.map((d: any) => {
            const colorIdx = ((d.dayNumber || 1) - 1) % MARKER_COLORS.length;
            const color = MARKER_COLORS[colorIdx];
            const isActive = dayFilter === d.dayNumber;
            return (
              <button
                key={d.dayNumber}
                onClick={() => setDayFilter(isActive ? null : d.dayNumber)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
                  isActive ? 'text-white' : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
                style={isActive ? { backgroundColor: color } : undefined}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: isActive ? '#fff' : color }}
                />
                {d.dayNumber}
              </button>
            );
          })}
        </div>
      )}
      {/* Clear search pins — explicit user action, the "until someone tells
          you to" half of pin persistence */}
      {searchPlaces && searchPlaces.length > 0 && onClearSearchPlaces && (
        <button
          onClick={onClearSearchPlaces}
          className="absolute top-2 right-14 z-10 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-full shadow-sm border border-black/5 px-2 py-1 text-[10px] font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          title="Clear explored pins"
        >
          ✕ {searchPlaces.length} pin{searchPlaces.length > 1 ? 's' : ''}
        </button>
      )}
      {showLegend && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-3 bg-white/90 backdrop-blur-sm rounded-md shadow-sm border border-black/5 px-2.5 py-1.5">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-[#EA580C] border border-white shadow-sm" />
            <span className="text-[10px] text-[var(--ink)] font-medium">Activities</span>
          </div>
          {hasHotels && (
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-[#7C3AED] border border-white shadow-sm flex items-center justify-center text-[7px] text-white font-bold">H</span>
              <span className="text-[10px] text-[var(--ink)] font-medium">Hotels</span>
            </div>
          )}
          {hasRestaurants && (
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-[#D97706] border border-white shadow-sm flex items-center justify-center text-[8px]">🍽</span>
              <span className="text-[10px] text-[var(--ink)] font-medium">Restaurants</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
