import { useState } from 'react';
import { Plane, Clock, ArrowRight, ChevronDown, ChevronUp, ExternalLink, Bookmark } from 'lucide-react';
import { useSavedStore } from '../stores/savedStore';

export interface FlightLeg {
  departureAirport: { code: string; name: string; time: string };
  arrivalAirport: { code: string; name: string; time: string };
  airline: string;
  flightNumber: string;
  duration: number;
  airplane: string;
  travelClass: string;
  overnight: boolean;
}

export interface FlightOption {
  id: string;
  legs: FlightLeg[];
  outboundLegs?: FlightLeg[];
  returnLegs?: FlightLeg[];
  layovers: { airportCode: string; duration: number; overnight: boolean }[];
  totalDuration: number;
  price: number | null;
  currency: string;
  type: string;
  isBest: boolean;
  bookingLink: string;
}

export function formatDuration(minutes: number): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function FlightCard({ flight, onOpen }: { flight: FlightOption; onOpen?: (flight: FlightOption) => void }) {
  const [expanded, setExpanded] = useState(false);
  const firstLeg = flight.legs[0];
  const lastLeg = flight.legs[flight.legs.length - 1];

  if (!firstLeg) return null;

  const layoverCount = flight.layovers.length;
  const stopsLabel = layoverCount === 0 ? 'Nonstop' : `${layoverCount} stop${layoverCount > 1 ? 's' : ''}`;

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-all relative ${
        flight.isBest
          ? 'border-[var(--lavender)] bg-[var(--surface)]'
          : 'border-[var(--border)] bg-[var(--surface)]'
      }`}
    >
      {/* Summary row */}
      <button
        onClick={() => (onOpen ? onOpen(flight) : setExpanded(!expanded))}
        className="w-full flex items-center gap-3 p-3 hover:bg-[var(--bg)] transition-colors text-left"
      >
        {flight.isBest && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--lavender)] text-[var(--ink)] shrink-0">
            BEST
          </span>
        )}
        {/* Route */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-center">
            <p className="text-sm font-semibold text-[var(--ink)]">{firstLeg.departureAirport.code}</p>
            <p className="text-[9px] text-[var(--muted)]">{formatTime(firstLeg.departureAirport.time)}</p>
          </div>
          <div className="flex flex-col items-center">
            <Plane className="w-3 h-3 text-[var(--muted)]" />
            <span className="text-[8px] text-[var(--muted)] mt-0.5">{formatDuration(flight.totalDuration)}</span>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-[var(--ink)]">{lastLeg.arrivalAirport.code}</p>
            <p className="text-[9px] text-[var(--muted)]">{formatTime(lastLeg.arrivalAirport.time)}</p>
          </div>
        </div>

        {/* Stops */}
        <span className="text-[10px] text-[var(--muted)] shrink-0">{stopsLabel}</span>

        {/* Price — hidden when unknown (e.g. flights imported from email) */}
        <div className="ml-auto text-right shrink-0">
          <p className="text-sm font-semibold text-[var(--ink)]">
            {flight.price ? `${flight.currency} ${flight.price.toLocaleString()}` : '—'}
          </p>
          <p className="text-[9px] text-[var(--muted)] capitalize">{flight.type}</p>
        </div>

        {onOpen ? (
          <ArrowRight className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
        ) : expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
        )}
      </button>

      {/* Save button overlay */}
      <SaveFlightButton flight={flight} />

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-[var(--border)] p-3 space-y-3">
          {(flight.outboundLegs?.length && flight.returnLegs?.length) ? (
            <>
              <div>
                <p className="text-[10px] font-semibold text-[var(--ink)] mb-2">Outbound</p>
                <LegGroup legs={flight.outboundLegs} layovers={flight.layovers} />
              </div>
              <div className="border-t border-[var(--border)] pt-3">
                <p className="text-[10px] font-semibold text-[var(--ink)] mb-2">Return</p>
                <LegGroup legs={flight.returnLegs} layovers={flight.layovers.slice(flight.outboundLegs.length - 1)} />
              </div>
            </>
          ) : (
            <LegGroup legs={flight.legs} layovers={flight.layovers} />
          )}

          {/* Booking link */}
          {flight.bookingLink && (
            <a
              href={flight.bookingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-[var(--ink)] text-white text-xs font-medium hover:bg-[#292524] transition-colors"
            >
              View booking details
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function LegGroup({ legs, layovers }: { legs: FlightLeg[]; layovers: { airportCode: string; duration: number; overnight: boolean }[] }) {
  return (
    <div className="space-y-3">
      {legs.map((leg, i) => (
        <div key={i}>
          {/* Leg header */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-medium text-[var(--ink)]">{leg.airline}</span>
            {leg.flightNumber && (
              <span className="text-[10px] text-[var(--muted)]">{leg.flightNumber}</span>
            )}
            {leg.travelClass && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--sage)] text-[var(--muted)] capitalize">
                {leg.travelClass}
              </span>
            )}
          </div>

          {/* Departure → Arrival */}
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <p className="text-xs font-medium text-[var(--ink)]">
                {formatTime(leg.departureAirport.time)}
                <span className="text-[var(--muted)] font-normal ml-1.5">
                  {formatDate(leg.departureAirport.time)}
                </span>
              </p>
              <p className="text-[10px] text-[var(--muted)]">
                {leg.departureAirport.name} ({leg.departureAirport.code})
              </p>
            </div>
            <div className="flex flex-col items-center px-2">
              <Clock className="w-3 h-3 text-[var(--muted)] mb-0.5" />
              <span className="text-[9px] text-[var(--muted)]">{formatDuration(leg.duration)}</span>
            </div>
            <div className="flex-1 text-right">
              <p className="text-xs font-medium text-[var(--ink)]">
                {formatTime(leg.arrivalAirport.time)}
                <span className="text-[var(--muted)] font-normal ml-1.5">
                  {formatDate(leg.arrivalAirport.time)}
                </span>
              </p>
              <p className="text-[10px] text-[var(--muted)]">
                {leg.arrivalAirport.name} ({leg.arrivalAirport.code})
              </p>
            </div>
          </div>

          {leg.airplane && (
            <p className="text-[9px] text-[var(--muted)] mt-1">Aircraft: {leg.airplane}</p>
          )}
          {leg.overnight && (
            <p className="text-[9px] text-amber-600 mt-0.5">Overnight flight</p>
          )}

          {/* Layover between legs */}
          {i < legs.length - 1 && layovers[i] && (
            <div className="flex items-center gap-1.5 my-2 pl-4 border-l-2 border-[var(--border)]">
              <ArrowRight className="w-3 h-3 text-[var(--muted)]" />
              <span className="text-[10px] text-[var(--muted)]">
                Layover at {layovers[i].airportCode} · {formatDuration(layovers[i].duration)}
                {layovers[i].overnight && ' (overnight)'}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SaveFlightButton({ flight }: { flight: FlightOption }) {
  const { saveItem, isSaved } = useSavedStore();
  const flightName = `${flight.legs?.[0]?.departureAirport?.code || ''} → ${flight.legs?.[flight.legs.length - 1]?.arrivalAirport?.code || ''}`;
  const saved = isSaved('flight', flightName);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!saved) saveItem('flight', flightName, flight);
      }}
      className={`absolute top-2 right-2 p-1 rounded hover:bg-[var(--sage)] transition-colors ${
        saved ? 'text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'
      }`}
      title={saved ? 'Saved' : 'Save flight'}
    >
      <Bookmark className={`w-3 h-3 ${saved ? 'fill-current' : ''}`} />
    </button>
  );
}
