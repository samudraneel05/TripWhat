import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, MapPin, Plus, Trash2 } from 'lucide-react';
import { useTripStore } from '../stores/tripStore';
import { chatApi } from '../lib/api';

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ChatsPage() {
  const { trips, fetchTrips } = useTripStore();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [res] = await Promise.all([chatApi.listConversations(), fetchTrips()]);
      setConversations(res.data?.conversations || []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tripByConv = new Map(
    trips.filter((t) => t.conversationId).map((t) => [t.conversationId, t])
  );

  const handleDelete = async (e: React.MouseEvent, convId: string) => {
    e.preventDefault();
    if (!confirm('Delete this conversation?')) return;
    try {
      await chatApi.deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.conversationId !== convId));
    } catch (err) {
      console.warn('[ChatsPage] delete failed:', err);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-[var(--ink)] tracking-tight">Chats</h1>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Every conversation — planning in progress, paused on a question, or done
            </p>
          </div>
          <Link
            to="/new"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--ink)] text-white text-xs font-medium hover:bg-[#292524] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New trip
          </Link>
        </div>

        {loading && (
          <div className="text-center py-16 text-sm text-[var(--muted)]">Loading chats...</div>
        )}

        {error && <div className="text-center py-16 text-sm text-red-500">{error}</div>}

        {!loading && !error && conversations.length === 0 && (
          <div className="text-center py-16">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-[var(--sage)] flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-[var(--muted)]" />
            </div>
            <p className="text-sm text-[var(--muted)] mb-4">
              No conversations yet — start planning and your chats will live here.
            </p>
            <Link
              to="/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--ink)] text-white text-xs font-medium hover:bg-[#292524] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Plan a trip
            </Link>
          </div>
        )}

        {!loading && !error && conversations.length > 0 && (
          <div className="space-y-1.5">
            {conversations.map((c) => {
              const linkedTrip = tripByConv.get(c.conversationId);
              return (
                <Link
                  key={c.conversationId}
                  to={`/chat/${c.conversationId}`}
                  className="group flex items-center gap-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 py-3 hover:shadow-[var(--shadow-soft-hover)] transition-shadow"
                >
                  <MessageCircle className="w-4 h-4 text-[var(--muted)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--ink)] truncate">
                      {c.preview || 'Untitled conversation'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {linkedTrip && (
                        <span className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                          <MapPin className="w-2.5 h-2.5" />
                          {(linkedTrip.cities || []).map((ct: any) => ct.name).join(' → ') || 'Saved trip'}
                        </span>
                      )}
                      {c.isActive && (
                        <span className="flex items-center gap-1 text-[10px] text-green-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          generating
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-[var(--muted)] shrink-0">{timeAgo(c.updatedAt)}</span>
                  <button
                    onClick={(e) => handleDelete(e, c.conversationId)}
                    className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-500 transition-all p-1 shrink-0"
                    title="Delete conversation"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
