import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }),
}));
vi.mock('../src/lib/api', () => ({
  chatApi: {
    sendMessage: vi.fn(),
    getStreamEvents: vi.fn(async () => ({ data: { events: [], isActive: false } })),
  },
  itineraryEditApi: {},
  savedApi: { list: vi.fn(async () => ({ data: [] })) },
}));

import { ChatPanel } from '../src/components/Chat/ChatPanel';
import { useChatStore } from '../src/stores/chatStore';
import { useTripStore } from '../src/stores/tripStore';

describe('ChatPanel reconnect banner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    useChatStore.getState().reset();
    useTripStore.setState({ socket: null, socketConnected: false });
  });

  it('shows "Reconnecting…" only after the grace period when the socket drops', async () => {
    vi.useRealTimers();
    render(<ChatPanel />);
    // Live socket that just disconnected
    const fakeSocket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() } as any;
    act(() => useTripStore.setState({ socket: fakeSocket, socketConnected: false }));
    expect(screen.queryByText(/Reconnecting/)).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)); });
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
    act(() => useTripStore.setState({ socketConnected: true }));
    expect(screen.queryByText(/Reconnecting/)).toBeNull();
  }, 10000);

  it('stays quiet when there is no socket', () => {
    vi.useRealTimers();
    render(<ChatPanel />);
    expect(screen.queryByText(/Reconnecting/)).toBeNull();
  });
});
