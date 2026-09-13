import { X, Plane, Clock, ArrowDown, ExternalLink } from 'lucide-react';
import { formatDuration, formatTime, formatDate, type FlightOption } from './FlightCard';

interface Props {
  flight: FlightOption;
  onClose: () => void;
}

export function FlightDetailPanel({ flight, onClose }: Props) {
  const firstLeg = flight.legs[0];
  const lastLeg = flight.legs[flight.legs.length - 1];

  if (!firstLeg) return null;

  const layoverCount = flight.layovers.length;
  const stopsLabel = layoverCount === 0 ? 'Nonstop' : `${layoverCount} stop${layoverCount > 1 ? 's' : ''}`;
  const airlines = [...new Set(flight.legs.map((l) => l.airline).filter(Boolean))].join(', ');

  return (
    <div className="absolute inset-0 z-30 bg-[var(--surface)] flex flex-col overflow-hidden animate-in slide-in-from-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--border)] shrink-0">
        <span className="text-sm font-medium text-[var(--ink)] truncate">Flight Details</span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-[var(--sage)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[520px] mx-auto">
          {/* Hero: route + price */}
          <div className="px-4 py-5 border-b border-[var(--border)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <p className="text-xl font-semibold text-[var(--ink)]">{firstLeg.departureAirport.code}</p>
                  <p className="text-[10px] text-[var(--muted)]">{formatTime(firstLeg.departureAirport.time)}</p>
                </div>
                <div className="flex flex-col items-center px-1">
                  <Plane className="w-4 h-4 text-[var(--muted)]" />
                  <span className="text-[9px] text-[var(--muted)] mt-0.5">{formatDuration(flight.totalDuration)}</span>
                </div>
                <div className="text-center">
                  <p className="text-xl font-semibold text-[var(--ink)]">{lastLeg.arrivalAirport.code}</p>
                  <p className="text-[10px] text-[var(--muted)]">{formatTime(lastLeg.arrivalAirport.time)}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-semibold text-[var(--ink)]">
                  {flight.price ? `${flight.currency} ${flight.price.toLocaleString()}` : '—'}
                </p>
                <p className="text-[10px] text-[var(--muted)] capitalize">{flight.type}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              {flight.isBest && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--lavender)] text-[var(--ink)]">
                  BEST
                </span>
              )}
              <span className="text-[10px] text-[var(--muted)]">{stopsLabel}</span>
              {airlines && <span className="text-[10px] text-[var(--muted)]">· {airlines}</span>}
              <span className="text-[10px] text-[var(--muted)]">
                · {formatDate(firstLeg.departureAirport.time)}
              </span>
            </div>
          </div>

          {/* Legs */}
          <div className="px-4 py-4 space-y-4">
            {(flight.outboundLegs?.length && flight.returnLegs?.length) ? (
              <>
                <div>
                  <p className="text-xs font-semibold text-[var(--ink)] mb-2">Outbound</p>
                  <LegCards legs={flight.outboundLegs} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--ink)] mb-2">Return</p>
                  <LegCards legs={flight.returnLegs} />
                </div>
              </>
            ) : (
              <LegCards legs={flight.legs} />
            )}

            {/* Layovers summary */}
            {flight.layovers.length > 0 && (
              <div className="space-y-1.5">
                {flight.layovers.map((l, i) => (
                  <div key={i} className="flex items-center gap-1.5 pl-2">
                    <ArrowDown className="w-3 h-3 text-[var(--muted)]" />
                    <span className="text-[10px] text-[var(--muted)]">
                      Layover at {l.airportCode} · {formatDuration(l.duration)}
                      {l.overnight && ' (overnight)'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Booking */}
          {flight.bookingLink && (
            <div className="px-4 pb-6">
              <a
                href={flight.bookingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-[var(--ink)] text-white text-xs font-medium hover:bg-[#292524] transition-colors"
              >
                View booking details
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LegCards({ legs }: { legs: any[] }) {
  return (
    <div className="space-y-4">
      {legs.map((leg, i) => (
        <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
          {/* Leg header */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-[var(--ink)]">{leg.airline}</span>
            {leg.flightNumber && (
              <span className="text-[10px] text-[var(--muted)]">{leg.flightNumber}</span>
            )}
            {leg.travelClass && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--sage)] text-[var(--muted)] capitalize">
                {leg.travelClass}
              </span>
            )}
          </div>

          {/* Departure */}
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center pt-1">
              <span className="w-2 h-2 rounded-full border-2 border-[var(--ink)]" />
              <span className="w-px flex-1 min-h-[24px] bg-[var(--border)]" />
            </div>
            <div className="pb-3">
              <p className="text-sm font-medium text-[var(--ink)]">
                {formatTime(leg.departureAirport.time)}
                <span className="text-[var(--muted)] font-normal ml-1.5 text-xs">
                  {formatDate(leg.departureAirport.time)}
                </span>
              </p>
              <p className="text-xs text-[var(--muted)]">
                {leg.departureAirport.name} ({leg.departureAirport.code})
              </p>
            </div>
          </div>

          {/* Duration */}
          <div className="flex items-center gap-3 py-1">
            <div className="w-2 flex justify-center">
              <Clock className="w-3 h-3 text-[var(--muted)]" />
            </div>
            <span className="text-[10px] text-[var(--muted)]">{formatDuration(leg.duration)}</span>
          </div>

          {/* Arrival */}
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center pt-1">
              <span className="w-2 h-2 rounded-full bg-[var(--ink)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">
                {formatTime(leg.arrivalAirport.time)}
                <span className="text-[var(--muted)] font-normal ml-1.5 text-xs">
                  {formatDate(leg.arrivalAirport.time)}
                </span>
              </p>
              <p className="text-xs text-[var(--muted)]">
                {leg.arrivalAirport.name} ({leg.arrivalAirport.code})
              </p>
            </div>
          </div>

          {(leg.airplane || leg.overnight) && (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[var(--border)]">
              {leg.airplane && (
                <p className="text-[10px] text-[var(--muted)]">Aircraft: {leg.airplane}</p>
              )}
              {leg.overnight && (
                <p className="text-[10px] text-amber-600">Overnight flight</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
