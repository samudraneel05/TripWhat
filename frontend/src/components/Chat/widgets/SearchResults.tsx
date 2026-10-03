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

      {/* Postcard strip — horizontal snap-scroll; card numbers match the
          map's search pins. Fixed width keeps ~2.5 cards visible as the
          scroll affordance. */}
      {places.length > 0 && (
        <div className="flex gap-2.5 overflow-x-auto pb-1.5 -mx-1 px-1 snap-x snap-mandatory
                        [&::-webkit-scrollbar]:h-1
                        [&::-webkit-scrollbar-thumb]:bg-[var(--border)]
                        [&::-webkit-scrollbar-thumb]:rounded-full
                        [&::-webkit-scrollbar-track]:bg-transparent">
          {places.map((p, i) => (
            <button
              key={p.placeId || i}
              onClick={() => p.placeId && onSelectPlace?.(p.placeId)}
              className="group shrink-0 w-[228px] snap-start text-left rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--surface)] transition-shadow duration-200 hover:shadow-md active:scale-[0.98] active:transition-transform"
            >
              <div className="relative aspect-[3/2] bg-[var(--sage)]">
                {p.imageUrl ? (
                  <img
                    src={imgUrl(p.imageUrl)}
                    alt={p.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-3xl font-semibold text-[var(--muted)] opacity-50">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                {/* postcard caption: name over a soft gradient at the image foot */}
                <div className="absolute inset-x-0 bottom-0 pt-8 pb-2 px-2.5 bg-gradient-to-t from-black/60 to-transparent">
                  <p className="text-[13px] font-medium text-white leading-tight truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
                    {p.name}
                  </p>
                </div>
                <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-[#0D9488] text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {i + 1}
                </span>
              </div>
              <div className="px-2.5 py-1.5 flex items-center gap-1 text-[10px] text-[var(--muted)] leading-tight">
                {p.rating != null && (
                  <span className="text-[var(--ink)] shrink-0">★ {p.rating}</span>
                )}
                {p.rating != null && (p.type || p.address) && <span>·</span>}
                {p.type && <span className="truncate">{p.type}</span>}
                {p.type && p.address && <span>·</span>}
                {p.address && (
                  <span className="truncate flex items-center gap-0.5">
                    <MapPin className="w-2.5 h-2.5 shrink-0" />
                    {p.address}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
