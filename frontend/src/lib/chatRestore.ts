import type { ChatMessage, ToolActivity } from '../stores/chatStore';

export type ChatEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; widgets?: any[]; toolActivities?: ToolActivity[] }
  | { kind: 'answered'; question: string; answerLabel: string };

export interface ChatRestore {
  entries: ChatEntry[];
  /** Pending question_card widget when the last assistant turn asked a
   *  question that was never answered. */
  activeWidget: any | null;
  itinerarySummary: any | null;
  flightCards: any[];
  searchResults: any | null;
  assistantText: string;
  suggestions: string[];
}

const findWidget = (m: ChatMessage, type: string) =>
  (m.widgets || []).find((w: any) => w?.type === type);

/**
 * Rebuild the full ChatPanel UI state from persisted messages.
 *
 * Mirrors what the live pipeline (handleSend / handleAnswer /
 * processResponse) produces:
 *  - user msgs → user entries; user msgs answering a question_card →
 *    'answered' rows (via `answeredQuestion` set server-side, or the
 *    heuristic fallback of a user msg following a question_card assistant msg)
 *  - assistant msgs → assistant entries carrying widgets + toolActivities
 *  - the LAST assistant msg drives the bottom-of-chat state exactly like
 *    processResponse does: question_card → activeWidget, search_results →
 *    searchResults, itinerary_summary → itinerarySummary (persisted from the
 *    most recent turn that emitted one), flight_card → flightCards,
 *    suggestions → chips.
 */
/**
 * `pendingWidget` — a question_card the backend checkpoint reports as still
 * awaiting an answer (a pending LangGraph interrupt). Authoritative: if set,
 * the QuestionCard is re-armed even when the persisted messages don't carry
 * the widget (e.g. conversations persisted before widgets were stored).
 */
export function buildChatRestore(messages: ChatMessage[], pendingWidget?: any): ChatRestore {
  const entries: ChatEntry[] = [];
  let activeWidget: any = null;
  let itinerarySummary: any = null;
  let flightCards: any[] = [];
  let searchResults: any = null;
  let assistantText = '';
  let suggestions: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    if (m.role === 'user') {
      const prev = i > 0 ? messages[i - 1] : undefined;
      const prevQ =
        prev && prev.role === 'assistant' ? findWidget(prev, 'question_card') : undefined;
      const question = m.answeredQuestion || prevQ?.data?.question;
      if (question && (prevQ || m.answeredQuestion)) {
        entries.push({ kind: 'answered', question, answerLabel: m.content });
      } else {
        entries.push({ kind: 'user', text: m.content });
      }
      continue;
    }

    // assistant message
    const widgets = m.widgets || [];
    entries.push({
      kind: 'assistant',
      text: m.content,
      widgets,
      toolActivities: m.toolActivities,
    });

    // itinerary_summary persists once emitted (same as the live
    // itinerarySummary state — only set, never cleared by later turns).
    const sWidget = findWidget(m, 'itinerary_summary');
    if (sWidget) {
      itinerarySummary = sWidget.data;
      const flights = widgets.filter((w: any) => w?.type === 'flight_card');
      if (flights.length > 0) {
        flightCards = flights.map((w: any) => w.data);
      }
    }

    const isLast = i === messages.length - 1;
    if (isLast) {
      // Mirror processResponse's widget handling for the latest turn.
      const qWidget = findWidget(m, 'question_card');
      const srWidget = findWidget(m, 'search_results');
      assistantText = m.content || '';
      searchResults = srWidget ? srWidget.data : null;
      suggestions = m.suggestions || [];
      const flights = widgets.filter((w: any) => w?.type === 'flight_card');
      if (flights.length > 0) {
        flightCards = flights.map((w: any) => w.data);
      }
      // A trailing question_card means the question was never answered —
      // restore the pending QuestionCard. Matches processResponse: the
      // question card is not vetoed by other widgets on the same turn.
      if (qWidget) {
        activeWidget = qWidget;
      }
    }
  }

  // The checkpoint's pending interrupt is the source of truth — if it says a
  // question is still open, surface it even when the persisted messages lack
  // the trailing question_card widget.
  if (pendingWidget && !activeWidget) {
    activeWidget = pendingWidget;
  }

  return {
    entries,
    activeWidget,
    itinerarySummary,
    flightCards,
    searchResults,
    assistantText,
    suggestions,
  };
}
