import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, Plus, Mail, Package, RefreshCw, CheckCircle2, Check, X, ArrowRight, Plane, Hotel, Utensils, Unplug, Download } from 'lucide-react';
import { ChatPanel } from '../components/Chat/ChatPanel';
import { TripMap } from '../components/map/TripMap';
import { PlaceDetailPanel } from '../components/PlaceDetailPanel';
import { FlightDetailPanel } from '../components/FlightDetailPanel';
import { PlanTab } from '../components/PlanTab';
import { SavedTab } from '../components/SavedTab';
import type { FlightOption } from '../components/FlightCard';
import { useTripStore } from '../stores/tripStore';
import { useChatStore, serializeMessages } from '../stores/chatStore';
import { useUIStore } from '../stores/uiStore';
import { gmailApi } from '../lib/api';

export default function TripWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { tripState, fetchTrip, connectSocket, disconnectSocket, setTripState, updateTrip, pendingDiff, acceptDiff, rejectDiff } = useTripStore();
  const conversationId = useChatStore((s) => s.conversationId);
  const { activeTab, setActiveTab, cityFilter, setCityFilter } = useUIStore();
  const [tripLoading, setTripLoading] = useState(true);
  const [tripError, setTripError] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<FlightOption | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const pendingSaveRef = useRef<any>(null);

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
    const itinerary = tripState?.itinerary;
    const found = findPlaceInItinerary(itinerary, placeId);
    if (found?.coordinates && found.coordinates.lat && found.coordinates.lng) {
      setMapCenter({ lat: found.coordinates.lat, lng: found.coordinates.lng });
    }
  };

  useEffect(() => {
    if (id) {
      setTripLoading(true);
      setTripError(null);
      fetchTrip(id).catch((err) => setTripError(err?.message || 'Failed to load trip')).finally(() => setTripLoading(false));
    }
    connectSocket();
    return () => { disconnectSocket(); };
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

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Chat panel - left 52% */}
      <div className="w-[52%] shrink-0 border-r border-[var(--border)] relative">
        <ChatPanel
          title={tripTitle}
          tripState={tripState || undefined}
          onTripStateUpdate={handleTripStateUpdate}
          onSelectPlace={handleSelectPlace}
          onSelectFlight={setSelectedFlight}
        />
        {selectedPlaceId && (
          <PlaceDetailPanel
            placeId={selectedPlaceId}
            onClose={() => setSelectedPlaceId(null)}
            onSelectAlternate={(pid) => handleSelectPlace(pid)}
          />
        )}
        {selectedFlight && (
          <FlightDetailPanel
            flight={selectedFlight}
            onClose={() => setSelectedFlight(null)}
          />
        )}
      </div>

      {/* Right panel - map + itinerary */}
      <div className="flex-1 flex flex-col bg-[var(--bg)] min-w-0">
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
              {itinerary ? (
                <TripMap itinerary={itinerary} selectedCity={cityFilter} destination={cities[0]?.name} centerOnCoords={mapCenter} />
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

function BookingDetail({ booking }: { booking: any }) {
  const d = booking.details;
  if (!d) return null;

  if (d.kind === 'flight') {
    const dep = d.departureAirport || {};
    const arr = d.arrivalAirport || {};
    const route = [dep.iata || dep.name, arr.iata || arr.name].filter(Boolean).join(' → ');
    const segments = d.segments?.length || 0;
    return (
      <div className="mt-1 space-y-0.5">
        {(d.airline || d.flightNumber) && (
          <p className="text-[10px] text-[var(--ink)] font-medium">
            {[d.airline, d.flightNumber].filter(Boolean).join(' ')}
          </p>
        )}
        {route && (
          <p className="text-[10px] text-[var(--muted)]">
            {route}{segments > 1 ? ` · ${segments} legs` : ''}
          </p>
        )}
        {(d.departureTime || d.arrivalTime) && (
          <p className="text-[10px] text-[var(--muted)]">
            {d.departureTime ? `Departs ${formatBookingTime(d.departureTime)}` : ''}
            {d.departureTime && d.arrivalTime ? ' · ' : ''}
            {d.arrivalTime ? `Arrives ${formatBookingTime(d.arrivalTime)}` : ''}
          </p>
        )}
      </div>
    );
  }

  if (d.kind === 'hotel') {
    return (
      <div className="mt-1 space-y-0.5">
        {d.hotelName && <p className="text-[10px] text-[var(--ink)] font-medium">{d.hotelName}</p>}
        {d.address && <p className="text-[10px] text-[var(--muted)] truncate">{d.address}</p>}
        {(d.checkIn || d.checkOut) && (
          <p className="text-[10px] text-[var(--muted)]">
            {d.checkIn ? `Check-in ${formatBookingTime(d.checkIn)}` : ''}
            {d.checkIn && d.checkOut ? ' · ' : ''}
            {d.checkOut ? `Check-out ${formatBookingTime(d.checkOut)}` : ''}
          </p>
        )}
      </div>
    );
  }

  if (d.name || d.provider) {
    return (
      <p className="text-[10px] text-[var(--ink)] font-medium mt-1">{d.name || d.provider}</p>
    );
  }
  return null;
}

function formatBookingTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function BookingsTab({ tripId }: { tripId?: string }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const applyTripUpdate = useTripStore((s) => s.applyTripUpdate);
  const importedBookings = useTripStore((s) => s.tripState?.bookings);

  useEffect(() => {
    checkStatus();
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail') === 'connected') {
      params.delete('gmail');
      window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
      checkStatus();
    }
  }, []);

  useEffect(() => {
    // Mark bookings already present in trip state as imported.
    if (Array.isArray(importedBookings)) {
      setImportedIds((prev) => {
        const next = new Set(prev);
        for (const b of importedBookings) {
          if (b?.id && b.importedAt) next.add(b.id);
        }
        return next;
      });
    }
  }, [importedBookings]);

  const checkStatus = async () => {
    try {
      const res = await gmailApi.status();
      setConnected(res.data.connected);
      if (res.data.connected) {
        fetchBookings();
      }
    } catch {
      setConnected(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await gmailApi.oauthUrl();
      window.location.href = res.data.url;
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to start Gmail connection');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await gmailApi.disconnect();
      setConnected(false);
      setBookings([]);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to disconnect Gmail');
    } finally {
      setDisconnecting(false);
    }
  };

  const fetchBookings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await gmailApi.bookings();
      setBookings(res.data.bookings || []);
    } catch (err: any) {
      const detail = err.response?.data?.detail || 'Failed to fetch bookings';
      setError(detail);
      // Revoked/expired grant → reflect disconnected state.
      if (/reconnect|not connected|expired/i.test(detail)) {
        setConnected(false);
        setBookings([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (booking: any) => {
    if (!tripId) {
      setError('Save this trip first to import bookings into it.');
      return;
    }
    setImportingId(booking.id);
    setError(null);
    try {
      const res = await gmailApi.importBooking(tripId, booking);
      if (res.data?.savedTrip) {
        applyTripUpdate(res.data.savedTrip);
      }
      setImportedIds((prev) => new Set(prev).add(booking.id));
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to import booking');
    } finally {
      setImportingId(null);
    }
  };

  const bookingIcons: Record<string, any> = {
    flight: Plane,
    hotel: Hotel,
    train: Package,
    bus: Package,
    restaurant: Utensils,
    other: Package,
  };

  const disconnectBtn = (
    <button
      onClick={handleDisconnect}
      disabled={disconnecting}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[var(--muted)] hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
      title="Disconnect Gmail and revoke Google access"
    >
      <Unplug className="w-3.5 h-3.5" />
      {disconnecting ? 'Disconnecting…' : 'Disconnect'}
    </button>
  );

  if (connected && !loading && bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 text-center px-6">
        <div className="w-10 h-10 rounded-lg bg-[var(--sage)] flex items-center justify-center mb-3">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
        </div>
        <p className="text-sm font-medium text-[var(--ink)] mb-1">Gmail connected</p>
        <p className="text-xs text-[var(--muted)] mb-4 max-w-[280px]">
          No booking confirmations found in the last 6 months. We'll check again when you book something new.
        </p>
        {error && <p className="text-xs text-red-500 mb-3 max-w-[280px]">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            onClick={fetchBookings}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--muted)] hover:bg-[var(--sage)] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {disconnectBtn}
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 text-center px-6">
        <div className="w-10 h-10 rounded-lg bg-[var(--sage)] flex items-center justify-center mb-3">
          <Mail className="w-5 h-5 text-[var(--muted)]" />
        </div>
        <p className="text-sm font-medium text-[var(--ink)] mb-1">No bookings yet</p>
        <p className="text-xs text-[var(--muted)] mb-4 max-w-[280px]">
          Connect your Gmail to automatically import flight and hotel confirmations.
        </p>
        {error && <p className="text-xs text-red-500 mb-3 max-w-[280px]">{error}</p>}
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="px-4 py-2 rounded-lg bg-[var(--ink)] text-white text-xs font-medium hover:bg-[#292524] transition-colors disabled:opacity-50"
        >
          {connecting ? 'Connecting…' : 'Connect Gmail'}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <span className="text-xs font-medium text-[var(--ink)]">Gmail connected</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchBookings}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[var(--muted)] hover:bg-[var(--sage)] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {disconnectBtn}
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2.5 text-xs text-red-600 bg-red-50 rounded-lg">{error}</div>
      )}

      <div className="space-y-2">
        {bookings.map((booking) => {
          const Icon = bookingIcons[booking.type] || Package;
          const imported = importedIds.has(booking.id);
          return (
            <div key={booking.id} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-md bg-[var(--sage)] flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[var(--muted)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--ink)] truncate">{booking.subject}</p>
                  <p className="text-[10px] text-[var(--muted)] truncate mt-0.5">{booking.sender}</p>
                  <BookingDetail booking={booking} />
                  {booking.confirmationCode && (
                    <p className="text-[10px] text-[var(--muted)] mt-1">
                      Confirmation: <span className="font-mono font-medium text-[var(--ink)]">{booking.confirmationCode}</span>
                    </p>
                  )}
                  {!booking.details && booking.dates && (
                    <p className="text-[10px] text-[var(--muted)] mt-0.5">
                      {booking.dates.start}{booking.dates.end ? ` → ${booking.dates.end}` : ''}
                    </p>
                  )}
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--sage)] text-[var(--muted)] capitalize shrink-0">
                  {booking.type}
                </span>
              </div>
              {(booking.type === 'flight' || booking.type === 'hotel') && (
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => handleImport(booking)}
                    disabled={imported || importingId === booking.id || !tripId}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                      imported
                        ? 'text-green-700 bg-green-50 cursor-default'
                        : 'text-[var(--ink)] border border-[var(--border)] hover:bg-[var(--sage)] disabled:opacity-50'
                    }`}
                  >
                    {imported ? (
                      <><Check className="w-3 h-3" /> Added to trip</>
                    ) : importingId === booking.id ? (
                      'Adding…'
                    ) : (
                      <><Download className="w-3 h-3" /> Add to trip</>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
