import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// Mock heavy child components and network-touching modules so NewTripPage
// can mount in jsdom.
vi.mock('../src/components/Chat/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('../src/components/map/TripMap', () => ({ TripMap: () => null }));
vi.mock('../src/components/PlaceDetailPanel', () => ({ PlaceDetailPanel: () => null }));
vi.mock('../src/components/FlightDetailPanel', () => ({ FlightDetailPanel: () => null }));
vi.mock('../src/components/PlanTab', () => ({ PlanTab: () => null }));
vi.mock('../src/components/SavedTab', () => ({ SavedTab: () => null }));
vi.mock('../src/components/BookingsTab', () => ({ BookingsTab: () => null }));
vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }),
}));
vi.mock('../src/lib/api', () => ({
  chatApi: {
    getHistory: vi.fn(async () => ({
      data: { messages: [], pendingWidget: null, tripState: null },
    })),
    listConversations: vi.fn(async () => ({ data: { conversations: [] } })),
    getStreamEvents: vi.fn(async () => ({ data: { events: [], isActive: false } })),
    sendMessage: vi.fn(),
    deleteConversation: vi.fn(),
  },
  itineraryEditApi: {},
  savedApi: { list: vi.fn(async () => ({ data: [] })) },
  gmailApi: { status: vi.fn(async () => ({ data: { connected: false } })) },
}));

import NewTripPage from '../src/pages/NewTripPage';
import { useChatStore } from '../src/stores/chatStore';
import { useTripStore } from '../src/stores/tripStore';

function PathProbe({ onPath }: { onPath: (p: string) => void }) {
  const loc = useLocation();
  onPath(loc.pathname);
  return null;
}

function renderAt(path: string, onPath: (p: string) => void) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/chat/:conversationId"
          element={
            <>
              <NewTripPage />
              <PathProbe onPath={onPath} />
            </>
          }
        />
        <Route
          path="/new"
          element={
            <>
              <NewTripPage />
              <PathProbe onPath={onPath} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('conversation switching', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useTripStore.setState({ trips: [], tripState: null, lastEventIds: {}, joinedConversationId: null });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ trips: [] }),
    })));
  });

  it('opening /chat/:id while another conversation was active does not bounce back', async () => {
    // Simulate: conversation A was open, user clicks recent chat B.
    useChatStore.setState({
      conversationId: 'conv-A',
      messages: [{ role: 'assistant', content: 'old chat', timestamp: '2026-01-01T00:00:00Z' }],
    });

    const paths: string[] = [];
    renderAt('/chat/conv-B', (p) => paths.push(p));

    // The resume effect should adopt conv-B — never navigate back to conv-A.
    await waitFor(() => expect(useChatStore.getState().conversationId).toBe('conv-B'));
    await new Promise((r) => setTimeout(r, 30));

    expect(paths).not.toContain('/chat/conv-A');
    expect(paths[paths.length - 1]).toBe('/chat/conv-B');
  });

  it('opening /new with a stale conversationId stays on /new', async () => {
    useChatStore.setState({ conversationId: 'conv-A' });

    const paths: string[] = [];
    renderAt('/new', (p) => paths.push(p));
    await new Promise((r) => setTimeout(r, 30));

    expect(paths).toEqual(['/new']);
    expect(useChatStore.getState().conversationId).toBeNull();
  });
});
