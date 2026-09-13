import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { Compass, Plus } from 'lucide-react';
import { ChatPanel } from '../components/Chat/ChatPanel';
import { TripMap } from '../components/map/TripMap';
import { PlaceDetailPanel } from '../components/PlaceDetailPanel';
import { FlightDetailPanel } from '../components/FlightDetailPanel';
import { PlanTab } from '../components/PlanTab';
import { SavedTab } from '../components/SavedTab';
import { BookingsTab } from '../components/BookingsTab';
import type { FlightOption } from '../components/FlightCard';
import { useTripStore } from '../stores/tripStore';
import { useChatStore } from '../stores/chatStore';
import { useUIStore } from '../stores/uiStore';
import { chatApi } from '../lib/api';

export default function NewTripPage() {
  const [searchParams] = useSearchParams();
  const { conversationId: routeConvId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const initialQuery = searchParams.get('q') || '';
  const [localTripState, setLocalTripState] = useState<any>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<FlightOption | null>(null);
  const { createTrip, updateTrip, setTripState, connectSocket, disconnectSocket, fetchTrips } = useTripStore();
  const conversationId = useChatStore((s) => s.conversationId);
  const { activeTab, setActiveTab, cityFilter, setCityFilter } = useUIStore();
  const tripIdRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<any>(null);

  // Reset chat store on mount — this is a NEW trip, not a reopened one.
  // Clears any stale conversationId, pendingInterrupt, and messages from a
  // previous interrupted onboarding session.
  // Done synchronously (not in useEffect) so ChatPanel's mount effect sees
  // an empty store and starts fresh.
  const resetRef = useRef(false);
  if (!resetRef.current) {
    resetRef.current = true;
    useChatStore.getState().reset();
  }

  // Sidebar links land here with ?tab=bookings|saved — honor the requested tab.
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'bookings' || t === 'saved') setActiveTab(t);
  }, [searchParams, setActiveTab]);

  useEffect(() => {
    connectSocket();
    return () => { disconnectSocket(); };
  }, [connectSocket, disconnectSocket]);

  useEffect(() => {
    if (conversationId) {
      connectSocket(conversationId);
    }
  }, [conversationId, connectSocket]);

  // Resume an in-progress conversation (/chat/:conversationId) — restores
  // messages, pending question widgets, and trip state without requiring a
  // saved trip. Also adopts the saved trip's id when one is already linked,
  // so the next save updates it instead of creating a duplicate.
  useEffect(() => {
    if (!routeConvId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await chatApi.getHistory(routeConvId);
        const data = res.data || {};
        if (cancelled) return;
        const chat = useChatStore.getState();
        chat.setConversationId(routeConvId);
        // Set pendingWidget BEFORE setMessages — ChatPanel's restore effect
        // reads it imperatively when rebuilding entries.
        chat.setPendingWidget(data.pendingWidget || null);
        if (data.messages?.length) chat.setMessages(data.messages);
        if (data.tripState) {
          setTripState(data.tripState);
          setLocalTripState(data.tripState);
        }
        await fetchTrips();
        const linked = useTripStore.getState().trips.find(
          (t: any) => t.conversationId === routeConvId
        );
        if (linked) tripIdRef.current = linked.id;
      } catch (e) {
        console.error('Failed to resume conversation:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [routeConvId, fetchTrips, setTripState]);

  // Once a new conversation exists, pin its id in the URL so reloads reopen
  // the chat instead of resetting to a blank /new.
  useEffect(() => {
    if (conversationId && conversationId !== routeConvId) {
      navigate(`/chat/${conversationId}`, { replace: true });
    }
  }, [conversationId, routeConvId, navigate]);

  const handleTripStateUpdate = useCallback((tripState: any) => {
    setLocalTripState(tripState);
    setTripState(tripState);
    if (!tripState) return;

    const saveData = {
      generatedItinerary: tripState.itinerary,
      cities: (tripState.cities || []).map((c: any) => ({ name: c.name, days: c.nights ? c.nights + 1 : 1 })),
      totalDays: tripState.duration || tripState.itinerary?.days?.length,
      tripState,
    };

    (async () => {
      try {
        if (!tripIdRef.current) {
          if (tripState.cities?.length > 0 || tripState.itinerary) {
            const trip = await createTrip({ tripState });
            const newId = (trip as any)?.id || (trip as any)?._id;
            if (newId) tripIdRef.current = newId;
          }
        } else {
          pendingSaveRef.current = saveData;
          await updateTrip(String(tripIdRef.current), saveData);
          pendingSaveRef.current = null;
        }
      } catch (e) {
        console.error('Save failed:', e);
      }
    })();
  }, [createTrip, updateTrip, setTripState]);

  useEffect(() => {
    return () => {
      if (tripIdRef.current && pendingSaveRef.current) {
        updateTrip(String(tripIdRef.current), pendingSaveRef.current).catch(() => {});
      }
    };
  }, [updateTrip]);

  const destination = localTripState?.cities?.[0]?.name || null;
  const itinerary = localTripState?.itinerary || null;
  const cities = localTripState?.cities || [];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Chat panel - left 52% */}
      <div className="w-[52%] shrink-0 border-r border-[var(--border)] relative">
        <ChatPanel
          title="New trip"
          initialMessage={routeConvId ? '' : initialQuery}
          onTripStateUpdate={handleTripStateUpdate}
          onSelectPlace={setSelectedPlaceId}
        />
        {selectedPlaceId && (
          <PlaceDetailPanel
            placeId={selectedPlaceId}
            onClose={() => setSelectedPlaceId(null)}
            onSelectAlternate={(pid) => setSelectedPlaceId(pid)}
          />
        )}
        {selectedFlight && (
          <FlightDetailPanel
            flight={selectedFlight}
            onClose={() => setSelectedFlight(null)}
          />
        )}
      </div>

      {/* Right panel - map + workspace 48% */}
      <div className="flex-1 flex flex-col bg-[var(--bg)] min-w-0">
        {/* Map - top 40% */}
        <div className="h-[40%] shrink-0 border-b border-[var(--border)] relative bg-[var(--sage)]">
          <TripMap itinerary={itinerary} destination={destination} />
        </div>

        {/* Trip workspace - bottom 60% */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Tab strip */}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 shrink-0">
            <div className="flex">
              {(['plan', 'bookings', 'saved'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
                    activeTab === t
                      ? 'text-[var(--ink)] border-b-2 border-[var(--ink)]'
                      : 'text-[var(--muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  {t === 'plan' ? 'Trip Overview' : t}
                </button>
              ))}
            </div>
            {activeTab === 'plan' && (
              <button className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--muted)] hover:bg-[var(--sage)] hover:text-[var(--ink)] transition-colors">
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            )}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'plan' && (
              itinerary ? (
                <PlanTab
                  itinerary={itinerary}
                  cityFilter={cityFilter}
                  setCityFilter={setCityFilter}
                  cities={cities}
                  onSelectPlace={setSelectedPlaceId}
                  onSelectFlight={setSelectedFlight}
                  datesAssumed={localTripState?.dates?.assumed}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                  <div className="w-10 h-10 rounded-lg bg-[var(--sage)] flex items-center justify-center mb-3">
                    <Compass className="w-5 h-5 text-[var(--muted)]" />
                  </div>
                  <p className="text-sm text-[var(--muted)]">
                    Your itinerary will appear here as we plan
                  </p>
                </div>
              )
            )}
            {activeTab === 'bookings' && (
              <BookingsTab tripId={tripIdRef.current ? String(tripIdRef.current) : undefined} />
            )}
            {activeTab === 'saved' && <SavedTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
