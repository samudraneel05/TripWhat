import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const sendMessage = vi.hoisted(() => vi.fn());

vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }),
}));
vi.mock('../src/lib/api', () => ({
  chatApi: {
    sendMessage,
    getStreamEvents: vi.fn(async () => ({ data: { events: [], isActive: false } })),
  },
  itineraryEditApi: {},
  savedApi: { list: vi.fn(async () => ({ data: [] })) },
}));

import { ChatPanel } from '../src/components/Chat/ChatPanel';
import { useChatStore } from '../src/stores/chatStore';

const FRIENDLY = 'Something went wrong on my side. Please try again.';

describe('ChatPanel retry', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useChatStore.getState().reset();
    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ data: { status: 'streaming', conversationId: 'c1' } });
  });

  it('shows Retry on a failed assistant turn and re-sends the previous user message', async () => {
    render(<ChatPanel />);
    useChatStore.setState({
      messages: [
        { role: 'user', content: 'Plan Lisbon for 3 days' },
        { role: 'assistant', content: FRIENDLY, error: true },
      ],
    });

    const retry = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.click(retry);

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(sendMessage.mock.calls[0][0].message).toBe('Plan Lisbon for 3 days');
  });

  it('does not show Retry for a normal assistant turn', async () => {
    render(<ChatPanel />);
    useChatStore.setState({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hello!' },
      ],
    });
    await screen.findByText('Hello!');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
