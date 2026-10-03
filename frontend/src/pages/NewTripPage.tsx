import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { Compass, Plus, MessageSquare, Map } from 'lucide-react';
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

  // Reset chat store on mount — this is a NEW trip, not a reopened one.
  // Zustand mutations during render fire the "update while rendering" React
  // warning, so we reset in a first-run effect and gate the render below.
  const [storesReady, setStoresReady] = useState(false);
  useEffect(() => {
    if (!storesReady) {
      useChatStore.getState().reset();
      setStoresReady(true);
    }
  }, [storesReady]);

  const [localTripState, setLocalTripState] = useState<any>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<FlightOption | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const searchPlaces = useTripStore((s) => s.searchPlaces);
  // On phones the two panes can't fit side-by-side — toggle between them.
  const [mobileView, setMobileView] = useState<'chat' | 'plan'>('chat');
  const sawItineraryRef = useRef(false);
  const { createTrip, updateTrip, setTripState, connectSocket, fetchTrips } = useTripStore();
  const conversationId = useChatStore((s) => s.conversationId);
  const { activeTab, setActiveTab, cityFilter, setCityFilter } = useUIStore();
  const tripIdRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<any>(null);

  // Sidebar links land here with ?tab=bookings|saved — honor the requested tab.
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'bookings' || t === 'saved') setActiveTab(t);
  }, [searchParams, setActiveTab]);

  useEffect(() => {
    connectSocket();
  }, [connectSocket]);

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
        // Unconditional restores — empty data must clear, not keep, whatever
        // a previous conversation left in the store.
        chat.setMessages(data.messages || []);
        setTripState(data.tripState || null);
        setLocalTripState(data.tripState || null);
        await fetchTrips();
        const linked = useTripStore.getState().trips.find(
          (t: any) => t.conversationId === routeConvId
        );
        if (linked) {
          tripIdRef.current = linked.id;
          // Smart upgrade: a conversation that already produced a real
          // itinerary belongs in the trip workspace, not the bare chat view.
          const hasItinerary =
            (linked.generatedItinerary?.days?.length || 0) > 0 ||
            (linked.tripState?.itinerary?.days?.length || 0) > 0;
          if (hasItinerary) {
            navigate(`/trip/${linked.id}`, { replace: true });
            return;
          }
        }
      } catch (e) {
        console.error('Failed to resume conversation:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [routeConvId, fetchTrips, setTripState, navigate]);

  // Once a new conversation exists, pin its id in the URL so reloads reopen
  // the chat instead of resetting to a blank /new.
  useEffect(() => {
    // Read the live value — a render-time closure can hold a stale id set
    // between render and this effect's commit.
    const convId = useChatStore.getState().conversationId;
    if (convId && convId !== routeConvId) {
      navigate(`/chat/${convId}`, { replace: true });
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

  // Selecting a place (card, map pin, link) opens the detail panel and, when
  // we know its coordinates, flies the map to it. Search results carry coords;
  // itinerary places too — check both.
  const handleSelectPlace = useCallback((placeId: string) => {
    setSelectedPlaceId(placeId);
    if (window.matchMedia('(max-width: 767px)').matches) setMobileView('plan');
    const fromSearch = (useTripStore.getState().searchPlaces || []).find(
      (p) => p.placeId === placeId
    );
    const coords = fromSearch?.coordinates;
    if (coords && coords.lat != null && coords.lng != null) {
      setMapCenter({ lat: coords.lat, lng: coords.lng });
      return;
    }
    const itin = localTripState?.itinerary;
    if (!itin) return;
    for (const day of itin.days || []) {
      for (const slot of day.timeSlots || []) {
        for (const act of slot.activities || (slot.activity ? [slot.activity] : [])) {
          if (act.placeId === placeId && act.coordinates?.lat != null) {
            setMapCenter({ lat: act.coordinates.lat, lng: act.coordinates.lng });
            return;
          }
        }
      }
    }
    for (const list of [itin.hotelRecommendations, itin.restaurantRecommendations] as any[]) {
      for (const item of list || []) {
        if (item.placeId === placeId && item.coordinates?.lat != null) {
          setMapCenter({ lat: item.coordinates.lat, lng: item.coordinates.lng });
          return;
        }
      }
    }
  }, [localTripState]);

  // Place panel "ask" chips — route through the chat send path so the answer
  // lands in the conversation like any user message.
  const handleAskQuestion = useCallback((question: string) => {
    const convId = useChatStore.getState().conversationId;
    if (convId) chatApi.sendMessage({ message: question, conversationId: convId });
    if (window.matchMedia('(max-width: 767px)').matches) setMobileView('chat');
  }, []);

  // When the first itinerary lands, surface it on mobile once.
  useEffect(() => {
    if (itinerary && !sawItineraryRef.current) {
      sawItineraryRef.current = true;
      setMobileView('plan');
    }
  }, [itinerary]);

  if (!storesReady) {
    return <div className="h-[calc(100dvh-44px)] md:h-screen bg-[var(--bg)]" />;
  }

  return (
    <div className="flex flex-col md:flex-row h-[calc(100dvh-44px)] md:h-screen overflow-hidden">
      {/* Chat panel — left 52% on desktop, full-screen toggle on mobile */}
      <div className={`${mobileView === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 min-h-0 md:flex-none md:w-[52%] shrink-0 border-r border-[var(--border)] relative flex-col`}>
        <ChatPanel
          title="New trip"
          initialMessage={routeConvId ? '' : initialQuery}
          onTripStateUpdate={handleTripStateUpdate}
          onSelectPlace={handleSelectPlace}
        />
        {selectedFlight && (
          <FlightDetailPanel
            flight={selectedFlight}
            onClose={() => setSelectedFlight(null)}
          />
        )}
      </div>

      {/* Right panel - map + workspace; on mobile toggled via bottom bar */}
      <div className={`${mobileView === 'plan' ? 'flex' : 'hidden'} md:flex flex-1 flex-col bg-[var(--bg)] min-w-0 min-h-0 relative`}>
        {/* Map - top 40% */}
        <div className="h-[40%] shrink-0 border-b border-[var(--border)] relative bg-[var(--sage)]">
          <TripMap
            itinerary={itinerary}
            destination={destination}
            searchPlaces={searchPlaces}
            centerOnCoords={mapCenter}
            onSelectSearchPlace={handleSelectPlace}
          />
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
        {selectedPlaceId && (
          <PlaceDetailPanel
            placeId={selectedPlaceId}
            onClose={() => setSelectedPlaceId(null)}
            onSelectAlternate={(pid) => handleSelectPlace(pid)}
            onAskQuestion={conversationId ? handleAskQuestion : undefined}
          />
        )}
      </div>

      {/* Mobile Chat / Plan switcher */}
      <div className="md:hidden shrink-0 border-t border-[var(--border)] bg-[var(--surface)] flex">
        <button
          onClick={() => setMobileView('chat')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            mobileView === 'chat' ? 'text-[var(--ink)]' : 'text-[var(--muted)]'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          Chat
        </button>
        <button
          onClick={() => setMobileView('plan')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            mobileView === 'plan' ? 'text-[var(--ink)]' : 'text-[var(--muted)]'
          }`}
        >
          <Map className="w-4 h-4" />
          Trip plan
        </button>
      </div>
    </div>
  );
}
