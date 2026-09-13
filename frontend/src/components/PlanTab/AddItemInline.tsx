import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, MapPin, Star } from 'lucide-react';
import { placesApi } from '../../lib/api';
import { imgUrl } from '../../lib/image';

interface AddItemInlineProps {
  day: number;
  city: string;
  onAdd: (placeName: string) => Promise<void>;
  onCancel: () => void;
}

interface SearchResult {
  placeId?: string;
  name: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  rating?: number;
  types?: string[];
  imageUrl?: string;
  photo_url?: string;
}

export function AddItemInline({ day, onAdd, onCancel }: AddItemInlineProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim() || value.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await placesApi.search(value.trim(), 6);
        setResults(res.data || []);
      } catch (err) {
        console.warn('[AddItemInline] Search failed:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const handleSelect = async (place: SearchResult) => {
    setAdding(true);
    try {
      await onAdd(place.name);
      onCancel();
    } catch (err) {
      console.error('[AddItemInline] Add failed:', err);
    } finally {
      setAdding(false);
    }
  };

  const handleFreeTextAdd = async () => {
    if (!query.trim()) return;
    setAdding(true);
    try {
      await onAdd(query.trim());
      onCancel();
    } catch (err) {
      console.error('[AddItemInline] Free text add failed:', err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg)]">
      <div className="flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length === 0) handleFreeTextAdd();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={`Search for a place to add to Day ${day}...`}
          className="flex-1 text-xs px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--muted)]"
          disabled={adding}
        />
        <button
          onClick={onCancel}
          className="p-1 rounded text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-1.5 py-2 text-xs text-[var(--muted)]">
          <Loader2 className="w-3 h-3 animate-spin" />
          Searching...
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
          {results.map((place, i) => (
            <button
              key={place.placeId || i}
              onClick={() => handleSelect(place)}
              disabled={adding}
              className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-[var(--surface)] rounded text-left transition-colors disabled:opacity-50"
            >
              {(place.imageUrl || place.photo_url) && (
                <img
                  src={imgUrl(place.imageUrl || place.photo_url)}
                  alt={place.name}
                  className="w-8 h-8 rounded object-cover shrink-0"
                  loading="lazy"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--ink)] truncate">{place.name}</p>
                {place.address && (
                  <p className="text-[10px] text-[var(--muted)] truncate flex items-center gap-0.5">
                    <MapPin className="w-2.5 h-2.5 shrink-0" />
                    {place.address}
                  </p>
                )}
              </div>
              {place.rating != null && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                  <span className="text-[10px] font-medium text-[var(--ink)]">{place.rating}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && query.trim().length >= 2 && (
        <button
          onClick={handleFreeTextAdd}
          disabled={adding}
          className="mt-1 w-full px-2 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] rounded text-left transition-colors"
        >
          {adding ? 'Adding...' : `Add "${query.trim()}" as a custom activity`}
        </button>
      )}

      {adding && (
        <div className="flex items-center gap-1.5 py-2 text-xs text-[var(--muted)]">
          <Loader2 className="w-3 h-3 animate-spin" />
          Adding to Day {day}...
        </div>
      )}
    </div>
  );
}
