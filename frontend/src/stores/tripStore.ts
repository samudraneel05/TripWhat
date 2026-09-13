import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import { useChatStore, serializeMessages } from './chatStore';
import { chatApi, itineraryEditApi } from '../lib/api';
import { prefetchImages, extractImageUrls } from '../lib/image';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export interface TripCity {
  name: string;
  order: number;
  nights?: number;
}

export interface TripDates {
  start: string;
  end: string;
  assumed?: boolean;
  roughMonth?: string;
}

export interface TripState {
  status: 'planning' | 'upcoming' | 'completed' | 'archived';
  cities: TripCity[];
  dates?: TripDates;
  duration?: number;
  travelers?: { adults?: number; children?: number } | string;
  preferences?: string[];
  version: number;
  itinerary?: any;
  bookings?: any[];
}

export interface Trip {
  id: number;
  _id?: string;
  title?: string;
  tripState?: TripState;
  generatedItinerary?: any;
  cities?: any[];
  totalDays?: number;
  isUpcoming?: boolean;
  isCompleted?: boolean;
  tripStartDate?: string;
  tripEndDate?: string;
  chatHistory?: any[];
  conversationId?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface TripStore {
  trips: Trip[];
  tripState: TripState | null;
  loading: boolean;
  error: string | null;
  socket: Socket | null;
  pendingDiff: { tripState: TripState; changeSummary: any[] } | null;
  lastEventId: string | null;
  progressiveDays: { day: number; city: string; timeSlots: any[]; totalDays?: number }[] | null;

  fetchTrips: () => Promise<void>;
  fetchTrip: (id: string) => Promise<void>;
  createTrip: (data: Partial<Trip>) => Promise<Trip>;
  updateTrip: (id: string, data: Partial<Trip>) => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  setTripState: (state: TripState) => void;
  connectSocket: (conversationId?: string) => void;
  disconnectSocket: () => void;
  applyTripUpdate: (trip: Trip, changeSummary?: any[]) => void;
  acceptDiff: () => void;
  rejectDiff: () => void;
  replayMissedEvents: (conversationId: string) => Promise<void>;
  editItinerary: (conversationId: string, action: keyof typeof itineraryEditApi, data: any) => Promise<void>;
}

const getToken = () => localStorage.getItem('tripwhat_token');
const API_URL = import.meta.env.VITE_API_URL || '';

export const useTripStore = create<TripStore>((set, get) => ({
  trips: [],
  tripState: null,
  loading: false,
  error: null,
  socket: null,
  pendingDiff: null,
  lastEventId: null,
  progressiveDays: null,

  fetchTrips: async () => {
    set({ loading: true, error: null });
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/saved-trips`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to fetch trips (${res.status})`);
      const data = await res.json();
      const tripsList = Array.isArray(data) ? data : Array.isArray(data.savedTrips) ? data.savedTrips : Array.isArray(data.trips) ? data.trips : [];
      set({ trips: tripsList, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  fetchTrip: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/saved-trips/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to fetch trip (${res.status})`);
      const data = await res.json();
      set({ tripState: data.tripState, loading: false });
      if (data.conversationId) {
        useChatStore.getState().setConversationId(data.conversationId);
      }
      // Restore chat history. The conversation DB is the authoritative
      // record (the backend persists every turn, including widgets and tool
      // activities); the saved chatHistory is a client mirror that can lag a
      // turn behind. Use whichever is richer.
      const savedHistory = Array.isArray(data.chatHistory) ? data.chatHistory : [];
      let restored = savedHistory;
      // A question_card still awaiting an answer — the LangGraph checkpoint's
      // pending interrupt, surfaced by the conversation endpoint. Set BEFORE
      // setMessages so ChatPanel's restore effect picks it up.
      let pendingWidget: any = null;
      if (data.conversationId) {
        try {
          const histRes = await chatApi.getHistory(data.conversationId);
          const convMsgs = histRes.data?.messages || [];
          if (convMsgs.length >= restored.length) {
            restored = convMsgs;
          }
          pendingWidget = histRes.data?.pendingWidget || null;
        } catch {
          // Conversation may not exist — fall back to saved chatHistory
        }
      }
      useChatStore.getState().setPendingWidget(pendingWidget);
      if (restored.length) {
        useChatStore.getState().setMessages(restored);
      }
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  createTrip: async (data: Partial<Trip>) => {
    set({ loading: true, error: null });
    try {
      const token = getToken();
      const ts = (data.tripState || {}) as TripState;
      const { messages, conversationId } = useChatStore.getState();
      const payload = {
        title: data.title || ts.cities?.map((c: any) => c.name).join(' → ') || 'Untitled trip',
        startDate: ts.dates?.start || new Date().toISOString(),
        cities: (ts.cities || []).map((c: any) => ({ name: c.name, days: c.nights ? c.nights + 1 : 1 })),
        totalDays: ts.duration || 1,
        people: 1,
        travelType: 'balanced',
        budget: null,
        generatedItinerary: ts.itinerary || { days: [] },
        tripState: ts,
        chatHistory: serializeMessages(messages),
        conversationId: conversationId,
      };
      const res = await fetch(`${API_URL}/api/saved-trips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed to create trip (${res.status})`);
      const result = await res.json();
      const trip = result.savedTrip || result;
      set({ tripState: trip.tripState || ts, loading: false });
      return trip;
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  updateTrip: async (id: string, data: Partial<Trip>) => {
    try {
      const token = getToken();
      const { messages, conversationId } = useChatStore.getState();
      const payload = {
        ...data,
        chatHistory: serializeMessages(messages),
        conversationId: conversationId,
      };
      const res = await fetch(`${API_URL}/api/saved-trips/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed to update trip (${res.status})`);
      const result = await res.json();
      const updated = result.savedTrip || result;
      set({ tripState: updated.tripState });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  deleteTrip: async (id: string) => {
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/saved-trips/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to delete trip (${res.status})`);
      set((s) => ({ trips: s.trips.filter((t) => String(t.id) !== id) }));
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  setTripState: (state: TripState) => {
    set({ tripState: state });
    // Background-prefetch all itinerary images through the proxy
    const urls = extractImageUrls(state);
    if (urls.length > 0) prefetchImages(urls);
  },

  connectSocket: (conversationId?: string) => {
    const existing = get().socket;
    if (existing) {
      if (conversationId) {
        // Replay missed events before joining the room — events may have been
        // emitted between send_message starting the background task and us
        // joining the room.
        get().replayMissedEvents(conversationId).then(() => {
          existing.emit('join:conversation', conversationId);
        });
      }
      return;
    }

    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on('connect', async () => {
      if (conversationId) {
        // Replay missed events before joining the room for live updates
        await get().replayMissedEvents(conversationId);
        socket.emit('join:conversation', conversationId);
      }
    });

    socket.on('reconnect', async () => {
      if (conversationId) {
        await get().replayMissedEvents(conversationId);
        socket.emit('join:conversation', conversationId);
      }
    });

    socket.on('trip:updated', (data: { trip: Trip; changeSummary?: any[] }) => {
      if (data.changeSummary && data.changeSummary.length > 0) {
        // Intercept as pending diff — user must accept/reject
        set({
          pendingDiff: {
            tripState: data.trip.tripState || data.trip as any,
            changeSummary: data.changeSummary,
          },
        });
      } else {
        get().applyTripUpdate(data.trip, data.changeSummary);
      }
    });

    // Streaming events from agent
    socket.on('agent:token', (data: { conversationId: string; text: string; eventId?: string }) => {
      if (data.eventId) set({ lastEventId: data.eventId });
      useChatStore.getState().appendStreamingText(data.text);
    });

    socket.on('agent:status', (data: { conversationId: string; status: string }) => {
      useChatStore.getState().setAgentStatus(data.status);
    });

    // Record widget events at the store level too, so widgets emitted while
    // ChatPanel's own handler isn't registered (e.g. before it mounts) still
    // reach the UI via the lastWidget subscription.
    socket.on('agent:widget', (data: { conversationId: string; widget: any; eventId?: string }) => {
      if (data.eventId) set({ lastEventId: data.eventId });
      if (data.widget) {
        useChatStore.getState().setLastWidget(data.widget, data.conversationId);
      }
    });

    socket.on('agent:tool_start', (data: {
      conversationId: string; toolName: string; label: string;
      callId: string; input?: any; group?: string; eventId?: string;
    }) => {
      if (data.eventId) set({ lastEventId: data.eventId });
      useChatStore.getState().addToolActivity({
        callId: data.callId,
        toolName: data.toolName,
        label: data.label,
        status: 'running',
        group: data.group,
      });
    });

    socket.on('agent:tool_end', (data: {
      conversationId: string; toolName: string; label: string;
      callId: string; summary?: string; error?: string | null; eventId?: string;
    }) => {
      if (data.eventId) set({ lastEventId: data.eventId });
      useChatStore.getState().updateToolActivity(data.callId, {
        status: data.error ? 'error' : 'finished',
        summary: data.summary,
        error: data.error,
      });
    });

    socket.on('agent:itinerary_day', (data: {
      conversationId: string; day: number; city: string;
      timeSlots: any[]; totalDays: number; eventId?: string;
    }) => {
      if (data.eventId) set({ lastEventId: data.eventId });
      set((state) => {
        const current = state.progressiveDays || [];
        const filtered = current.filter(d => d.day !== data.day);
        return {
          progressiveDays: [...filtered, {
            day: data.day,
            city: data.city,
            timeSlots: data.timeSlots,
            totalDays: data.totalDays,
          }],
        };
      });
    });

    socket.on('agent:tripState', (data: { conversationId: string; tripState: any; changeSummary?: any[] }) => {
      if (data.tripState) {
        if (data.changeSummary && data.changeSummary.length > 0) {
          set({
            pendingDiff: {
              tripState: data.tripState,
              changeSummary: data.changeSummary,
            },
          });
        } else {
          get().setTripState(data.tripState);
        }
      }
    });

    socket.on('agent:response', (data: any) => {
      const chatStore = useChatStore.getState();

      if (data.conversationId && !chatStore.conversationId) {
        chatStore.setConversationId(data.conversationId);
      }

      if (data.tripState) {
        get().setTripState(data.tripState);
      }

      // Clear progressive days — full itinerary has arrived
      set({ progressiveDays: null });

      // Store the response so ChatPanel can process it via useEffect
      // if its socket handler missed the event (e.g. socket wasn't joined
      // to the room yet when the event was emitted).
      // A completed response also supersedes any earlier widget event.
      useChatStore.setState({ lastWidget: null });
      // Keep pendingWidget in sync with the turn's outcome — a turn that ends
      // on a question_card leaves a pending interrupt in the checkpoint.
      const qWidget = (data.widgets || []).find((w: any) => w?.type === 'question_card');
      useChatStore.setState({ pendingWidget: qWidget || null });
      chatStore.setLastResponse(data);
      // The turn is over — settle any activities whose tool_end never
      // arrived (e.g. the stream died mid-tool) so no row spins forever.
      chatStore.settleToolActivities(!!data.error);

      // Clear streaming state. ChatPanel's agent:response handler also
      // does this (deferred via setTimeout), but we do it here as a
      // fallback in case ChatPanel's handler isn't registered yet (e.g.
      // on NewTripPage where the socket is created after ChatPanel mounts).
      // The setTimeout in ChatPanel ensures its processResponse() runs
      // before its own clear, but this fallback ensures isLoading is
      // always cleared even if ChatPanel's handler misses the event.
      setTimeout(() => {
        useChatStore.getState().setStreamingText('');
        useChatStore.getState().setLoading(false);
        useChatStore.getState().setAgentStatus(null);
      }, 0);
    });

    set({ socket });
  },

  disconnectSocket: () => {
    // Keep socket alive — only disconnect on explicit logout.
    // Component unmounts should NOT kill the stream.
  },

  replayMissedEvents: async (conversationId: string) => {
    try {
      const { lastEventId } = get();
      const res = await chatApi.getStreamEvents(conversationId, lastEventId || undefined);
      const { events, isActive, lastEventId: newLastId } = res.data;

      if (!events || events.length === 0) {
        if (!isActive) {
          // Stream is done — clear any stale loading state
          useChatStore.getState().setLoading(false);
          useChatStore.getState().setAgentStatus(null);
        }
        return;
      }

      const chatStore = useChatStore.getState();

      // If stream is still active, set loading state
      if (isActive) {
        chatStore.setLoading(true);
        chatStore.setAgentStatus('Reconnecting to stream...');
      }

      // Widget + response events are order-sensitive: a response supersedes
      // any widget emitted earlier in the batch, and only the LAST response
      // should be forwarded (replayed historical responses are already in
      // the persisted messages — forwarding each would re-append them).
      let pendingWidget: any = null;
      let pendingResponse: any = null;

      // Staleness guard: never re-apply stream events older than the
      // persisted message history (e.g. on reopen after a full page reload,
      // where the DB-backed messages are already restored). Events carry
      // server timestamps; a replayed event strictly older than the newest
      // message is guaranteed stale.
      const persistedTs = (useChatStore.getState().messages || []).reduce(
        (max, m) => {
          const t = m.timestamp ? Date.parse(m.timestamp) : 0;
          return Number.isFinite(t) && t > max ? t : max;
        },
        0,
      );
      const eventTs = (e: any) => Date.parse(e?.timestamp || '') || 0;

      for (const event of events) {
        const data = event.data;
        switch (event.type) {
          case 'token':
            chatStore.appendStreamingText(data.text || '');
            break;
          case 'status':
            chatStore.setAgentStatus(data.status || '');
            break;
          case 'tripState':
            if (data.tripState) {
              get().setTripState(data.tripState);
            }
            break;
          case 'widget':
            // Widget events from ask_question tool — surface via lastWidget
            // so ChatPanel restores the pending QuestionCard on reconnect.
            // Only the trailing widget matters; a later response clears it.
            pendingWidget = { widget: data.widget || null, ts: eventTs(event) };
            break;
          case 'tool_start':
            chatStore.addToolActivity({
              callId: data.callId,
              toolName: data.toolName,
              label: data.label,
              status: 'running',
              group: data.group,
            });
            break;
          case 'tool_end':
            chatStore.updateToolActivity(data.callId, {
              status: data.error ? 'error' : 'finished',
              summary: data.summary,
              error: data.error,
            });
            break;
          case 'itinerary_day':
            set((state) => {
              const current = state.progressiveDays || [];
              const filtered = current.filter(d => d.day !== data.day);
              return {
                progressiveDays: [...filtered, {
                  day: data.day,
                  city: data.city,
                  timeSlots: data.timeSlots,
                  totalDays: data.totalDays,
                }],
              };
            });
            break;
          case 'response':
            chatStore.setStreamingText('');
            chatStore.setLoading(false);
            chatStore.setAgentStatus(null);
            chatStore.settleToolActivities(!!data.error);
            if (data.tripState) {
              get().setTripState(data.tripState);
            }
            // Clear progressive days — full itinerary has arrived
            set({ progressiveDays: null });
            // Response supersedes any widget emitted earlier this batch.
            pendingWidget = null;
            pendingResponse = { data, ts: eventTs(event) };
            break;
        }
      }

      // Apply the tail state after the batch: a trailing widget restores the
      // pending QuestionCard; the last response lets ChatPanel finish the
      // turn. Both are skipped when they predate the persisted history —
      // the restored messages are then the source of truth.
      if (pendingResponse && pendingResponse.ts > persistedTs) {
        useChatStore.setState({ lastWidget: null });
        chatStore.setLastResponse(pendingResponse.data);
      }
      if (pendingWidget && pendingWidget.ts > persistedTs) {
        chatStore.setLastWidget(pendingWidget.widget, conversationId);
      }

      if (newLastId) {
        set({ lastEventId: newLastId });
      }
    } catch (err) {
      console.warn('[tripStore] Failed to replay missed events:', err);
    }
  },

  applyTripUpdate: (trip: Trip, changeSummary?: any[]) => {
    set({ tripState: trip.tripState });
    if (changeSummary) {
      useTripStore.getState();
    }
  },

  acceptDiff: () => {
    const { pendingDiff } = get();
    if (pendingDiff) {
      set({ tripState: pendingDiff.tripState, pendingDiff: null });
    }
  },

  rejectDiff: () => set({ pendingDiff: null }),

  editItinerary: async (conversationId: string, action: keyof typeof itineraryEditApi, data: any) => {
    try {
      const res = await itineraryEditApi[action](conversationId, data);
      if (res.data?.tripState) {
        set({ tripState: res.data.tripState });
      }
    } catch (err) {
      console.error('[tripStore] editItinerary failed:', err);
      throw err;
    }
  },
}));
