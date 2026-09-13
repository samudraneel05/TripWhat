/**
 * Image proxy + prefetch helpers.
 *
 * Routes external image URLs (Google CDN, etc.) through the backend image
 * proxy, which caches blobs in DB with TTL eviction and serves them with
 * immutable Cache-Control headers. This solves Google CDN URL expiry and
 * gives us a stable, cacheable URL.
 */

// Route through the configured API origin when VITE_API_URL is set, matching
// src/lib/api.ts — a bare '/api/image' would bypass it and hit whatever the
// Vite dev proxy points at instead.
const API_BASE = import.meta.env.VITE_API_URL || '';
const PROXY = `${API_BASE}/api/image`;

/**
 * Wrap an external image URL so it goes through the backend image proxy.
 * Returns the original URL for non-http URLs (e.g. data URIs, empty strings).
 */
export function imgUrl(url?: string | null): string {
  if (!url) return '';
  if (!url.startsWith('http')) return url;
  return `${PROXY}?url=${encodeURIComponent(url)}`;
}

/**
 * Prefetch a list of image URLs through the proxy in the background.
 * Fires fetch() calls without awaiting — warms the DB + browser cache
 * before the user scrolls to the images.
 */
export function prefetchImages(urls: (string | null | undefined)[]): void {
  for (const url of urls) {
    if (!url || !url.startsWith('http')) continue;
    // Use no-cors + keepalive so the request doesn't block and survives navigation
    fetch(imgUrl(url), { mode: 'no-cors', keepalive: true }).catch(() => {});
  }
}

/**
 * Extract all image URLs from a trip state / itinerary object.
 */
export function extractImageUrls(tripState: any): string[] {
  if (!tripState?.itinerary) return [];
  const urls: string[] = [];
  const it = tripState.itinerary;

  for (const day of it.days || []) {
    for (const slot of day.timeSlots || []) {
      const act = slot.activity;
      if (act?.imageUrl) urls.push(act.imageUrl);
      if (act?.photos) urls.push(...act.photos.filter((p: string) => p?.startsWith('http')));
    }
  }

  for (const hotel of it.hotelRecommendations || []) {
    if (hotel.imageUrl) urls.push(hotel.imageUrl);
    if (hotel.images) urls.push(...hotel.images.filter((p: string) => p?.startsWith('http')));
  }

  for (const rest of it.restaurantRecommendations || []) {
    if (rest.imageUrl) urls.push(rest.imageUrl);
  }

  return [...new Set(urls)];
}
