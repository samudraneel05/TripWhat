import { useEffect, useState } from 'react';
import { Mail, Package, RefreshCw, CheckCircle2, Check, Plane, Hotel, Utensils, Unplug, Download } from 'lucide-react';
import { useTripStore } from '../stores/tripStore';
import { gmailApi } from '../lib/api';

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

const bookingIcons: Record<string, any> = {
  flight: Plane,
  hotel: Hotel,
  train: Package,
  bus: Package,
  restaurant: Utensils,
  other: Package,
};

export function BookingsTab({ tripId }: { tripId?: string }) {
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
