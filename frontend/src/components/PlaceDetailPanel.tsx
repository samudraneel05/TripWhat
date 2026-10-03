import { useEffect, useRef, useState } from 'react';
import {
  X, Star, MapPin, Phone, Globe, Clock, ChevronLeft, ChevronRight,
  Navigation, ExternalLink, ArrowRight, Heart, Plus, Check, Loader2, MessageCircleQuestion,
} from 'lucide-react';
import { placesApi, savedApi, itineraryEditApi } from '../lib/api';
import { useTripStore } from '../stores/tripStore';
import { useChatStore } from '../stores/chatStore';
import { PlaceMiniMap } from './map/PlaceMiniMap';

interface Activity {
  productCode: string;
  title: string;
  imageUrl: string;
  rating: number | null;
  reviewCount: number | null;
  fromPrice: number | null;
  currency: string;
  productUrl: string;
}

interface PlaceDetails {
  placeId: string;
  name: string;
  address: string;
  phoneNumber: string;
  internationalPhone: string;
  website: string;
  mapsUrl: string;
  rating: number | null;
  userRatingsTotal: number;
  photos: string[];
  reviews: {
    author: string;
    rating: number;
    text: string;
    time: number;
    profilePhoto: string;
    language: string;
  }[];
  openingHours: string[];
  isOpen: boolean | null;
  priceLevel: number | null;
  businessStatus: string;
  types: string[];
  coordinates: { lat: number; lng: number };
  description: string;
  area: string;
  locality: string;
  country: string;
  alternates: {
    placeId: string;
    name: string;
    address: string;
    rating: number | null;
    coordinates: { lat: number; lng: number };
  }[];
  activities?: Activity[];
}

interface Props {
  placeId: string;
  onClose: () => void;
  onSelectAlternate?: (placeId: string) => void;
  onAskQuestion?: (question: string) => void;
}

const PRICE_LABELS = ['', 'Inexpensive', 'Moderate', 'Expensive', 'Very Expensive'];

const TYPE_LABELS: Record<string, string> = {
  tourist_attraction: 'Attraction',
  restaurant: 'Restaurant',
  lodging: 'Hotel',
  museum: 'Museum',
  amusement_park: 'Theme Park',
  cafe: 'Cafe',
  bar: 'Bar',
  shopping_mall: 'Shopping',
  park: 'Park',
  church: 'Landmark',
  hindu_temple: 'Temple',
  mosque: 'Mosque',
  art_gallery: 'Gallery',
  point_of_interest: 'Point of Interest',
  establishment: 'Establishment',
};

type TabId = 'overview' | 'activities' | 'reviews' | 'location';

