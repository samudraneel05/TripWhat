import { useEffect, useRef, useState } from 'react';
import { Hotel, Plane, MapPin, Utensils, Trash2, ExternalLink, Star, Link2, Loader2 } from 'lucide-react';
import { useSavedStore } from '../stores/savedStore';
import { useTripStore } from '../stores/tripStore';
import { savedApi } from '../lib/api';
import { imgUrl } from '../lib/image';

const TYPE_ICONS: Record<string, any> = {
  hotel: Hotel,
  flight: Plane,
  place: MapPin,
  restaurant: Utensils,
};

export function SavedTab() {
  const { items, fetchItems, removeItem, loading } = useSavedStore();
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchItems();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [fetchItems]);

  // Listen for the async import result on the shared socket.
  useEffect(() => {
    const socket = useTripStore.getState().socket;
    if (!socket) return;
    const onImported = (data: { count: number; names: string[]; errors: string[] }) => {
      if (!importing) return;
      setImporting(false);
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      fetchItems();
      setImportMsg(
        data.count > 0
          ? `Imported ${data.count} place${data.count === 1 ? '' : 's'}: ${data.names.slice(0, 3).join(', ')}${data.names.length > 3 ? '…' : ''}`
          : 'No places could be extracted from that link.'
      );
    };
    socket.on('saved:imported', onImported);
    return () => { socket.off('saved:imported', onImported); };
  }, [importing, fetchItems]);

  const handleImport = async () => {
    const url = importUrl.trim();
    if (!url || importing) return;
    setImportMsg(null);
    try {
      await savedApi.importLink(url);
      setImporting(true);
      setImportMsg('Extracting places from the link…');
      const before = items.length;
      // Fallback: poll in case the socket event isn't wired to this page.
      pollRef.current = setInterval(async () => {
        await fetchItems();
        if (useSavedStore.getState().items.length > before) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setImporting(false);
          setImportMsg('Places imported.');
        }
      }, 4000);
      timeoutRef.current = setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        setImporting(false);
        setImportMsg('Import is still running — check back shortly.');
      }, 90000);
    } catch (e: any) {
      setImportMsg(e?.response?.data?.detail || 'Could not start import.');
    }
  };

  const importBar = (
    <div className="px-4 pt-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)]" />
          <input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleImport()}
            placeholder="Paste an IG reel / TikTok / YouTube link"
            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]"
          />
        </div>
        <button
          onClick={handleImport}
          disabled={importing || !importUrl.trim()}
          className="px-3 py-2 rounded-lg bg-[var(--ink)] text-white text-xs font-medium disabled:opacity-50 hover:bg-[#292524] transition-colors shrink-0"
        >
          {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Import'}
        </button>
      </div>
      {importMsg && (
        <p className={`text-[10px] mt-1.5 ${importing ? 'text-[var(--muted)]' : 'text-[var(--ink)]'}`}>
          {importMsg}
        </p>
      )}
    </div>
  );

  if (loading && items.length === 0) {
    return (
      <div>
        {importBar}
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-[var(--muted)]">Loading saved items...</p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        {importBar}
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-10 h-10 rounded-lg bg-[var(--sage)] flex items-center justify-center mb-3">
            <MapPin className="w-5 h-5 text-[var(--muted)]" />
          </div>
          <p className="text-sm text-[var(--muted)]">
            Save hotels, flights, and places by tapping the bookmark icon.
          </p>
        </div>
      </div>
    );
  }

  // Group by type
  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    if (!grouped[item.itemType]) grouped[item.itemType] = [];
    grouped[item.itemType].push(item);
  }

  const typeLabels: Record<string, string> = {
    hotel: 'Hotels',
    flight: 'Flights',
    place: 'Places',
    restaurant: 'Restaurants',
  };

  return (
    <div>
      {importBar}
      <div className="p-4 pt-2 space-y-6">
      {Object.entries(grouped).map(([type, typeItems]) => {
        const Icon = TYPE_ICONS[type] || MapPin;
        return (
          <div key={type}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-[var(--muted)]" />
              <span className="text-xs font-semibold text-[var(--ink)]">{typeLabels[type] || type}</span>
              <span className="text-[10px] text-[var(--muted)]">({typeItems.length})</span>
            </div>
            <div className="space-y-2">
              {typeItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]"
                >
                  {item.data?.imageUrl && (
                    <img
                      src={imgUrl(item.data.imageUrl)}
                      alt={item.name}
                      className="w-12 h-12 rounded-md object-cover shrink-0"
                      loading="lazy"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--ink)] truncate">{item.name}</p>
                    {item.data?.address && (
                      <p className="text-[10px] text-[var(--muted)] truncate mt-0.5">{item.data.address}</p>
                    )}
                    {item.data?.ratePerNight != null && (
                      <p className="text-[10px] text-[var(--ink)] mt-0.5">
                        {item.data.currency || '$'}{item.data.ratePerNight.toLocaleString()}/night
                      </p>
                    )}
                    {item.data?.price != null && (
                      <p className="text-[10px] text-[var(--ink)] mt-0.5">
                        {item.data.currency || '$'}{item.data.price.toLocaleString()}
                      </p>
                    )}
                    {item.data?.rating != null && (
                      <div className="flex items-center gap-0.5 mt-0.5">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        <span className="text-[10px] text-[var(--ink)]">{item.data.rating}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {item.data?.bookingLink && (
                      <a
                        href={item.data.bookingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 rounded-md bg-[var(--ink)] text-white text-[10px] font-medium hover:bg-[#292524] transition-colors"
                      >
                        Book
                      </a>
                    )}
                    {item.data?.website && !item.data?.bookingLink && (
                      <a
                        href={item.data.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded hover:bg-[var(--sage)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      onClick={() => removeItem(item.id)}
                      className="p-1 rounded hover:bg-[var(--sage)] text-[var(--muted)] hover:text-red-500 transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
