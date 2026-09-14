import { useRef, useState, useEffect } from 'react';
import { ArrowUp, Sparkles, Mic, MoreHorizontal, Share2, Activity } from 'lucide-react';
import { useChatStore, type ToolActivity } from '../../stores/chatStore';
import { useTripStore } from '../../stores/tripStore';
import { chatApi } from '../../lib/api';
import { QuestionCard, CompletedQuestion } from './widgets/QuestionCard';
import { ItinerarySummary } from './widgets/ItinerarySummary';
import { SearchResults } from './widgets/SearchResults';
import { ChatMarkdown } from '../../lib/chatMarkdown';
import { buildChatRestore } from '../../lib/chatRestore';
import { ToolActivityBar } from './widgets/ToolActivityBar';
import { FlightCard } from '../FlightCard';

interface ChatPanelProps {
  title?: string;
  tripState?: any;
  onItineraryBuilt?: (tripState: any) => void;
  onTripStateUpdate?: (tripState: any) => void;
  onSelectPlace?: (placeId: string) => void;
  onSelectFlight?: (flight: any) => void;
  initialMessage?: string;
  emptyStatePrompts?: string[];
}

type ChatEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; widgets?: any[]; toolActivities?: ToolActivity[] }
  | { kind: 'answered'; question: string; answerLabel: string };

