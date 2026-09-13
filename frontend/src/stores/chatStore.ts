import { create } from 'zustand';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  widgets?: Widget[];
  toolActivities?: ToolActivity[];
  /** On user messages: the question_card question this message answered.
   *  Set client-side in handleAnswer and server-side in send_message. */
  answeredQuestion?: string;
  /** On assistant messages: suggestion chips emitted with the response. */
  suggestions?: string[];
}

export interface Widget {
  type: string;
  data: any;
}

export interface ToolActivity {
  callId: string;
  toolName: string;
  label: string;
  status: 'running' | 'finished' | 'error';
  summary?: string;
  error?: string | null;
  /** Backend progress group (e.g. 'place_search', 'day_build', 'extras').
   *  Activities sharing a group are rendered as one collapsible row. */
  group?: string;
}

/** Serialize messages for persistence (saved-trip chatHistory payloads).
 *  Preserves widgets, tool activities, answered-question markers and
 *  suggestions so a reopened chat can be fully rebuilt. */
export function serializeMessages(messages: ChatMessage[]): Record<string, any>[] {
  return messages.map((m) => {
    const out: Record<string, any> = {
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    };
    if (m.widgets?.length) out.widgets = m.widgets;
    if (m.toolActivities?.length) out.toolActivities = m.toolActivities;
    if (m.answeredQuestion) out.answeredQuestion = m.answeredQuestion;
    if (m.suggestions?.length) out.suggestions = m.suggestions;
    return out;
  });
}

interface ChatStore {
  messages: ChatMessage[];
  conversationId: string | null;
  isLoading: boolean;
  agentStatus: string | null;
  error: string | null;
  streamingText: string;
  toolActivities: ToolActivity[];
  /** Stores the last agent:response payload so components that miss the
   *  socket event (e.g. ChatPanel when socket wasn't joined yet) can
   *  react to it via a useEffect watching this field. */
  lastResponse: { data: any; ts: number } | null;
  /** Stores the last agent:widget payload so widgets delivered while
   *  ChatPanel's socket handler isn't registered (or replayed via
   *  replayMissedEvents) still restore activeWidget. conversationId is
   *  recorded so a widget from one conversation can't leak into another. */
  lastWidget: { widget: any; ts: number; conversationId?: string } | null;
  /** Question card that the backend checkpoint says is still awaiting an
   *  answer (pending LangGraph interrupt). Set by fetchTrip from the
   *  conversation endpoint's `pendingWidget`; consumed by buildChatRestore. */
  pendingWidget: any | null;

  setConversationId: (id: string | null) => void;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setLoading: (loading: boolean) => void;
  setAgentStatus: (status: string | null) => void;
  setError: (error: string | null) => void;
  appendStreamingText: (text: string) => void;
  setStreamingText: (text: string) => void;
  addToolActivity: (activity: ToolActivity) => void;
  updateToolActivity: (callId: string, update: Partial<ToolActivity>) => void;
  clearToolActivities: () => void;
  getToolActivities: () => ToolActivity[];
  /** Mark any still-'running' activities finished/error — called when a
   *  response (or stream failure) arrives so no row spins forever. */
  settleToolActivities: (failed?: boolean) => void;
  setLastResponse: (data: any) => void;
  setLastWidget: (widget: any, conversationId?: string) => void;
  setPendingWidget: (widget: any | null) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  conversationId: null,
  isLoading: false,
  agentStatus: null,
  error: null,
  streamingText: '',
  toolActivities: [],
  lastResponse: null,
  lastWidget: null,
  pendingWidget: null,

  setConversationId: (id) => set({ conversationId: id }),

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  setMessages: (msgs) => set({ messages: msgs }),

  setLoading: (loading) => set({ isLoading: loading }),

  setAgentStatus: (status) => set({ agentStatus: status }),

  setError: (error) => set({ error }),

  appendStreamingText: (text) => set((s) => ({ streamingText: s.streamingText + text })),

  setStreamingText: (text) => set({ streamingText: text }),

  addToolActivity: (activity) =>
    set((s) => {
      // Replace if callId already exists, otherwise append
      const existing = s.toolActivities.findIndex((a) => a.callId === activity.callId);
      if (existing >= 0) {
        const updated = [...s.toolActivities];
        updated[existing] = { ...updated[existing], ...activity };
        return { toolActivities: updated };
      }
      return { toolActivities: [...s.toolActivities, activity] };
    }),

  updateToolActivity: (callId, update) =>
    set((s) => ({
      toolActivities: s.toolActivities.map((a) =>
        a.callId === callId ? { ...a, ...update } : a
      ),
    })),

  clearToolActivities: () => set({ toolActivities: [] }),

  settleToolActivities: (failed) =>
    set((s) => ({
      toolActivities: s.toolActivities.map((a) =>
        a.status === 'running' ? { ...a, status: failed ? 'error' : 'finished' } : a
      ),
    })),

  getToolActivities: () => get().toolActivities,

  setLastResponse: (data: any) => set({ lastResponse: { data, ts: Date.now() } }),

  setLastWidget: (widget, conversationId) => set({ lastWidget: { widget, ts: Date.now(), conversationId } }),

  setPendingWidget: (widget) => set({ pendingWidget: widget }),

  reset: () => set({
    messages: [], conversationId: null, isLoading: false, agentStatus: null,
    error: null, streamingText: '', toolActivities: [], lastResponse: null,
    lastWidget: null, pendingWidget: null,
  }),
}));
