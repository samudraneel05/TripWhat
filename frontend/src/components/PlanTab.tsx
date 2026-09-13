import { useState } from 'react';
import { MapPin, Plus, Calendar, Plane, Hotel, Utensils, Star, ExternalLink, Bookmark, Footprints, Car, Bus, List, Layers, Loader2 } from 'lucide-react';
import { FlightCard, formatTime, formatDuration, type FlightOption, type FlightLeg } from './FlightCard';
import { useSavedStore } from '../stores/savedStore';
import { useUIStore } from '../stores/uiStore';
import { useTripStore } from '../stores/tripStore';
import { AddItemInline } from './PlanTab/AddItemInline';
import { ActivityMenu } from './PlanTab/ActivityMenu';
import { imgUrl } from '../lib/image';

interface PlanTabProps {
  itinerary: any;
  cityFilter: string | null;
  setCityFilter: (c: string | null) => void;
  cities: any[];
  onSelectPlace: (placeId: string) => void;
  onSelectFlight: (flight: FlightOption) => void;
  datesAssumed?: boolean;
  conversationId?: string;
}

function formatDayHeader(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function TravelConnector({ travelInfo }: { travelInfo?: any }) {
  if (!travelInfo || !travelInfo.durationText) return null;
  const { mode, durationText, distanceText } = travelInfo;
  const Icon = mode === 'driving' ? Car : mode === 'transit' ? Bus : mode === 'flight' ? Plane : Footprints;
  const modeLabel = mode === 'walking' ? 'walk' : mode === 'driving' ? 'drive' : mode === 'flight' ? 'flight' : 'transit';
  return (
    <div className="flex items-center justify-center gap-1.5 py-1.5">
      <div className="w-px h-3 bg-[var(--border)]" />
      <Icon className="w-3 h-3 text-[var(--muted)] shrink-0" />
      <span className="text-[10px] text-[var(--muted)]">
        {durationText} {modeLabel}{distanceText ? ` · ${distanceText}` : ''}
      </span>
      <div className="w-px h-3 bg-[var(--border)]" />
    </div>
  );
}

export function PlanTab({
  itinerary,
  cityFilter,
  setCityFilter,
  cities,
  onSelectPlace,
  onSelectFlight,
  datesAssumed,
  conversationId,
}: PlanTabProps) {
  const { planViewMode, setPlanViewMode, selectedDay, setSelectedDay } = useUIStore();
  const progressiveDays = useTripStore((s) => s.progressiveDays);
  const editItinerary = useTripStore((s) => s.editItinerary);
  const [addingDay, setAddingDay] = useState<number | null>(null);

  const canEdit = !!conversationId;

  const handleAdd = async (day: number, city: string, placeName: string) => {
    if (!conversationId) return;
    await editItinerary(conversationId, 'add', {
      place_name: placeName,
      city,
      day,
    });
    setAddingDay(null);
  };

  const handleRemove = async (day: number, activityId: string) => {
    if (!conversationId) return;
    await editItinerary(conversationId, 'remove', { day, activity_id: activityId });
  };

  const handleEditTime = async (day: number, slotId: string, startTime: string, endTime: string) => {
    if (!conversationId) return;
    await editItinerary(conversationId, 'editTime', {
      day, slot_id: slotId, start_time: startTime, end_time: endTime,
    });
  };

  const handleCaption = async (day: number, activityId: string, caption: string) => {
    if (!conversationId) return;
    await editItinerary(conversationId, 'caption', { day, activity_id: activityId, caption });
  };

  const handleMove = async (fromDay: number, activityId: string, toDay: number) => {
    if (!conversationId) return;
    await editItinerary(conversationId, 'move', {
      from_day: fromDay, activity_id: activityId, to_day: toDay,
    });
  };

  // Progressive view — days are being built, full itinerary not yet ready
  if (progressiveDays && progressiveDays.length > 0 && (!itinerary || !itinerary.days?.length)) {
    const totalDays = progressiveDays[0]?.totalDays || progressiveDays.length;
    const sorted = [...progressiveDays].sort((a, b) => a.day - b.day);
    return (
      <div className="p-4">
        <div className="space-y-3">
          {sorted.map((pd) => (
            <div key={pd.day} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--ink)]">Day {pd.day}</span>
                  <span className="text-xs text-[var(--muted)] flex items-center gap-0.5">
                    <MapPin className="w-3 h-3" />
                    {pd.city}
                  </span>
                </div>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {pd.timeSlots?.map((slot: any, i: number) => {
                  const activityName = slot.activity?.name || slot.activities?.map((a: any) => a.name).join(', ') || '';
                  const imageUrl = slot.activity?.imageUrl || slot.activity?.photos?.[0];
                  const placeId = slot.activity?.placeId || '';
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg)] transition-colors ${placeId ? 'cursor-pointer' : ''}`}
                      onClick={() => placeId && onSelectPlace(placeId)}
                    >
                      {imageUrl && (
                        <img src={imgUrl(imageUrl)} alt={activityName} className="w-12 h-12 rounded-md object-cover shrink-0" loading="lazy" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide shrink-0">
                            {slot.startTime && slot.endTime ? `${slot.startTime}–${slot.endTime}` : (slot.period || '')}
                          </span>
                          {slot.activity?.type && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--sage)] text-[var(--muted)] shrink-0">
                              {slot.activity.type}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--ink)] truncate">{activityName || 'Free time'}</p>
                        {slot.activity?.description && (
                          <p className="text-[10px] text-[var(--muted)] truncate mt-0.5">{slot.activity.description}</p>
                        )}
                      </div>
                      {slot.activity?.rating != null && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          <span className="text-[10px] font-medium text-[var(--ink)]">{slot.activity.rating}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {sorted.length < totalDays && (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center">
              <Loader2 className="w-4 h-4 animate-spin mx-auto text-[var(--muted)]" />
              <p className="text-xs text-[var(--muted)] mt-1">Building Day {sorted.length + 1}...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!itinerary || !itinerary.days) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 text-center">
        <MapPin className="w-8 h-8 text-[var(--muted)] mb-2 opacity-40" />
        <p className="text-sm text-[var(--muted)]">No itinerary yet. Start chatting to plan your trip.</p>
      </div>
    );
  }

  const filteredDays = cityFilter
    ? itinerary.days.filter((d: any) => d.location === cityFilter)
    : itinerary.days;

  // Day-by-day view
  if (planViewMode === 'day-by-day') {
    const day = itinerary.days.find((d: any) => d.dayNumber === selectedDay) || itinerary.days[0];
    const dayIdx = itinerary.days.indexOf(day);
    const isFirstDay = dayIdx === 0;
    const isLastDay = dayIdx === itinerary.days.length - 1;
    const bestFlight = itinerary.flightOptions?.[0];
    const bestHotel = itinerary.hotelRecommendations?.[0];

    return (
      <div className="p-4">
        {/* View toggle */}
        <div className="flex items-center gap-1 mb-3 p-0.5 rounded-md bg-[var(--bg)] w-fit">
          <button
            onClick={() => setPlanViewMode('overview')}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            <Layers className="w-3 h-3" />
            Overview
          </button>
          <button
            onClick={() => setPlanViewMode('day-by-day')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              planViewMode === 'day-by-day' ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            <List className="w-3 h-3" />
            Day-by-day
          </button>
        </div>

        {/* Day selector chips */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {itinerary.days.map((d: any) => (
            <button
              key={d.dayNumber}
              onClick={() => setSelectedDay(d.dayNumber)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedDay === d.dayNumber ? 'bg-[var(--lavender)] text-[var(--ink)]' : 'text-[var(--muted)] hover:bg-[var(--sage)]'
              }`}
            >
              Day {d.dayNumber}
            </button>
          ))}
        </div>

        {/* Day header */}
        <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--ink)]">Day {day.dayNumber}</span>
              {day.location && (
                <span className="text-xs text-[var(--muted)] flex items-center gap-0.5">
                  <MapPin className="w-3 h-3" />
                  {day.location}
                </span>
              )}
              {itinerary.hotelRecommendations?.some((h: any) =>
                h.address?.includes(day.location) || h.name?.includes(day.location)
              ) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const hotel = itinerary.hotelRecommendations?.find((h: any) =>
                      h.address?.includes(day.location) || h.name?.includes(day.location)
                    );
                    if (hotel?.placeId) onSelectPlace(hotel.placeId);
                  }}
                  className="flex items-center gap-0.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                  title={`Hotel in ${day.location}`}
                >
                  <Hotel className="w-3 h-3" />
                </button>
              )}
            </div>
            {day.date && (
              <span className="text-xs text-[var(--muted)] flex items-center gap-0.5">
                <Calendar className="w-3 h-3" />
                {formatDayHeader(day.date)}
              </span>
            )}
          </div>

          {day.subtitle && (
            <p className="px-4 py-2 text-xs text-[var(--muted)] leading-relaxed border-b border-[var(--border)]">
              {day.subtitle}
            </p>
          )}

          {/* Activities with travel connectors */}
          <div className="divide-y divide-[var(--border)]">
            {isFirstDay && bestFlight && bestFlight.outboundLegs?.length > 0 && (
              <AnchoredFlightRow
                label="Flight"
                legs={bestFlight.outboundLegs}
                flight={bestFlight}
                onClick={() => onSelectFlight(bestFlight)}
              />
            )}
            {isFirstDay && bestHotel && (
              <AnchoredHotelRow hotel={bestHotel} onClick={() => bestHotel.placeId && onSelectPlace(bestHotel.placeId)} />
            )}

            {day.timeSlots?.map((slot: any, i: number) => {
              const activityName = slot.activity?.name || slot.activities?.map((a: any) => a.name).join(', ') || '';
              const imageUrl = slot.activity?.imageUrl || slot.activity?.photos?.[0];
              const placeId = slot.activity?.placeId || '';
              const travelInfo = slot.activity?.travelInfo;
              return (
                <div key={i}>
                  <div
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg)] transition-colors ${placeId ? 'cursor-pointer' : ''}`}
                    onClick={() => placeId && onSelectPlace(placeId)}
                  >
                    {imageUrl && (
                      <img
                        src={imgUrl(imageUrl)}
                        alt={activityName}
                        className="w-12 h-12 rounded-md object-cover shrink-0"
                        loading="lazy"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide shrink-0">
                          {slot.startTime && slot.endTime ? `${slot.startTime}–${slot.endTime}` : (slot.period || '')}
                        </span>
                        {slot.activity?.type && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--sage)] text-[var(--muted)] shrink-0">
                            {slot.activity.type}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-[var(--ink)] truncate">{activityName || 'Free time'}</p>
                      {slot.activity?.description && (
                        <p className="text-[10px] text-[var(--muted)] truncate mt-0.5">{slot.activity.description}</p>
                      )}
                    </div>
                    {slot.activity?.duration && (
                      <span className="text-[10px] text-[var(--muted)] shrink-0">
                        {slot.activity.duration}
                      </span>
                    )}
                    {slot.activity?.rating != null && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        <span className="text-[10px] font-medium text-[var(--ink)]">{slot.activity.rating}</span>
                      </div>
                    )}
                    {canEdit && slot.activity?.id && (
                      <ActivityMenu
                        activity={slot.activity}
                        day={day.dayNumber}
                        totalDays={itinerary.days.length}
                        slot={slot}
                        onRemove={(aid) => handleRemove(day.dayNumber, aid)}
                        onEditTime={(sid, st, et) => handleEditTime(day.dayNumber, sid, st, et)}
                        onAddCaption={(aid, cap) => handleCaption(day.dayNumber, aid, cap)}
                        onMove={(aid, td) => handleMove(day.dayNumber, aid, td)}
                      />
                    )}
                  </div>
                  {/* Travel connector to next activity */}
                  {i < (day.timeSlots?.length || 0) - 1 && (
                    <TravelConnector travelInfo={travelInfo} />
                  )}
                </div>
              );
            })}
            {canEdit && (
              addingDay === day.dayNumber ? (
                <AddItemInline
                  day={day.dayNumber}
                  city={day.location || ''}
                  onAdd={(placeName) => handleAdd(day.dayNumber, day.location || '', placeName)}
                  onCancel={() => setAddingDay(null)}
                />
              ) : (
                <button
                  onClick={() => setAddingDay(day.dayNumber)}
                  className="flex items-center gap-2 px-4 py-2 text-xs text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg)] transition-colors w-full"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add item
                </button>
              )
            )}

            {isLastDay && bestFlight && bestFlight.returnLegs?.length > 0 && (
              <AnchoredFlightRow
                label="Return flight"
                legs={bestFlight.returnLegs}
                flight={bestFlight}
                onClick={() => onSelectFlight(bestFlight)}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Overview view (default)
  return (
    <div className="p-4">
      {/* View toggle */}
      <div className="flex items-center gap-1 mb-3 p-0.5 rounded-md bg-[var(--bg)] w-fit">
        <button
          onClick={() => setPlanViewMode('overview')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            planViewMode === 'overview' ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'
          }`}
        >
          <Layers className="w-3 h-3" />
          Overview
        </button>
        <button
          onClick={() => setPlanViewMode('day-by-day')}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
        >
          <List className="w-3 h-3" />
          Day-by-day
        </button>
      </div>

      {/* City filter chips */}
      {cities.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setCityFilter(null)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              !cityFilter ? 'bg-[var(--lavender)] text-[var(--ink)]' : 'text-[var(--muted)] hover:bg-[var(--sage)]'
            }`}
          >
            All
          </button>
          {cities.map((c: any) => (
            <button
              key={c.name}
              onClick={() => setCityFilter(c.name)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                cityFilter === c.name ? 'bg-[var(--lavender)] text-[var(--ink)]' : 'text-[var(--muted)] hover:bg-[var(--sage)]'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Assumed dates badge */}
      {datesAssumed && itinerary.tripMetadata?.startDate && (
        <div className="mb-3 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-[10px] text-amber-700">
          Dates are assumed from your rough month — adjust anytime in chat.
        </div>
      )}

      {/* Day cards */}
      <div className="space-y-3">
        {filteredDays.map((day: any, dayIdx: number) => {
          const isFirstDay = dayIdx === 0;
          const isLastDay = dayIdx === filteredDays.length - 1;
          const bestFlight = itinerary.flightOptions?.[0];
          const bestHotel = itinerary.hotelRecommendations?.[0];
          return (
          <div key={day.dayNumber} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
            {/* Day header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--ink)]">Day {day.dayNumber}</span>
                {day.location && (
                  <span className="text-xs text-[var(--muted)] flex items-center gap-0.5">
                    <MapPin className="w-3 h-3" />
                    {day.location}
                  </span>
                )}
                {itinerary.hotelRecommendations?.some((h: any) =>
                  h.address?.includes(day.location) || h.name?.includes(day.location)
                ) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const hotel = itinerary.hotelRecommendations?.find((h: any) =>
                        h.address?.includes(day.location) || h.name?.includes(day.location)
                      );
                      if (hotel?.placeId) onSelectPlace(hotel.placeId);
                    }}
                    className="flex items-center gap-0.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                    title={`Hotel in ${day.location}`}
                  >
                    <Hotel className="w-3 h-3" />
                  </button>
                )}
              </div>
              {day.date && (
                <span className="text-xs text-[var(--muted)] flex items-center gap-0.5">
                  <Calendar className="w-3 h-3" />
                  {formatDayHeader(day.date)}
                </span>
              )}
            </div>

            {/* Day description */}
            {day.subtitle && (
              <p className="px-4 py-2 text-xs text-[var(--muted)] leading-relaxed border-b border-[var(--border)]">
                {day.subtitle}
              </p>
            )}

            {/* Activities */}
            <div className="divide-y divide-[var(--border)]">
              {/* Anchored outbound flight row (day 1) */}
              {isFirstDay && bestFlight && bestFlight.outboundLegs?.length > 0 && (
                <AnchoredFlightRow
                  label="Flight"
                  legs={bestFlight.outboundLegs}
                  flight={bestFlight}
                  onClick={() => onSelectFlight(bestFlight)}
                />
              )}

              {/* Anchored hotel check-in row (day 1) */}
              {isFirstDay && bestHotel && (
                <AnchoredHotelRow hotel={bestHotel} onClick={() => bestHotel.placeId && onSelectPlace(bestHotel.placeId)} />
              )}

              {day.timeSlots?.map((slot: any, i: number) => {
                const activityName = slot.activity?.name || slot.activities?.map((a: any) => a.name).join(', ') || '';
                const imageUrl = slot.activity?.imageUrl || slot.activity?.photos?.[0];
                const placeId = slot.activity?.placeId || '';
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg)] transition-colors ${placeId ? 'cursor-pointer' : ''}`}
                    onClick={() => placeId && onSelectPlace(placeId)}
                  >
                    {imageUrl && (
                      <img
                        src={imgUrl(imageUrl)}
                        alt={activityName}
                        className="w-10 h-10 rounded-md object-cover shrink-0"
                        loading="lazy"
                      />
                    )}
                    <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide w-16 shrink-0">
                      {slot.startTime && slot.endTime ? `${slot.startTime}–${slot.endTime}` : (slot.period || slot.timeSlot || '')}
                    </span>
                    <span className="text-xs text-[var(--ink)] flex-1 truncate">
                      {activityName || 'Free time'}
                    </span>
                    {slot.activity?.duration && (
                      <span className="text-[10px] text-[var(--muted)] shrink-0">
                        {slot.activity.duration}
                      </span>
                    )}
                    {slot.activity?.type && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--sage)] text-[var(--muted)] shrink-0">
                        {slot.activity.type}
                      </span>
                    )}
                    {canEdit && slot.activity?.id && (
                      <ActivityMenu
                        activity={slot.activity}
                        day={day.dayNumber}
                        totalDays={itinerary.days.length}
                        slot={slot}
                        onRemove={(aid) => handleRemove(day.dayNumber, aid)}
                        onEditTime={(sid, st, et) => handleEditTime(day.dayNumber, sid, st, et)}
                        onAddCaption={(aid, cap) => handleCaption(day.dayNumber, aid, cap)}
                        onMove={(aid, td) => handleMove(day.dayNumber, aid, td)}
                      />
                    )}
                  </div>
                );
              })}
              {/* Add item row */}
              {canEdit ? (
                addingDay === day.dayNumber ? (
                  <AddItemInline
                    day={day.dayNumber}
                    city={day.location || ''}
                    onAdd={(placeName) => handleAdd(day.dayNumber, day.location || '', placeName)}
                    onCancel={() => setAddingDay(null)}
                  />
                ) : (
                  <button
                    onClick={() => setAddingDay(day.dayNumber)}
                    className="flex items-center gap-2 px-4 py-2 text-xs text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg)] transition-colors w-full"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add item
                  </button>
                )
              ) : null}

              {/* Anchored return flight row (last day) */}
              {isLastDay && bestFlight && bestFlight.returnLegs?.length > 0 && (
                <AnchoredFlightRow
                  label="Return flight"
                  legs={bestFlight.returnLegs}
                  flight={bestFlight}
                  onClick={() => onSelectFlight(bestFlight)}
                />
              )}
            </div>
          </div>
          );
        })}
      </div>

      {/* Flight options */}
      {itinerary.flightOptions?.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <Plane className="w-4 h-4 text-[var(--muted)]" />
            <span className="text-xs font-semibold text-[var(--ink)]">Flight Options</span>
          </div>
          <div className="space-y-2">
            {itinerary.flightOptions.map((flight: any, i: number) => (
              <FlightCard key={i} flight={flight} onOpen={onSelectFlight} />
            ))}
          </div>
        </div>
      )}

      {/* Hotel recommendations */}
      {itinerary.hotelRecommendations?.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <Hotel className="w-4 h-4 text-[var(--muted)]" />
            <span className="text-xs font-semibold text-[var(--ink)]">Hotel Recommendations</span>
          </div>
          <div className="space-y-2">
            {itinerary.hotelRecommendations.map((hotel: any, i: number) => (
              <RecommendationCard key={i} item={hotel} onSelectPlace={onSelectPlace} />
            ))}
          </div>
        </div>
      )}

      {/* Restaurant recommendations */}
      {itinerary.restaurantRecommendations?.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <Utensils className="w-4 h-4 text-[var(--muted)]" />
            <span className="text-xs font-semibold text-[var(--ink)]">Restaurant Recommendations</span>
          </div>
          <div className="space-y-2">
            {itinerary.restaurantRecommendations.map((rest: any, i: number) => (
              <RecommendationCard key={i} item={rest} onSelectPlace={onSelectPlace} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RecommendationCard({ item, onSelectPlace }: any) {
  const isHotel = item.ratePerNight != null || item.amenities != null;
  const { saveItem, isSaved } = useSavedStore();
  const itemType = isHotel ? 'hotel' : 'restaurant';
  const saved = isSaved(itemType, item.name);
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--bg)] transition-colors ${item.placeId ? 'cursor-pointer' : ''}`}
      onClick={() => item.placeId && onSelectPlace(item.placeId)}
    >
      {item.imageUrl && (
        <img
          src={imgUrl(item.imageUrl)}
          alt={item.name}
          className="w-14 h-14 rounded-md object-cover shrink-0"
          loading="lazy"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-[var(--ink)] truncate flex-1">{item.name}</p>
          {item.rating != null && (
            <div className="flex items-center gap-0.5 shrink-0">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span className="text-[10px] font-medium text-[var(--ink)]">{item.rating}</span>
              {item.reviewsCount != null && (
                <span className="text-[9px] text-[var(--muted)]">({item.reviewsCount})</span>
              )}
            </div>
          )}
        </div>
        {item.address && (
          <p className="text-[10px] text-[var(--muted)] truncate mt-0.5">{item.address}</p>
        )}
        {item.whyPicked && (
          <p className="text-[10px] text-[var(--muted)] mt-0.5 italic">{item.whyPicked}</p>
        )}
        {item.description && !item.whyPicked && (
          <p className="text-[10px] text-[var(--muted)] truncate mt-0.5">{item.description}</p>
        )}
        {item.amenities && item.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.amenities.slice(0, 3).map((a: string, i: number) => (
              <span key={i} className="text-[9px] px-1 py-0.5 rounded bg-[var(--sage)] text-[var(--muted)]">
                {a}
              </span>
            ))}
          </div>
        )}
        {item.cuisine && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--sage)] text-[var(--muted)] capitalize mt-1 inline-block">
            {item.cuisine}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {item.ratePerNight != null && (
          <div className="text-right">
            <p className="text-xs font-semibold text-[var(--ink)]">
              {item.currency || '$'}{item.ratePerNight.toLocaleString()}
            </p>
            <p className="text-[9px] text-[var(--muted)]">/ night</p>
          </div>
        )}
        <div className="flex items-center gap-1">
          {item.bookingLink && (
            <a
              href={item.bookingLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="px-2 py-1 rounded-md bg-[var(--ink)] text-white text-[10px] font-medium hover:bg-[#292524] transition-colors"
            >
              Book
            </a>
          )}
          {item.website && !item.bookingLink && (
            <a
              href={item.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded hover:bg-[var(--sage)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!saved) saveItem(itemType, item.name, item);
            }}
            className={`p-1 rounded hover:bg-[var(--sage)] transition-colors ${
              saved ? 'text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
            title={saved ? 'Saved' : 'Save'}
          >
            <Bookmark className={`w-3 h-3 ${saved ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AnchoredFlightRow({ label, legs, flight, onClick }: {
  label: string;
  legs: FlightLeg[];
  flight: FlightOption;
  onClick: () => void;
}) {
  if (!legs.length) return null;
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 bg-blue-50/50 hover:bg-blue-50 transition-colors cursor-pointer border-l-2 border-blue-300"
      onClick={onClick}
    >
      <Plane className="w-4 h-4 text-blue-500 shrink-0" />
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-semibold text-[var(--ink)]">{firstLeg.departureAirport.code}</span>
        <span className="text-[9px] text-[var(--muted)]">{formatTime(firstLeg.departureAirport.time)}</span>
        <span className="text-[var(--muted)]">→</span>
        <span className="text-xs font-semibold text-[var(--ink)]">{lastLeg.arrivalAirport.code}</span>
        <span className="text-[9px] text-[var(--muted)]">{formatTime(lastLeg.arrivalAirport.time)}</span>
      </div>
      <span className="text-[10px] text-blue-600 font-medium shrink-0">{label}</span>
      <span className="text-[10px] text-[var(--muted)] shrink-0">{formatDuration(flight.totalDuration)}</span>
      <span className="text-xs font-semibold text-[var(--ink)] ml-auto shrink-0">
        {flight.price ? `${flight.currency} ${flight.price.toLocaleString()}` : '—'}
      </span>
    </div>
  );
}

function AnchoredHotelRow({ hotel, onClick }: { hotel: any; onClick: () => void }) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 bg-[var(--lavender)]/30 hover:bg-[var(--lavender)]/50 transition-colors border-l-2 border-[var(--lavender)] ${hotel.placeId ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <Hotel className="w-4 h-4 text-[var(--ink)] shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-[var(--ink)] truncate">{hotel.name}</span>
        {hotel.ratePerNight != null && (
          <span className="text-[10px] text-[var(--muted)] ml-2">
            {hotel.currency || '$'}{hotel.ratePerNight.toLocaleString()}/night
          </span>
        )}
      </div>
      <span className="text-[10px] text-[var(--muted)] shrink-0">Check-in</span>
      {hotel.rating != null && (
        <div className="flex items-center gap-0.5 shrink-0">
          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
          <span className="text-[10px] font-medium text-[var(--ink)]">{hotel.rating}</span>
        </div>
      )}
    </div>
  );
}
