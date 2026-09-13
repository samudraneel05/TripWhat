import { useState } from 'react';
import { Star, Bookmark, ExternalLink, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { useSavedStore } from '../../../stores/savedStore';
import { ChatMarkdown } from '../../../lib/chatMarkdown';
import { imgUrl } from '../../../lib/image';

interface AttractionCard {
  name: string;
  imageUrl: string;
  type: string;
  placeId: string;
  rating?: number | null;
  description?: string;
}

interface HotelData {
  name: string;
  imageUrl: string;
  images?: string[];
  rating?: number | null;
  ratePerNight?: number | null;
  totalRate?: number | null;
  currency?: string;
  whyPicked?: string;
  bookingLink?: string;
  placeId?: string;
  address?: string;
}

interface ItinerarySummaryProps {
  data: {
    hotel: HotelData | null;
    attractions: AttractionCard[];
    destination: string;
    duration: number;
    dates: { start?: string; end?: string };
    preferences: string[];
    summary?: string;
    highlights?: string[];
  };
  onSelectPlace?: (placeId: string) => void;
}

function HotelCard({ hotel, onSelectPlace }: { hotel: HotelData; onSelectPlace?: (pid: string) => void }) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const { saveItem, isSaved } = useSavedStore();
  const saved = isSaved('hotel', hotel.name);

  const photos = (hotel.images?.length ? hotel.images : hotel.imageUrl ? [hotel.imageUrl] : [])
    .filter(Boolean)
    .slice(0, 5);

  return (
    <div className="rounded-xl overflow-hidden bg-[var(--surface)] border border-[var(--border)]">
      {/* Photo carousel with crossfade */}
      {photos.length > 0 && (
        <div className="relative h-44 overflow-hidden bg-[var(--sage)]">
          {photos.map((src, i) => (
            <img
              key={src}
              src={imgUrl(src)}
              alt={hotel.name}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              style={{
                opacity: i === photoIdx ? 1 : 0,
                filter: i === photoIdx ? 'none' : 'blur(2px)',
                transition: 'opacity 250ms var(--ease-out), filter 250ms var(--ease-out)',
                pointerEvents: i === photoIdx ? 'auto' : 'none',
              }}
            />
          ))}
          {photos.length > 1 && (
            <>
              {photoIdx > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setPhotoIdx((p) => p - 1); }}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 flex items-center justify-center hover:bg-black/60 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-white" />
                </button>
              )}
              {photoIdx < photos.length - 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setPhotoIdx((p) => p + 1); }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 flex items-center justify-center hover:bg-black/60 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-white" />
                </button>
              )}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {photos.map((_, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); setPhotoIdx(i); }}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === photoIdx ? 'bg-white' : 'bg-white/40'}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Info */}
      <div className="p-3">
        <h3
          className={`text-sm font-semibold text-[var(--ink)] leading-tight ${hotel.placeId ? 'cursor-pointer hover:underline' : ''}`}
          onClick={() => hotel.placeId && onSelectPlace?.(hotel.placeId)}
        >
          {hotel.name}
        </h3>

        <div className="flex items-center gap-1.5 mt-1">
          {hotel.rating && (
            <>
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
              <span className="text-xs font-medium text-[var(--ink)]">{hotel.rating}</span>
            </>
          )}
          {hotel.address && (
            <span className="text-[10px] text-[var(--muted)] flex items-center gap-0.5">
              <MapPin className="w-2.5 h-2.5" />
              {hotel.address.split(',').slice(0, 2).join(',')}
            </span>
          )}
        </div>

        {hotel.whyPicked && (
          <p className="text-[11px] text-[var(--muted)] mt-2 leading-relaxed">
            <span className="font-medium text-[var(--ink)]">Why we picked this: </span>
            {hotel.whyPicked}
          </p>
        )}

        <div className="flex items-center justify-between mt-2.5">
          <div>
            {hotel.ratePerNight != null && (
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-bold text-[var(--ink)]">
                  {hotel.currency === 'USD' ? '$' : hotel.currency || '$'}{Math.round(hotel.ratePerNight)}
                </span>
                <span className="text-[10px] text-[var(--muted)]">per night</span>
              </div>
            )}
            {hotel.totalRate != null && hotel.ratePerNight != null && (
              <span className="text-[10px] text-[var(--muted)]">
                Total: {hotel.currency === 'USD' ? '$' : hotel.currency || '$'}{Math.round(hotel.totalRate)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                saveItem('hotel', hotel.name, hotel);
              }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                saved
                  ? 'bg-[var(--sage)] text-[var(--ink)]'
                  : 'border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--sage)] hover:text-[var(--ink)]'
              }`}
            >
              <Bookmark className={`w-3 h-3 ${saved ? 'fill-current' : ''}`} />
              {saved ? 'Saved' : 'Save'}
            </button>
            {hotel.bookingLink && (
              <a
                href={hotel.bookingLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--ink)] text-white text-[10px] font-medium hover:bg-[#292524] transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Book
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ItinerarySummary({ data, onSelectPlace }: ItinerarySummaryProps) {
  const { hotel, attractions, destination, duration, preferences, summary, highlights } = data;

  // Top 2 attractions for the photo row
  const featuredAttractions = attractions.slice(0, 2);

  // Build a dynamic summary if not provided
  const summaryText = summary || buildDefaultSummary(destination, duration, attractions, preferences);
  const highlightsText = highlights?.length
    ? `Highlights include ${highlights.slice(0, 3).map((h, i) => `${i > 0 ? (i === highlights.length - 1 ? ', and ' : ', ') : ''}${h}`).join('')}.`
    : buildDefaultHighlights(attractions);

  return (
    <div
      className="mt-2 space-y-3"
      style={{ animation: 'widgetMount 0.4s ease-out forwards' }}
    >
      {/* Trip title */}
      <div className="px-1">
        <h2 className="text-base font-bold text-[var(--ink)]">
          {destination && duration ? `${destination} ${duration}-Day Trip` : destination || 'Your trip'}
        </h2>
      </div>

      {/* Hotel card */}
      {hotel && <HotelCard hotel={hotel} onSelectPlace={onSelectPlace} />}

      {/* Summary paragraph with highlighted place names */}
      <ChatMarkdown text={summaryText} places={attractions} onSelectPlace={onSelectPlace} className="text-xs text-[var(--muted)] leading-relaxed px-1" />

      {/* Featured attraction photos — simple image + name below, no overlay */}
      {featuredAttractions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 px-1">
          {featuredAttractions.map((a) => (
            <div key={a.name} className="group">
              <div
                className={`rounded-lg overflow-hidden bg-[var(--sage)] aspect-[4/3] ${a.placeId ? 'cursor-pointer' : ''}`}
                onClick={() => a.placeId && onSelectPlace?.(a.placeId)}
              >
                <img
                  src={imgUrl(a.imageUrl)}
                  alt={a.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-1 leading-tight">
                {a.name}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Highlights paragraph with highlighted names */}
      {highlightsText && (
        <ChatMarkdown text={highlightsText} places={attractions} onSelectPlace={onSelectPlace} className="text-xs text-[var(--muted)] leading-relaxed px-1" />
      )}

      {/* Refinement hint */}
      <p className="text-xs text-[var(--muted)] px-1 leading-relaxed">
        If you want, I can now refine the plan toward a specific style{preferences.length > 0 ? ` — ${preferences.join(', ')}` : ''}, or adjust the pace.
      </p>
    </div>
  );
}

function buildDefaultSummary(
  destination: string,
  duration: number,
  attractions: AttractionCard[],
  preferences: string[],
): string {
  const cities = destination ? [destination] : [];
  const stops = attractions.length;
  const style = preferences.length > 0 ? preferences.join(', ') : 'sightseeing';

  if (!destination) return `Your ${duration}-day trip plan is set.`;

  const topNames = attractions.slice(0, 3).map((a) => a.name);
  const nameList = topNames.length > 0
    ? `, centered on ${topNames.slice(0, 2).join(' and ')}${topNames.length > 2 ? `, plus ${topNames[2]}` : ''}`
    : '';

  return `Your ${duration}-day ${cities.join(' → ')} plan is set, with ${stops} stops arranged around ${style}${nameList}. Review it in your plan whenever you're ready.`;
}

function buildDefaultHighlights(attractions: AttractionCard[]): string {
  if (attractions.length === 0) return '';
  const names = attractions.slice(0, 4).map((a) => a.name);
  if (names.length <= 2) return `Highlights include ${names.join(' and ')}.`;
  return `Highlights include ${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}.`;
}
