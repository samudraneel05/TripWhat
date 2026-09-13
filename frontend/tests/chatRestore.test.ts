import { describe, it, expect } from 'vitest';
import { buildChatRestore } from '../src/lib/chatRestore';
import type { ChatMessage } from '../src/stores/chatStore';

const user = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  role: 'user',
  content,
  timestamp: '2026-01-01T00:00:00Z',
  ...extra,
});

const assistant = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  role: 'assistant',
  content,
  timestamp: '2026-01-01T00:00:01Z',
  ...extra,
});

const questionWidget = (question = 'When are you traveling?') => ({
  type: 'question_card',
  data: { question, options: [{ label: 'October', value: 'oct' }] },
});

const searchWidget = {
  type: 'search_results',
  data: { places: [{ name: 'Senso-ji', placeId: 'p1', imageUrl: 'u' }] },
};

const itineraryWidget = {
  type: 'itinerary_summary',
  data: { hotel: null, attractions: [], destination: 'Tokyo', duration: 5, dates: {}, preferences: [] },
};

const flightWidget = {
  type: 'flight_card',
  data: { airline: 'ANA', price: 900 },
};

const activities = [
  { callId: 'c1', toolName: 'mcp_search_places', label: 'Searching places', status: 'finished' as const, summary: '5 places found' },
];

describe('buildChatRestore', () => {
  it('rebuilds plain user/assistant entries', () => {
    const r = buildChatRestore([
      user('Plan a Tokyo trip'),
      assistant('Sure, here are ideas.'),
    ]);
    expect(r.entries).toEqual([
      { kind: 'user', text: 'Plan a Tokyo trip' },
      { kind: 'assistant', text: 'Sure, here are ideas.', widgets: [], toolActivities: undefined },
    ]);
    expect(r.assistantText).toBe('Sure, here are ideas.');
    expect(r.activeWidget).toBeNull();
  });

  it('converts question_card + following user msg into an answered entry', () => {
    const r = buildChatRestore([
      user('Plan a trip'),
      assistant('When?', { widgets: [questionWidget()] }),
      user('In October'),
      assistant('Great, planning now.'),
    ]);
    expect(r.entries[1]).toEqual(expect.objectContaining({ kind: 'assistant' }));
    expect(r.entries[2]).toEqual({
      kind: 'answered',
      question: 'When are you traveling?',
      answerLabel: 'In October',
    });
    expect(r.activeWidget).toBeNull();
    expect(r.assistantText).toBe('Great, planning now.');
  });

  it('uses the persisted answeredQuestion field when present', () => {
    const r = buildChatRestore([
      user('Plan a trip'),
      assistant('When?', { widgets: [questionWidget('Exact dates?')] }),
      user('Oct 10-16', { answeredQuestion: 'Exact dates?' }),
    ]);
    expect(r.entries[2]).toEqual({
      kind: 'answered',
      question: 'Exact dates?',
      answerLabel: 'Oct 10-16',
    });
  });

  it('restores activeWidget from a trailing unanswered question_card', () => {
    const r = buildChatRestore([
      user('Plan a trip'),
      assistant('When?', { widgets: [questionWidget()] }),
    ]);
    expect(r.activeWidget).toEqual(questionWidget());
    expect(r.entries).toHaveLength(2);
  });

  it('restores search results, tool activities and suggestions on the last turn', () => {
    const r = buildChatRestore([
      user('Find temples in Tokyo'),
      assistant('Here are temples:', {
        widgets: [searchWidget],
        toolActivities: activities,
        suggestions: ['More like this'],
      }),
    ]);
    expect(r.searchResults).toEqual(searchWidget.data);
    expect(r.assistantText).toBe('Here are temples:');
    expect(r.suggestions).toEqual(['More like this']);
    const entry = r.entries[1];
    expect(entry.kind).toBe('assistant');
    if (entry.kind === 'assistant') {
      expect(entry.toolActivities).toEqual(activities);
      expect(entry.widgets).toEqual([searchWidget]);
    }
  });

  it('restores itinerary summary + flight cards', () => {
    const r = buildChatRestore([
      user('Build it'),
      assistant('Done!', { widgets: [itineraryWidget, flightWidget] }),
    ]);
    expect(r.itinerarySummary).toEqual(itineraryWidget.data);
    expect(r.flightCards).toEqual([flightWidget.data]);
  });

  it('keeps itinerary summary visible across later turns', () => {
    const r = buildChatRestore([
      user('Build it'),
      assistant('Done!', { widgets: [itineraryWidget, flightWidget] }),
      user('thanks'),
      assistant('Anytime!'),
    ]);
    expect(r.itinerarySummary).toEqual(itineraryWidget.data);
    // flight cards from the itinerary turn remain associated with it
    expect(r.flightCards).toEqual([flightWidget.data]);
    expect(r.assistantText).toBe('Anytime!');
  });

  it('still restores activeWidget when the question turn also had search results', () => {
    // Matches processResponse: a trailing question_card always re-arms the
    // pending QuestionCard — other widgets no longer veto it.
    const r = buildChatRestore([
      assistant('Here:', { widgets: [questionWidget(), searchWidget] }),
    ]);
    expect(r.activeWidget).toEqual(questionWidget());
    expect(r.searchResults).toEqual(searchWidget.data);
  });

  it('treats a user msg after question_card without answeredQuestion as the answer (legacy data)', () => {
    const r = buildChatRestore([
      assistant('Pick one', { widgets: [questionWidget('Which hotel?')] }),
      user('The first one'),
    ]);
    expect(r.entries[1]).toEqual({
      kind: 'answered',
      question: 'Which hotel?',
      answerLabel: 'The first one',
    });
  });

  it('returns empty state for no messages', () => {
    const r = buildChatRestore([]);
    expect(r.entries).toEqual([]);
    expect(r.activeWidget).toBeNull();
    expect(r.assistantText).toBe('');
    expect(r.suggestions).toEqual([]);
  });
});
