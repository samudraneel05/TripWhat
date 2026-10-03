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
  /** Card hover → the map lifts this place's pin (card↔pin correlation). */
  onHoverPlace?: (placeId: string | null) => void;
}

export function SearchResults({ data, text, onSelectPlace, onHoverPlace }: SearchResultsProps) {
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

      {/* Postcard strip — horizontal snap-scroll; hovering a card lifts
          its map pin. Fixed width keeps ~2.5 cards visible as the scroll
          affordance. */}
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
              onMouseEnter={() => p.placeId && onHoverPlace?.(p.placeId)}
              onMouseLeave={() => onHoverPlace?.(null)}
              className={`group shrink-0 w-[188px] snap-start bg-white rounded-[3px]
                          shadow-[0_2px_10px_rgba(0,0,0,0.14),0_1px_2px_rgba(0,0,0,0.08)]
                          p-2 pb-0 transition-transform duration-200
                          ${i % 2 === 0 ? '-rotate-[0.8deg]' : 'rotate-[0.8deg]'}
                          hover:rotate-0 hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(0,0,0,0.16)]
                          active:scale-[0.98]`}
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-[var(--sage)] rounded-[2px]">
                {p.imageUrl ? (
                  <img
                    src={imgUrl(p.imageUrl)}
                    alt={p.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-3xl font-semibold text-[var(--muted)] opacity-50">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              {/* Polaroid bottom band — just the name, typewriter feel */}
              <div className="pt-3 pb-2.5 text-center">
                <span className="font-mono text-[12.5px] text-neutral-700 leading-tight line-clamp-1">
                  {p.name}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
