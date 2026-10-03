import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, Plus, Check, X, ArrowRight, MessageSquare, Map } from 'lucide-react';
import { ChatPanel } from '../components/Chat/ChatPanel';
import { TripMap } from '../components/map/TripMap';
import { PlaceDetailPanel } from '../components/PlaceDetailPanel';
import { FlightDetailPanel } from '../components/FlightDetailPanel';
import { PlanTab } from '../components/PlanTab';
import { SavedTab } from '../components/SavedTab';
import type { FlightOption } from '../components/FlightCard';
import { useTripStore } from '../stores/tripStore';
import { useChatStore, serializeMessages } from '../stores/chatStore';
import { chatApi } from '../lib/api';
import { useUIStore } from '../stores/uiStore';
import { BookingsTab } from '../components/BookingsTab';

export default function TripWorkspacePage() {
  const { id } = useParams<{ id: string }>();

  // Fresh instance per trip (keyed route in App.jsx) — clear chat + trip
  // view state on mount so the previously viewed conversation/trip can't
  // bleed into this one while fetchTrip loads. Zustand mutations during
  // render fire the "update while rendering" warning, so reset happens in
  // a first-run effect and the render is gated on it below.
  const [storesReady, setStoresReady] = useState(false);
  useEffect(() => {
    if (!storesReady) {
      useChatStore.getState().reset();
      useTripStore.setState({ tripState: null, pendingDiff: null, progressiveDays: null });
      setStoresReady(true);
    }
  }, [storesReady]);

  const { tripState, fetchTrip, connectSocket, setTripState, updateTrip, pendingDiff, acceptDiff, rejectDiff } = useTripStore();
  const conversationId = useChatStore((s) => s.conversationId);
  const { activeTab, setActiveTab, cityFilter, setCityFilter } = useUIStore();
  const [tripLoading, setTripLoading] = useState(true);
  const [tripError, setTripError] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<FlightOption | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const searchPlaces = useTripStore((s) => s.searchPlaces);
  const pendingSaveRef = useRef<any>(null);
  // On phones the two panes can't fit side-by-side — toggle between them.
  const [mobileView, setMobileView] = useState<'chat' | 'plan'>('plan');

  // Find a place in the itinerary by placeId to get its coordinates
  const findPlaceInItinerary = (itinerary: any, placeId: string): any | null => {
    if (!itinerary?.days) return null;
    for (const day of itinerary.days) {
      for (const slot of day.timeSlots || []) {
        const activities = slot.activities || (slot.activity ? [slot.activity] : []);
        for (const act of activities) {
          if (act.placeId === placeId) return act;
        }
      }
    }
    // Also check hotel/restaurant recommendations
    for (const hotel of itinerary.hotelRecommendations || []) {
      if (hotel.placeId === placeId) return hotel;
    }
    for (const rest of itinerary.restaurantRecommendations || []) {
      if (rest.placeId === placeId) return rest;
    }
    return null;
  };

  // Handle place selection — opens detail panel AND centers map
  const handleSelectPlace = (placeId: string) => {
    setSelectedPlaceId(placeId);
    // On mobile the panel covers the right column — switch to it.
    if (window.matchMedia('(max-width: 767px)').matches) setMobileView('plan');
    const found = findPlaceInItinerary(tripState?.itinerary, placeId) ||
      (searchPlaces || []).find((p) => p.placeId === placeId);
    if (found?.coordinates && found.coordinates.lat && found.coordinates.lng) {
      setMapCenter({ lat: found.coordinates.lat, lng: found.coordinates.lng });
    }
  };

  const handleAskQuestion = (question: string) => {
    const convId = useChatStore.getState().conversationId;
    if (convId) chatApi.sendMessage({ message: question, conversationId: convId });
    if (window.matchMedia('(max-width: 767px)').matches) setMobileView('chat');
  };

  useEffect(() => {
    if (id) {
      setTripLoading(true);
      setTripError(null);
      fetchTrip(id).catch((err) => setTripError(err?.message || 'Failed to load trip')).finally(() => setTripLoading(false));
    }
    connectSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (conversationId) {
      connectSocket(conversationId);
    }
  }, [conversationId, connectSocket]);

  useEffect(() => {
    return () => {
      if (id && pendingSaveRef.current) {
        updateTrip(id, pendingSaveRef.current).catch(() => {});
      }
    };
  }, [id, updateTrip]);

  const handleTripStateUpdate = useCallback((newTripState: any) => {
    setTripState(newTripState);
    if (!newTripState || !id) return;

    const { conversationId, messages } = useChatStore.getState();
    const saveData = {
      generatedItinerary: newTripState.itinerary,
      cities: (newTripState.cities || []).map((c: any) => ({ name: c.name, days: c.nights ? c.nights + 1 : 1 })),
      totalDays: newTripState.duration || newTripState.itinerary?.days?.length,
      tripState: newTripState,
      conversationId: conversationId || undefined,
      chatHistory: messages?.length ? serializeMessages(messages) : undefined,
    };

    pendingSaveRef.current = saveData;
    (async () => {
      try {
        await updateTrip(id, saveData);
        pendingSaveRef.current = null;
      } catch (e) {
        console.error('Save failed:', e);
      }
    })();
  }, [id, setTripState, updateTrip]);

  const cities = tripState?.cities || [];
  const itinerary = tripState?.itinerary;
  const tripTitle = cities.map((c) => c.name).join(' → ') || 'Untitled trip';

  if (!storesReady) {
    return <div className="h-[calc(100dvh-44px)] md:h-screen bg-[var(--bg)]" />;
  }

  return (
    <div className="flex flex-col md:flex-row h-[calc(100dvh-44px)] md:h-screen overflow-hidden">
      {/* Chat panel — left 52% on desktop, full-screen toggle on mobile */}
      <div className={`${mobileView === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 min-h-0 md:flex-none md:w-[52%] shrink-0 border-r border-[var(--border)] relative flex-col`}>
        <ChatPanel
          title={tripTitle}
          tripState={tripState || undefined}
          onTripStateUpdate={handleTripStateUpdate}
          onSelectPlace={handleSelectPlace}
          onSelectFlight={setSelectedFlight}
        />
        {selectedFlight && (
          <FlightDetailPanel
            flight={selectedFlight}
            onClose={() => setSelectedFlight(null)}
          />
        )}
      </div>

      {/* Right panel - map + itinerary; on mobile toggled via bottom bar */}
      <div className={`${mobileView === 'plan' ? 'flex' : 'hidden'} md:flex flex-1 flex-col bg-[var(--bg)] min-w-0 min-h-0 relative`}>
        {tripError ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-red-600">{tripError}</p>
          </div>
        ) : tripLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse text-sm text-[var(--muted)]">Loading trip...</div>
          </div>
        ) : (
          <>
            {/* Map - top 40% */}
            <div className="h-[40%] shrink-0 border-b border-[var(--border)] relative bg-[var(--sage)]">
              {itinerary || (searchPlaces && searchPlaces.length > 0) ? (
                <TripMap
                  itinerary={itinerary}
                  selectedCity={cityFilter}
                  destination={cities[0]?.name}
                  centerOnCoords={mapCenter}
                  searchPlaces={searchPlaces}
                  onSelectSearchPlace={handleSelectPlace}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <MapPin className="w-8 h-8 text-[var(--muted)] mx-auto mb-2 opacity-40" />
                    <p className="text-[var(--muted)] text-xs">Map will appear here</p>
                  </div>
                </div>
              )}
            </div>

            {/* Tabs + content - bottom 60% */}
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
              <div className="flex-1 overflow-y-auto relative">
                {pendingDiff && (
                  <DiffOverlay
                    changeSummary={pendingDiff.changeSummary}
                    onAccept={acceptDiff}
                    onReject={rejectDiff}
                  />
                )}
                {activeTab === 'plan' && (
                  <PlanTab
                    itinerary={itinerary}
                    cityFilter={cityFilter}
                    setCityFilter={setCityFilter}
                    cities={cities}
                    onSelectPlace={handleSelectPlace}
                    onSelectFlight={setSelectedFlight}
                    datesAssumed={tripState?.dates?.assumed}
                    conversationId={conversationId || undefined}
                  />
                )}
                {activeTab === 'bookings' && <BookingsTab tripId={id} />}
                {activeTab === 'saved' && <SavedTab />}
              </div>
            </div>
          </>
        )}
        {selectedPlaceId && (
          <PlaceDetailPanel
            placeId={selectedPlaceId}
            onClose={() => setSelectedPlaceId(null)}
            onSelectAlternate={(pid) => handleSelectPlace(pid)}
            onAskQuestion={handleAskQuestion}
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

function DiffOverlay({ changeSummary, onAccept, onReject }: any) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const ACTION_ICONS: Record<string, any> = {
    add: Plus,
    remove: X,
    replace: ArrowRight,
    move: ArrowRight,
  };
  const ACTION_COLORS: Record<string, string> = {
    add: 'text-green-600',
    remove: 'text-red-500',
    replace: 'text-amber-600',
    move: 'text-blue-500',
  };

  return (
    <div
      className="sticky top-0 z-20 bg-[var(--surface)] border-b border-[var(--border)] shadow-sm"
      style={{
        transform: mounted ? 'translateY(0)' : 'translateY(-100%)',
        opacity: mounted ? 1 : 0,
        transition: 'transform 200ms var(--ease-out), opacity 200ms var(--ease-out)',
      }}
    >
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[var(--ink)]">Proposed changes</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onReject}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-[var(--muted)] border border-[var(--border)] hover:bg-[var(--sage)] transition-colors"
            >
              <X className="w-3 h-3" />
              Reject
            </button>
            <button
              onClick={onAccept}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-white bg-[var(--ink)] hover:bg-[#292524] transition-colors"
            >
              <Check className="w-3 h-3" />
              Accept
            </button>
          </div>
        </div>
        <div className="space-y-1">
          {changeSummary.map((change: any, i: number) => {
            const Icon = ACTION_ICONS[change.action] || Plus;
            const color = ACTION_COLORS[change.action] || 'text-[var(--muted)]';
            const label = change.action === 'add'
              ? `Add ${change.target || change.added?.join(', ') || 'item'}`
              : change.action === 'remove'
              ? `Remove ${change.target || change.removed?.join(', ') || 'item'}`
              : change.action === 'replace'
              ? `Replace with ${change.target}`
              : change.action === 'move'
              ? `Move ${change.target}`
              : `${change.action}: ${change.target || ''}`;
            return (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <Icon className={`w-3 h-3 ${color} shrink-0`} />
                <span className="text-[var(--ink)]">{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