export function ChatPanel({
  title = 'New trip',
  tripState,
  onItineraryBuilt,
  onTripStateUpdate,
  onSelectPlace,
  onSelectFlight,
  initialMessage,
  emptyStatePrompts = [
    'Plan a 5-day Japan trip visiting Tokyo and Kyoto',
    'I want to explore Paris for a weekend',
    'Help me plan a beach vacation in Bali',
  ],
}: ChatPanelProps) {
  const {
    conversationId, isLoading, agentStatus, streamingText, toolActivities,
    setConversationId, setLoading, setAgentStatus, setStreamingText,
    clearToolActivities, getToolActivities,
    reset,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [activeWidget, setActiveWidget] = useState<any>(null);
  const [assistantText, setAssistantText] = useState<string>('');
  const [itinerarySummary, setItinerarySummary] = useState<any>(null);
  const [flightCards, setFlightCards] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hasStarted, setHasStarted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasSentInitial = useRef(false);

  // Restore the full chat UI from persisted messages. Runs on mount AND
  // whenever the store's messages are replaced wholesale (e.g. fetchTrip
  // resolving after ChatPanel has already mounted — the old mount-only
  // effect missed that and left reopened chats empty). A pure append is
  // skipped because live handlers already keep chatEntries in sync, so
  // rebuilding would only clobber in-flight UI.
  const messages = useChatStore((s) => s.messages);
  const prevMessagesRef = useRef<typeof messages | null>(null);

  useEffect(() => {
    const prev = prevMessagesRef.current;
    prevMessagesRef.current = messages;

    if (!messages || messages.length === 0) {
      if (prev === null) {
        // Mount-time: clean stale store state for a fresh chat.
        reset();
      } else if (prev.length > 0) {
        // Store was reset mid-session — clear the restored UI.
        setChatEntries([]);
        setHasStarted(false);
        setActiveWidget(null);
        setAssistantText('');
        setItinerarySummary(null);
        setFlightCards([]);
        setSearchResults(null);
        setSuggestions([]);
      }
      return;
    }

    if (prev && prev.length > 0 && messages.length >= prev.length) {
      let prefixSame = true;
      for (let i = 0; i < prev.length; i++) {
        if (messages[i] !== prev[i]) { prefixSame = false; break; }
      }
      // Pure append (or no-op) → live handlers already updated the UI.
      if (prefixSame) return;
    }

    // pendingWidget comes from the conversation endpoint — the checkpoint's
    // pending interrupt. It's set on the store before setMessages, so read it
    // imperatively here (the effect only re-runs on messages changes).
    const restored = buildChatRestore(messages, useChatStore.getState().pendingWidget);
    setChatEntries(restored.entries);
    setHasStarted(restored.entries.length > 0);
    setActiveWidget(restored.activeWidget);
    setAssistantText(restored.assistantText);
    setItinerarySummary(restored.itinerarySummary);
    setFlightCards(restored.flightCards);
    setSearchResults(restored.searchResults);
    setSuggestions(restored.suggestions);
    // The restored state is authoritative — drop any stale widget pointer
    // left over from a previous session so it can't re-clobber activeWidget.
    if (useChatStore.getState().lastWidget) {
      useChatStore.setState({ lastWidget: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    if (initialMessage && !hasSentInitial.current && !hasStarted) {
      hasSentInitial.current = true;
      handleSend(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, hasStarted]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatEntries, activeWidget, assistantText, isLoading, streamingText]);

  // Keep a ref of conversationId so Socket.IO handlers always see the latest
  // value without needing to re-register on every change (avoids race condition
  // where the first agent:response arrives before the state update lands).
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;

  // Store processResponse in a ref so the Socket.IO handler (registered once)
  // always calls the LATEST version, not a stale closure from the first render.
  // The assignment happens after processResponse is defined (see below).
  const processResponseRef = useRef<(data: any) => void>(() => {});
  // Track the ts of the last response we've already processed via the socket
  // handler, so the lastResponse useEffect doesn't double-process it.
  const lastProcessedTsRef = useRef<number>(0);

  // Listen for agent:widget events (from ask_question tool)
  // Reactive to socket availability — on NewTripPage, the socket is created
  // after ChatPanel mounts, so [] deps would miss the registration.
  const socket = useTripStore((s) => s.socket);

  useEffect(() => {
    if (!socket) return;

    const handleWidget = (data: any) => {
      // Reject events tagged for another conversation — a widget for conv A
      // must never surface while the user is viewing conv B (or a fresh chat
      // whose conversationId is still null). Untagged events pass through so
      // the very first turn (id not yet assigned) still works.
      if (data.conversationId && data.conversationId !== conversationIdRef.current) return;
      if (data.widget) {
        setActiveWidget(data.widget);
      }
    };

    socket.on('agent:widget', handleWidget);
    return () => { socket.off('agent:widget', handleWidget); };
  }, [socket]);

  // Widget events can also arrive via chatStore.lastWidget — set by
  // replayMissedEvents (G6) or the store-level socket handler when
  // ChatPanel's own handler wasn't registered yet. Scoped by conversationId:
  // a widget stored for another conversation (e.g. still streaming after the
  // user navigated away) must not leak into this panel.
  const lastWidget = useChatStore((s) => s.lastWidget);
  useEffect(() => {
    if (!lastWidget?.widget) return;
    if (lastWidget.conversationId && lastWidget.conversationId !== conversationIdRef.current) return;
    setActiveWidget(lastWidget.widget);
  }, [lastWidget]);

  // Listen for final agent:response via Socket.IO
  useEffect(() => {
    if (!socket) return;

    const handleAgentResponse = (data: any) => {
      // Reject responses tagged for another conversation — navigating away
      // mid-stream must not let conv A's response overwrite conv B's panel.
      // Untagged events pass through so the first turn (id not yet assigned)
      // can still populate searchResults/widgets.
      if (data.conversationId && data.conversationId !== conversationIdRef.current) return;
      // processResponse sets React state (setAssistantText, setChatEntries, etc.)
      // which React 18 batches and applies asynchronously. The Zustand clears
      // below (setStreamingText/setLoading) are synchronous and trigger an
      // immediate re-render. If we call them synchronously here, the re-render
      // fires BEFORE React applies the batched state — so streamingText is ''
      // but assistantText is still the old value, causing the chat to vanish.
      // Deferring to a macrotask ensures React commits its state first.
      try {
        processResponseRef.current(data);
      } catch (e) {
        console.error('[ChatPanel] processResponse error:', e);
      }
      // Mark this response as processed so the lastResponse useEffect
      // doesn't double-process it.
      const lr = useChatStore.getState().lastResponse;
      if (lr) lastProcessedTsRef.current = lr.ts;
      setTimeout(() => {
        setStreamingText('');
        setLoading(false);
        setAgentStatus(null);
      }, 0);
    };

    socket.on('agent:response', handleAgentResponse);
    return () => { socket.off('agent:response', handleAgentResponse); };
  }, [socket]);

  const processResponse = (data: any) => {
    if (data.conversationId && !conversationId) {
      setConversationId(data.conversationId);
    }

    const widgets = data.widgets || [];
    const qWidget = widgets.find((w: any) => w.type === 'question_card');
    const sWidget = widgets.find((w: any) => w.type === 'itinerary_summary');
    const srWidget = widgets.find((w: any) => w.type === 'search_results');

    // Update activeWidget based on whether this turn called ask_question.
    // The backend includes the question_card widget in the response payload
    // so we know whether to keep or clear the widget. This handles stale
    // agent:widget events from previous turns that might re-set activeWidget.
    // A question_card is never vetoed by other widgets on the same turn —
    // follow-up questions must still render after an itinerary/search turn.
    if (qWidget) {
      setActiveWidget(qWidget);
    } else {
      setActiveWidget(null);
    }

    if (sWidget) {
      setItinerarySummary(sWidget.data);
    }

    // Extract flight card widgets for inline rendering
    const fWidgets = widgets.filter((w: any) => w.type === 'flight_card');
    setFlightCards(fWidgets.map((w: any) => w.data));

    // For search results, store them per-message instead of as a singleton.
    if (srWidget) {
      setSearchResults(srWidget.data);
    } else {
      setSearchResults(null);
    }

    // Always set assistantText — the rendering hides it when activeWidget
    // is set (via the !activeWidget check), so no duplication with the widget.
    setAssistantText(data.message || '');

    // Suggestion chips emitted with this response.
    setSuggestions(data.suggestions || []);

    // Dedupe: when a historical response is re-delivered via
    // replayMissedEvents after the messages were already restored from the
    // DB, the last store message is identical — re-appending it would
    // corrupt the saved chatHistory with duplicates.
    const storeMsgs = useChatStore.getState().messages;
    const lastMsg = storeMsgs[storeMsgs.length - 1];

    // Store ALL widgets with the assistant entry (including question_card)
    // so the rendering can skip question-turn entries in the history.
    const entryWidgets = widgets.filter((w: any) =>
      w.type === 'search_results' || w.type === 'itinerary_summary' ||
      w.type === 'question_card' || w.type === 'flight_card'
    );

    const alreadyPersisted =
      lastMsg?.role === 'assistant' &&
      lastMsg.content === (data.message || '') &&
      // an empty response only dedupes against a restored widget entry —
      // otherwise every "" turn would collapse into the previous "" one
      (!!data.message || !!lastMsg?.widgets?.length);

    // A turn that ends on a question_card (the run suspended on an interrupt)
    // may carry no message text — persist the entry anyway so the question
    // turn survives in chatEntries/chatHistory.
    if ((data.message || entryWidgets.length > 0) && !alreadyPersisted) {
      // Snapshot the tool activities so they persist in chat history
      const activitiesSnapshot = [...getToolActivities()];
      setChatEntries((prev) => [...prev, {
        kind: 'assistant',
        text: data.message,
        widgets: entryWidgets,
        toolActivities: activitiesSnapshot,
      }]);

      useChatStore.getState().addMessage({
        role: 'assistant',
        content: data.message,
        timestamp: new Date().toISOString(),
        widgets: data.widgets,
        toolActivities: [...getToolActivities()],
        suggestions: data.suggestions || [],
      });
    }

    // Clear tool activities for the next turn
    clearToolActivities();

    // Persist trip state AFTER the assistant message lands in the store so
    // the saved chatHistory includes this turn's response (previously the
    // save ran first and chatHistory lagged one message behind).
    if (data.tripState && onTripStateUpdate) {
      onTripStateUpdate(data.tripState);
    }

    if (data.tripState?.itinerary && onItineraryBuilt) {
      onItineraryBuilt(data.tripState);
    }
  };

  // Update the ref every render so the Socket.IO handler always calls
  // the latest processResponse (with current state/props, not stale ones).
  processResponseRef.current = processResponse;

  // Watch lastResponse from chatStore — if the socket handler missed the
  // agent:response event (e.g. socket wasn't joined to the room yet when
  // the event was emitted), tripStore's handler or replayMissedEvents will
  // still set lastResponse. This useEffect ensures processResponse runs
  // even in that case, so chatEntries/assistantText/widgets update.
  const lastResponse = useChatStore((s) => s.lastResponse);
  useEffect(() => {
    if (!lastResponse) return;
    // Skip responses tagged for another conversation — same cross-conv leak
    // guard as the socket handler.
    if (lastResponse.data?.conversationId && lastResponse.data.conversationId !== conversationIdRef.current) return;
    // Avoid double-processing: the socket handler calls processResponse
    // directly and sets lastProcessedTsRef. We only process here if the
    // socket handler didn't already handle this response.
    if (lastResponse.ts === lastProcessedTsRef.current) return;
    lastProcessedTsRef.current = lastResponse.ts;
    try {
      processResponseRef.current(lastResponse.data);
    } catch (e) {
      console.error('[ChatPanel] lastResponse processResponse error:', e);
    }
    setTimeout(() => {
      setStreamingText('');
      setLoading(false);
      setAgentStatus(null);
    }, 0);
  }, [lastResponse]);

  const handleSend = async (text: string) => {
    if (!text.trim() || isLoading) return;

    setChatEntries((prev) => [...prev, { kind: 'user', text: text.trim() }]);
    setInput('');
    setHasStarted(true);
    setLoading(true);
    setAgentStatus('Thinking...');
    setStreamingText('');
    setSearchResults(null);
    setActiveWidget(null);
    setFlightCards([]);
    setSuggestions([]);
    clearToolActivities();
    useTripStore.setState({ progressiveDays: null });

    useChatStore.getState().addMessage({
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    });

    try {
      const res = await chatApi.sendMessage({
        message: text,
        conversationId: conversationId || undefined,
      });

      if (res.data?.status === 'streaming') {
        if (res.data.conversationId && !conversationId) {
          setConversationId(res.data.conversationId);
        }
      } else {
        processResponse(res.data);
        setTimeout(() => {
          setLoading(false);
          setAgentStatus(null);
        }, 0);
      }
    } catch (err: any) {
      const busy = err.response?.status === 409;
      setAssistantText(
        busy
          ? "Still working on your previous message — it'll be answered shortly."
          : "I'm sorry, I couldn't process your request. Please try again."
      );
      setActiveWidget(null);
      useChatStore.getState().settleToolActivities(true);
      // On 409 a run is still in flight — its agent:response will clear
      // loading when it lands, so don't clear it here.
      if (!busy) {
        setTimeout(() => {
          setLoading(false);
          setAgentStatus(null);
        }, 0);
      }
    }
  };

  const handleAnswer = async (answer: any) => {
    if (!activeWidget || isLoading) return;

    const question = activeWidget.data.question;
    const answerLabel = typeof answer === 'string' ? answer : String(answer);

    setChatEntries((prev) => [...prev, { kind: 'answered', question, answerLabel }]);
    setActiveWidget(null);
    setAssistantText('');
    setSuggestions([]);

    setLoading(true);
    setAgentStatus('Thinking...');
    setStreamingText('');
    clearToolActivities();
    useTripStore.setState({ progressiveDays: null });

    useChatStore.getState().addMessage({
      role: 'user',
      content: answerLabel,
      timestamp: new Date().toISOString(),
      answeredQuestion: question,
    });

    try {
      const res = await chatApi.sendMessage({
        message: answerLabel,
        conversationId: conversationId || undefined,
      });

      if (res.data?.status === 'streaming') {
        if (res.data.conversationId && !conversationId) {
          setConversationId(res.data.conversationId);
        }
      } else {
        processResponse(res.data);
        setTimeout(() => {
          setLoading(false);
          setAgentStatus(null);
        }, 0);
      }
    } catch (err: any) {
      setAssistantText("I'm sorry, I couldn't process your request. Please try again.");
      useChatStore.getState().settleToolActivities(true);
      setTimeout(() => {
        setLoading(false);
        setAgentStatus(null);
      }, 0);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--surface)]">
      {/* Slim header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--border)] shrink-0">
        <span className="text-sm font-medium text-[var(--ink)] truncate">{title}</span>
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-md text-[var(--muted)] hover:bg-[var(--sage)] transition-colors" title="Share">
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <button className="p-1.5 rounded-md text-[var(--muted)] hover:bg-[var(--sage)] transition-colors" title="Activity">
            <Activity className="w-3.5 h-3.5" />
          </button>
          <button className="p-1.5 rounded-md text-[var(--muted)] hover:bg-[var(--sage)] transition-colors" title="More">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-[480px] mx-auto">
          {!hasStarted ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-[var(--sage)] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[var(--peach)]" />
              </div>
              <h2 className="text-base font-semibold text-[var(--ink)] mb-1">
                Where to next?
              </h2>
              <p className="text-xs text-[var(--muted)] mb-6 max-w-[240px]">
                Tell me about your dream trip and I'll help you plan it.
              </p>
              <div className="space-y-1.5 w-full max-w-[320px]">
                {emptyStatePrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    className="block w-full py-2.5 px-3 rounded-lg bg-[var(--bg)] text-left text-xs text-[var(--ink)] hover:bg-[var(--sage)] transition-colors border border-[var(--border)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Chat history — all entries rendered in order */}
              {chatEntries.map((entry, i) => {
                if (entry.kind === 'user') {
                  return (
                    <div key={i} className="flex justify-end mb-2">
                      <div className="bg-[var(--lavender)] rounded-xl px-3 py-2 max-w-[80%]">
                        <p className="text-xs text-[var(--ink)] leading-relaxed">{entry.text}</p>
                      </div>
                    </div>
                  );
                }
                if (entry.kind === 'answered') {
                  return (
                    <CompletedQuestion key={i} question={entry.question} answer={entry.answerLabel} />
                  );
                }
                // assistant entry — only render text here if it's NOT the latest one
                const isLastAssistant =
                  i === chatEntries.length - 1 && entry.kind === 'assistant';
                if (isLastAssistant) return null; // rendered below with widgets
                // Question-turn entries: CompletedQuestion represents the
                // question+answer, but keep any assistant text the turn also
                // produced — the card must not swallow the message.
                const hasQuestionCard = entry.widgets?.some((w: any) => w.type === 'question_card');
                if (hasQuestionCard) {
                  if (!entry.text) return null;
                  return (
                    <div key={i} className="mt-2 mb-3">
                      <ChatMarkdown
                        text={entry.text}
                        className="text-sm text-[var(--ink)] leading-relaxed space-y-1.5"
                      />
                      {entry.toolActivities && entry.toolActivities.length > 0 && (
                        <ToolActivityBar activities={entry.toolActivities} isLoading={false} />
                      )}
                    </div>
                  );
                }
                // Render inline widgets for this message
                const entrySrWidget = entry.widgets?.find((w: any) => w.type === 'search_results');
                const entryItinWidget = entry.widgets?.find((w: any) => w.type === 'itinerary_summary');
                const entryFlightWidgets = (entry.widgets || []).filter((w: any) => w.type === 'flight_card');
                return (
                  <div key={i} className="mt-2 mb-3">
                    {entrySrWidget ? (
                      <SearchResults
                        data={entrySrWidget.data}
                        text={entry.text}
                        onSelectPlace={onSelectPlace}
                      />
                    ) : (
                      <>
                        {entry.text && (
                          <ChatMarkdown
                            text={entry.text}
                            className="text-sm text-[var(--ink)] leading-relaxed space-y-1.5"
                          />
                        )}
                        {entryItinWidget && (
                          <ItinerarySummary data={entryItinWidget.data} onSelectPlace={onSelectPlace} />
                        )}
                        {entryFlightWidgets.length > 0 && onSelectFlight && (
                          <div className="space-y-2 mt-2">
                            {entryFlightWidgets.map((w: any, fi: number) => (
                              <FlightCard key={fi} flight={w.data} onOpen={onSelectFlight} />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {/* Persisted tool activity bar for this message */}
                    {entry.toolActivities && entry.toolActivities.length > 0 && (
                      <ToolActivityBar activities={entry.toolActivities} isLoading={false} />
                    )}
                  </div>
                );
              })}

              {/* Streaming text (live token-by-token) */}
              {streamingText && (
                <div className="mt-2 mb-3">
                  <ChatMarkdown
                    text={streamingText}
                    className="text-sm text-[var(--ink)] leading-relaxed space-y-1.5"
                  />
                </div>
              )}

              {/* Loading indicator (when no streaming text yet) */}
              {isLoading && !streamingText && (
                toolActivities.length > 0 ? (
                  <ToolActivityBar activities={toolActivities} isLoading={true} />
                ) : (
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)] mb-3 px-1 py-2">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span>{agentStatus || 'Thinking...'}</span>
                  </div>
                )
              )}

              {/* Live tool activity bar (shown alongside streaming text) */}
              {isLoading && streamingText && toolActivities.length > 0 && (
                <ToolActivityBar activities={toolActivities} isLoading={true} />
              )}

              {/* Latest assistant text — renders ABOVE the question card.
                  A turn may produce both (the model speaks, then suspends on
                  ask_question); gating on !activeWidget used to hide the text. */}
              {assistantText && !searchResults && !isLoading && !streamingText && (
                <div className="mt-2 mb-3">
                  <ChatMarkdown
                    text={assistantText}
                    className="text-sm text-[var(--ink)] leading-relaxed space-y-1.5"
                  />
                  {/* Show collapsed tool activity bar from the last entry */}
                  {(() => {
                    const lastEntry = chatEntries[chatEntries.length - 1];
                    if (lastEntry?.kind === 'assistant' && lastEntry.toolActivities && lastEntry.toolActivities.length > 0) {
                      return <ToolActivityBar activities={lastEntry.toolActivities} isLoading={false} />;
                    }
                    return null;
                  })()}
                </div>
              )}

              {/* Active question card (from ask_question tool) */}
              {activeWidget && activeWidget.type === 'question_card' && (
                <QuestionCard data={activeWidget.data} onAnswer={handleAnswer} />
              )}

              {/* Itinerary summary — shown after itinerary is built */}
              {itinerarySummary && !activeWidget && !isLoading && (
                <>
                  <ItinerarySummary data={itinerarySummary} onSelectPlace={onSelectPlace} />
                  {flightCards.length > 0 && onSelectFlight && (
                    <div className="space-y-2 mb-3">
                      {flightCards.map((flight, i) => (
                        <FlightCard key={i} flight={flight} onOpen={onSelectFlight} />
                      ))}
                    </div>
                  )}
                  {(() => {
                    const lastEntry = chatEntries[chatEntries.length - 1];
                    // Skip when the assistant text block below will render this
                    // same bar — otherwise the collapsed bar appears twice.
                    const textWillRender = assistantText && !searchResults && !streamingText;
                    if (!textWillRender && lastEntry?.kind === 'assistant' && lastEntry.toolActivities && lastEntry.toolActivities.length > 0) {
                      return <ToolActivityBar activities={lastEntry.toolActivities} isLoading={false} />;
                    }
                    return null;
                  })()}
                </>
              )}

              {/* Search results — shown after a search/recommendation turn */}
              {searchResults && !itinerarySummary && !activeWidget && !isLoading && !streamingText && (
                <>
                  <SearchResults data={searchResults} text={assistantText} onSelectPlace={onSelectPlace} />
                  {(() => {
                    const lastEntry = chatEntries[chatEntries.length - 1];
                    if (lastEntry?.kind === 'assistant' && lastEntry.toolActivities && lastEntry.toolActivities.length > 0) {
                      return <ToolActivityBar activities={lastEntry.toolActivities} isLoading={false} />;
                    }
                    return null;
                  })()}
                </>
              )}

              {/* Suggestion chips emitted with the latest response */}
              {suggestions.length > 0 && !activeWidget && !isLoading && !streamingText && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {suggestions.map((s, i) => (
                    <button
                      key={`${s}-${i}`}
                      onClick={() => handleSend(s)}
                      className="px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--ink)] hover:bg-[var(--sage)] transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div ref={scrollRef} />
            </>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-[var(--border)] px-3 py-2 shrink-0">
        <div className="max-w-[480px] mx-auto">
          <div className="flex items-end gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3.5 py-2 focus-within:border-[var(--muted)] transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(input);
                }
              }}
              placeholder="Message TripWhat…"
              rows={1}
              className="flex-1 bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none resize-none leading-normal"
              style={{ minHeight: '22px', maxHeight: '120px' }}
              disabled={isLoading}
            />
            <div className="flex items-center gap-1 shrink-0">
              <button className="p-1.5 rounded-md text-[var(--muted)] hover:bg-[var(--sage)] transition-colors" title="Voice">
                <Mic className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleSend(input)}
                disabled={!input.trim() || isLoading}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--ink)] text-white disabled:opacity-30 hover:bg-[#292524] transition-colors"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
