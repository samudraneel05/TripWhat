import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, MapPin, Calendar, Clock, Trash2, MessageCircle } from 'lucide-react';
import { useTripStore } from '../stores/tripStore';
import { chatApi } from '../lib/api';

export default function TripsPage() {
  const { trips, loading, error, fetchTrips, deleteTrip } = useTripStore();
  const [tab, setTab] = useState<'all' | 'upcoming' | 'past'>('all');
  const [conversations, setConversations] = useState<any[]>([]);

  useEffect(() => {
    fetchTrips();
    chatApi.listConversations()
      .then((res) => setConversations(res.data?.conversations || []))
      .catch((err) => console.warn('[TripsPage] Failed to load conversations:', err));
  }, [fetchTrips]);

  const filtered = trips.filter((t) => {
    if (tab === 'all') return true;
    if (tab === 'upcoming') return t.isUpcoming;
    if (tab === 'past') return t.isCompleted;
    return true;
  });

  // Conversations not linked to a saved trip — chats still mid-planning that
  // would otherwise have no way back in.
  const linkedConvIds = new Set(trips.map((t) => t.conversationId).filter(Boolean));
  const inProgress = conversations.filter((c) => !linkedConvIds.has(c.conversationId));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-[var(--ink)] tracking-tight">
              Your trips
            </h1>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Plan, explore, and revisit your travel adventures
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

        <div className="flex gap-1.5 mb-6">
          {(['all', 'upcoming', 'past'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-[var(--lavender)] text-[var(--ink)]'
                  : 'text-[var(--muted)] hover:bg-[var(--sage)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {!loading && inProgress.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">
              In progress
            </h2>
            <div className="space-y-1.5">
              {inProgress.map((c) => (
                <Link
                  key={c.conversationId}
                  to={`/chat/${c.conversationId}`}
                  className="flex items-center gap-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3.5 py-2.5 hover:shadow-[var(--shadow-soft-hover)] transition-shadow"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
                  <span className="text-sm text-[var(--ink)] truncate flex-1">
                    {c.preview || 'Untitled conversation'}
                  </span>
                  {c.isActive && (
                    <span className="flex items-center gap-1.5 text-[10px] text-[var(--muted)] shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      generating
                    </span>
                  )}
                  {c.updatedAt && (
                    <span className="text-xs text-[var(--muted)] shrink-0">
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-16 text-sm text-[var(--muted)]">Loading trips...</div>
        )}

        {error && (
          <div className="text-center py-16 text-sm text-red-500">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-[var(--sage)] flex items-center justify-center">
              <MapPin className="w-6 h-6 text-[var(--muted)]" />
            </div>
            <p className="text-sm text-[var(--muted)] mb-4">
              No trips yet. Start planning your first adventure.
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

        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((trip) => (
              <TripCard key={trip.id} trip={trip} onDelete={deleteTrip} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TripCard({ trip, onDelete }: { trip: any; onDelete: (id: string) => void }) {
  const cities = trip.cities || trip.tripState?.cities || [];
  const cityNames = cities.map((c: any) => c.name).join(' → ');
  const startDate = trip.tripStartDate;
  const endDate = trip.tripEndDate;
  const duration = trip.totalDays || trip.tripState?.duration;
  const dayCount = trip.generatedItinerary?.days?.length || trip.tripState?.itinerary?.days?.length || 0;

  return (
    <Link
      to={`/trip/${trip.id}`}
      className="block rounded-lg bg-[var(--surface)] border border-[var(--border)] p-4 hover:shadow-[var(--shadow-soft-hover)] transition-shadow"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-[var(--muted)]" />
          <span className="text-sm font-medium text-[var(--ink)]">
            {cityNames || 'Untitled trip'}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.preventDefault();
            if (confirm('Delete this trip?')) onDelete(String(trip.id));
          }}
          className="text-[var(--muted)] hover:text-red-500 transition-colors p-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
        {startDate && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {startDate}{endDate ? ` → ${endDate}` : ''}
          </span>
        )}
        {duration && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {duration} days
          </span>
        )}
      </div>

      {dayCount > 0 && (
        <div className="mt-2 text-xs text-[var(--muted)]">
          {dayCount} days planned
        </div>
      )}
    </Link>
  );
}
