import { ChatMarkdown, type PlaceRef } from '../../../lib/chatMarkdown';
import { imgUrl } from '../../../lib/image';

export interface SearchResultPlace {
  name: string;
  placeId: string;
  imageUrl: string;
  rating?: number | null;
  type?: string;
  address?: string;
}

interface SearchResultsProps {
  data: { places: SearchResultPlace[] };
  text: string;
  onSelectPlace?: (placeId: string) => void;
}

export function SearchResults({ data, text, onSelectPlace }: SearchResultsProps) {
  const { places } = data;
  const refs: PlaceRef[] = places.map((p) => ({ name: p.name, placeId: p.placeId }));
  const photoPlaces = places.filter((p) => p.imageUrl).slice(0, 4);

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

      {/* Photo grid */}
      {photoPlaces.length > 0 && (
        <div className={`grid gap-2 ${photoPlaces.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {photoPlaces.map((p) => (
            <div key={p.placeId} className="group">
              <div
                className={`rounded-lg overflow-hidden bg-[var(--sage)] aspect-[4/3] ${p.placeId ? 'cursor-pointer' : ''}`}
                onClick={() => p.placeId && onSelectPlace?.(p.placeId)}
              >
                <img
                  src={imgUrl(p.imageUrl)}
                  alt={p.name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
              </div>
              <div className="mt-1 flex items-center justify-between gap-1">
                <p className="text-[11px] font-medium text-[var(--ink)] leading-tight truncate">
                  {p.name}
                </p>
                {p.rating != null && (
                  <span className="text-[10px] text-[var(--muted)] shrink-0">
                    ★ {p.rating}
                  </span>
                )}
              </div>
              {p.type && (
                <p className="text-[10px] text-[var(--muted)] leading-tight truncate">{p.type}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
