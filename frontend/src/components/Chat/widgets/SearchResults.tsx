import { MapPin } from 'lucide-react';
import { ChatMarkdown, type PlaceRef } from '../../../lib/chatMarkdown';
import { imgUrl } from '../../../lib/image';

interface SearchResultPlace {
  name: string;
  placeId: string;
  imageUrl: string;
  rating?: number | null;
  type?: string;
  address?: string;
  coordinates?: { lat: number; lng: number } | null;
}

interface SearchResultsProps {
  data: { places: SearchResultPlace[] };
  text: string;
  onSelectPlace?: (placeId: string) => void;
}

export function SearchResults({ data, text, onSelectPlace }: SearchResultsProps) {
  const { places } = data;
  const refs: PlaceRef[] = places.map((p) => ({ name: p.name, placeId: p.placeId }));

  return (
    <div
      className="mt-2 mb-3 space-y-3"
      style={{ animation: 'widgetMount 0.4s ease-out forwards' }}
    >
      {/* Assistant text with markdown + clickable place names */}
      <ChatMarkdown
        text={text}
        places={refs}
        onSelectPlace={onSelectPlace}
        className="text-sm text-[var(--ink)] leading-relaxed space-y-1.5"
      />

      {/* Postcard grid — card numbers match the map's search pins */}
      {places.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {places.map((p, i) => (
            <button
              key={p.placeId || i}
              onClick={() => p.placeId && onSelectPlace?.(p.placeId)}
              className="group text-left rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface)] transition-shadow duration-200 hover:shadow-md active:scale-[0.98] active:transition-transform"
            >
              <div className="relative aspect-[4/3] bg-[var(--sage)]">
                {p.imageUrl ? (
                  <img
                    src={imgUrl(p.imageUrl)}
                    alt={p.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-2xl font-semibold text-[var(--muted)] opacity-50">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-[#0D9488] text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {i + 1}
                </span>
              </div>
              <div className="px-2.5 py-2">
                <div className="flex items-center justify-between gap-1.5">
                  <p className="text-xs font-medium text-[var(--ink)] leading-tight truncate">
                    {p.name}
                  </p>
                  {p.rating != null && (
                    <span className="text-[10px] text-[var(--muted)] shrink-0">★ {p.rating}</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--muted)] leading-tight">
                  {p.type && <span className="truncate">{p.type}</span>}
                  {p.type && p.address && <span>·</span>}
                  {p.address && (
                    <span className="truncate flex items-center gap-0.5">
                      <MapPin className="w-2.5 h-2.5 shrink-0" />
                      {p.address}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