export function PlaceDetailPanel({ placeId, onClose, onSelectAlternate, onAskQuestion }: Props) {
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [saveState, setSaveState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [addState, setAddState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<TabId, HTMLElement | null>>>({});

  const conversationId = useChatStore((s) => s.conversationId);
  const tripState = useTripStore((s) => s.tripState);
  const hasItinerary = !!tripState?.itinerary;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPhotoIndex(0);
    setActiveTab('overview');
    setSaveState('idle');
    setAddState('idle');
    placesApi
      .details(placeId)
      .then((res) => {
        if (!cancelled) setDetails(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.detail || 'Failed to load details');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [placeId]);

  const tabs: { id: TabId; label: string }[] = [];
  if (details) {
    tabs.push({ id: 'overview', label: 'Overview' });
    if ((details.activities?.length || 0) + details.alternates.length > 0)
      tabs.push({ id: 'activities', label: 'Activities' });
    if (details.reviews.length > 0) tabs.push({ id: 'reviews', label: 'Reviews' });
    if (details.coordinates?.lat != null) tabs.push({ id: 'location', label: 'Location' });
  }

  // Scroll-spy — highlight the tab whose section is nearest the top.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !details) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const id = e.target.getAttribute('data-section') as TabId | null;
            if (id) setActiveTab(id);
          }
        }
      },
      { root, rootMargin: '-15% 0px -70% 0px' }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [details, tabs.length]);

  const scrollTo = (id: TabId) => {
    setActiveTab(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const displayType = details?.types
    ?.map((t) => TYPE_LABELS[t])
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');

  const handleSave = async () => {
    if (!details || saveState !== 'idle') return;
    setSaveState('busy');
    try {
      await savedApi.save({
        itemType: 'place',
        name: details.name,
        data: {
          placeId: details.placeId,
          address: details.address,
          imageUrl: details.photos[0] || '',
          rating: details.rating,
          coordinates: details.coordinates,
        },
        tripId: (tripState as any)?.id,
      });
      setSaveState('done');
    } catch {
      setSaveState('idle');
    }
  };

  const handleAddToTrip = async () => {
    if (!details || !conversationId || !hasItinerary || addState === 'busy') return;
    setAddState('busy');
    try {
      const city =
        (tripState?.cities?.[0] as any)?.name ||
        details.locality ||
        details.area ||
        details.country ||
        '';
      const res = await itineraryEditApi.add(conversationId, {
        place_name: details.name,
        city,
        day: 1,
      });
      if (res.data?.tripState) useTripStore.getState().applyTripUpdate(res.data.tripState);
      setAddState('done');
    } catch {
      setAddState('err');
    }
  };

  const askChips = details
    ? [
        `What's the best time to visit ${details.name}?`,
        `How do I get to ${details.name}?`,
        `What else is near ${details.name}?`,
      ]
    : [];

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div
      className="absolute inset-0 z-30 bg-[var(--surface)] flex flex-col overflow-hidden"
      style={{
        transform: mounted ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 250ms var(--ease-drawer)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--border)] shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSave}
            disabled={!details || saveState === 'busy'}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-50 ${
              saveState === 'done'
                ? 'bg-[var(--sage)] text-[var(--ink)]'
                : 'border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--ink)]'
            }`}
            title="Save to Saved Places"
          >
            {saveState === 'done' ? <Check className="w-3 h-3" /> : saveState === 'busy' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Heart className="w-3 h-3" />}
            {saveState === 'done' ? 'Saved' : 'Save'}
          </button>
          {hasItinerary && (
            <button
              onClick={handleAddToTrip}
              disabled={!details || addState === 'busy'}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-50 ${
                addState === 'done'
                  ? 'bg-[var(--ink)] text-white'
                  : addState === 'err'
                    ? 'border border-red-300 text-red-500'
                    : 'bg-[var(--ink)] text-white hover:opacity-90'
              }`}
            >
              {addState === 'done' ? <Check className="w-3 h-3" /> : addState === 'busy' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              {addState === 'done' ? 'Added' : addState === 'err' ? 'Retry' : 'Add to trip'}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[var(--sage)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab bar — sticky; click scrolls, scroll highlights */}
      {details && tabs.length > 1 && (
        <div className="flex items-center gap-1 px-4 h-10 border-b border-[var(--border)] shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => scrollTo(t.id)}
              className={`px-2.5 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors duration-150 ${
                activeTab === t.id
                  ? 'border-[var(--ink)] text-[var(--ink)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-[560px] mx-auto pb-8">
          {loading ? (
            <PanelSkeleton />
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full px-6 pt-24 text-center">
              <p className="text-sm text-red-500 mb-2">{error}</p>
              <button
                onClick={onClose}
                className="text-xs text-[var(--muted)] hover:text-[var(--ink)] underline"
              >
                Go back
              </button>
            </div>
          ) : details ? (
            <>
              {/* Photo carousel */}
              {details.photos.length > 0 && (
                <div className="relative h-64 bg-[var(--sage)] shrink-0">
                  <img
                    src={details.photos[photoIndex]}
                    alt={details.name}
                    className="w-full h-full object-cover"
                  />
                  {details.photos.length > 1 && (
                    <>
                      <button
                        onClick={() => setPhotoIndex((i) => (i - 1 + details.photos.length) % details.photos.length)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setPhotoIndex((i) => (i + 1) % details.photos.length)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                        {details.photos.map((_, i) => (
                          <span
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full transition-colors ${
                              i === photoIndex ? 'bg-white' : 'bg-white/40'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/40 text-white text-[10px]">
                        {photoIndex + 1}/{details.photos.length}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Title section */}
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <h2 className="text-base font-semibold text-[var(--ink)] leading-tight">
                  {details.name}
                </h2>
                {displayType && (
                  <p className="text-[10px] text-[var(--muted)] uppercase tracking-wide mt-1">
                    {displayType}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  {details.rating != null && (
                    <div className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span className="text-xs font-medium text-[var(--ink)]">{details.rating}</span>
                      {details.userRatingsTotal > 0 && (
                        <span className="text-[10px] text-[var(--muted)]">
                          ({details.userRatingsTotal.toLocaleString()} reviews)
                        </span>
                      )}
                    </div>
                  )}
                  {details.priceLevel != null && details.priceLevel > 0 && (
                    <span className="text-[10px] text-[var(--muted)]">
                      {'$'.repeat(details.priceLevel)} · {PRICE_LABELS[details.priceLevel]}
                    </span>
                  )}
                  {details.isOpen != null && (
                    <span
                      className={`text-[10px] font-medium ${
                        details.isOpen ? 'text-green-600' : 'text-red-500'
                      }`}
                    >
                      {details.isOpen ? 'Open now' : 'Closed'}
                    </span>
                  )}
                  {details.businessStatus && details.businessStatus !== 'OPERATIONAL' && (
                    <span className="text-[10px] text-amber-600 capitalize">
                      {details.businessStatus.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  )}
                </div>
              </div>

              {/* ===== Overview ===== */}
              <section
                data-section="overview"
                ref={(el) => { sectionRefs.current.overview = el; }}
                className="border-b border-[var(--border)]"
              >
                {details.description && (
                  <p className="px-4 pt-3 text-xs text-[var(--ink)] leading-relaxed">
                    {details.description}
                  </p>
                )}

                <div className="px-4 py-3 space-y-2">
                  {details.address && <InfoRow icon={MapPin} text={details.address} />}
                  {(details.locality || details.area || details.country) && (
                    <InfoRow
                      icon={Navigation}
                      text={[details.area, details.locality, details.country].filter(Boolean).join(', ')}
                    />
                  )}
                  {(details.phoneNumber || details.internationalPhone) && (
                    <a
                      href={`tel:${details.internationalPhone || details.phoneNumber}`}
                      className="flex items-start gap-2 text-xs text-[var(--ink)] hover:text-[var(--lavender)] transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5 text-[var(--muted)] shrink-0 mt-0.5" />
                      <span>{details.internationalPhone || details.phoneNumber}</span>
                    </a>
                  )}
                  {details.website && (
                    <a
                      href={details.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 text-xs text-[var(--ink)] hover:text-[var(--lavender)] transition-colors"
                    >
                      <Globe className="w-3.5 h-3.5 text-[var(--muted)] shrink-0 mt-0.5" />
                      <span className="truncate">{details.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                      <ExternalLink className="w-3 h-3 text-[var(--muted)] shrink-0 mt-0.5" />
                    </a>
                  )}
                </div>

                {details.openingHours.length > 0 && (
                  <div className="px-4 pb-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Clock className="w-3.5 h-3.5 text-[var(--muted)]" />
                      <span className="text-xs font-medium text-[var(--ink)]">Hours</span>
                    </div>
                    <div className="space-y-0.5">
                      {details.openingHours.map((h, i) => (
                        <p key={i} className="text-[10px] text-[var(--muted)] leading-relaxed">{h}</p>
                      ))}
                    </div>
                  </div>
                )}

                {onAskQuestion && (
                  <div className="px-4 pb-4">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <MessageCircleQuestion className="w-3.5 h-3.5 text-[var(--muted)]" />
                      <span className="text-xs font-medium text-[var(--ink)]">Ask about this place</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {askChips.map((q) => (
                        <button
                          key={q}
                          onClick={() => onAskQuestion(q)}
                          className="px-2.5 py-1.5 rounded-full border border-[var(--border)] text-[10px] text-[var(--ink)] hover:border-[var(--ink)] transition-colors active:scale-95"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* ===== Activities (Viator) + Similar nearby ===== */}
              {(details.activities?.length || 0) + details.alternates.length > 0 && (
                <section
                  data-section="activities"
                  ref={(el) => { sectionRefs.current.activities = el; }}
                  className="px-4 py-3 border-b border-[var(--border)]"
                >
                  {details.activities && details.activities.length > 0 && (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-[var(--ink)]">
                          Tours & activities here
                        </span>
                        <span className="text-[9px] text-[var(--muted)]">via Viator</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {details.activities.map((a) => (
                          <a
                            key={a.productCode}
                            href={a.productUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface)] transition-shadow hover:shadow-md active:scale-[0.98]"
                          >
                            <div className="aspect-[4/3] bg-[var(--sage)]">
                              {a.imageUrl && (
                                <img
                                  src={a.imageUrl}
                                  alt={a.title}
                                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                  loading="lazy"
                                />
                              )}
                            </div>
                            <div className="px-2 py-1.5">
                              <p className="text-[11px] font-medium text-[var(--ink)] leading-snug line-clamp-2">
                                {a.title}
                              </p>
                              <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--muted)]">
                                <span className="flex items-center gap-0.5">
                                  {a.rating != null && (
                                    <>
                                      <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                                      {a.rating.toFixed(1)}
                                      {a.reviewCount ? ` (${a.reviewCount.toLocaleString()})` : ''}
                                    </>
                                  )}
                                </span>
                                {a.fromPrice != null && (
                                  <span className="font-medium text-[var(--ink)]">
                                    from ${Math.round(a.fromPrice)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </a>
                        ))}
                      </div>
                    </>
                  )}

                  {details.alternates.length > 0 && (
                    <>
                      <span className="text-xs font-medium text-[var(--ink)] block mt-4 mb-2">
                        Similar nearby
                      </span>
                      <div className="space-y-1.5">
                        {details.alternates.map((alt) => (
                          <button
                            key={alt.placeId}
                            onClick={() => onSelectAlternate?.(alt.placeId)}
                            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[var(--sage)] transition-colors text-left group active:scale-[0.98]"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-[var(--ink)] truncate">{alt.name}</p>
                              {alt.address && (
                                <p className="text-[10px] text-[var(--muted)] truncate mt-0.5">{alt.address}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              {alt.rating != null && (
                                <div className="flex items-center gap-0.5">
                                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                  <span className="text-[10px] text-[var(--muted)]">{alt.rating}</span>
                                </div>
                              )}
                              <ArrowRight className="w-3 h-3 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              )}

              {/* ===== Reviews ===== */}
              {details.reviews.length > 0 && (
                <section
                  data-section="reviews"
                  ref={(el) => { sectionRefs.current.reviews = el; }}
                  className="px-4 py-3 border-b border-[var(--border)]"
                >
                  {details.rating != null && (
                    <div className="flex items-baseline gap-2 mb-3">
                      <span className="text-2xl font-semibold text-[var(--ink)]">{details.rating}</span>
                      <div className="flex items-center gap-0.5">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        <span className="text-[10px] text-[var(--muted)]">
                          · {details.userRatingsTotal.toLocaleString()} reviews
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-3">
                    {details.reviews.map((r, i) => (
                      <div key={i} className="flex gap-2.5">
                        {r.profilePhoto ? (
                          <img
                            src={r.profilePhoto}
                            alt={r.author}
                            className="w-6 h-6 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-[var(--sage)] flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-medium text-[var(--muted)]">
                              {r.author.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium text-[var(--ink)] truncate">
                              {r.author}
                            </span>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                              <span className="text-[10px] text-[var(--muted)]">{r.rating}</span>
                            </div>
                          </div>
                          <p className="text-[10px] text-[var(--muted)] leading-relaxed mt-0.5 line-clamp-3">
                            {r.text}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ===== Location ===== */}
              {details.coordinates?.lat != null && details.coordinates?.lng != null && (
                <section
                  data-section="location"
                  ref={(el) => { sectionRefs.current.location = el; }}
                  className="px-4 py-3"
                >
                  <PlaceMiniMap coordinates={details.coordinates} name={details.name} />
                  {details.mapsUrl && (
                    <a
                      href={details.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center gap-1.5 text-xs text-[var(--ink)] hover:text-[var(--lavender)] transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5 text-[var(--muted)]" />
                      Open in Google Maps
                      <ExternalLink className="w-3 h-3 text-[var(--muted)]" />
                    </a>
                  )}
                </section>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-[var(--muted)] shrink-0 mt-0.5" />
      <span className="text-xs text-[var(--ink)] leading-relaxed">{text}</span>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-64 bg-[var(--sage)]" />
      <div className="px-4 py-3 space-y-2 border-b border-[var(--border)]">
        <div className="h-4 w-2/3 rounded bg-[var(--sage)]" />
        <div className="h-3 w-1/3 rounded bg-[var(--sage)]" />
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="h-3 w-full rounded bg-[var(--sage)]" />
        <div className="h-3 w-5/6 rounded bg-[var(--sage)]" />
        <div className="h-3 w-4/6 rounded bg-[var(--sage)]" />
      </div>
      <div className="px-4 grid grid-cols-2 gap-2">
        <div className="aspect-[4/3] rounded-lg bg-[var(--sage)]" />
        <div className="aspect-[4/3] rounded-lg bg-[var(--sage)]" />
      </div>
    </div>
  );
}
