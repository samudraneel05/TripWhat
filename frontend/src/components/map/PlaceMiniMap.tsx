import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface PlaceMiniMapProps {
  coordinates: { lat: number; lng: number };
  name: string;
}

// Small read-only-ish map for the place panel's Location section.
export function PlaceMiniMap({ coordinates, name }: PlaceMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token || !containerRef.current) return;
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [coordinates.lng, coordinates.lat],
      zoom: 14,
      scrollZoom: false,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    map.on('load', () => {
      const el = document.createElement('div');
      el.style.cssText =
        'width:22px;height:22px;border-radius:50%;background:#0D9488;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.25);';
      new mapboxgl.Marker(el).setLngLat([coordinates.lng, coordinates.lat]).addTo(map);
    });
    return () => map.remove();
  }, [coordinates.lat, coordinates.lng, name]);

  return <div ref={containerRef} className="w-full h-44 rounded-lg overflow-hidden" />;
}
