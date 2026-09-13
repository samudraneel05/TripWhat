import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatMarkdown } from '../src/lib/chatMarkdown';

describe('ChatMarkdown', () => {
  it('renders bold, italic, lists and headings', () => {
    const { container } = render(
      <ChatMarkdown
        text={'## Top picks\n\n1. **Tokyo** is great\n2. *Kyoto* is calm\n\n- item a\n- item b'}
      />,
    );
    expect(container.querySelector('h2')).toHaveTextContent('Top picks');
    const strongs = container.querySelectorAll('strong');
    expect([...strongs].map((s) => s.textContent)).toContain('Tokyo');
    expect(container.querySelector('em')).toHaveTextContent('Kyoto');
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('renders external links with target=_blank and rel=noopener', () => {
    render(<ChatMarkdown text="Check [this guide](https://example.com/x) out" />);
    const link = screen.getByRole('link', { name: 'this guide' });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders markdown images', () => {
    const { container } = render(
      <ChatMarkdown text="![a nice view](https://example.com/v.png)" />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.com/v.png');
    expect(img).toHaveAttribute('alt', 'a nice view');
  });

  it('turns place names into clickable buttons that call onSelectPlace', () => {
    const onSelectPlace = vi.fn();
    render(
      <ChatMarkdown
        text="Start at Senso-ji, then walk to Tokyo Skytree."
        places={[
          { name: 'Senso-ji', placeId: 'pid_sensoji' },
          { name: 'Tokyo Skytree', placeId: 'pid_skytree' },
        ]}
        onSelectPlace={onSelectPlace}
      />,
    );
    const sensoji = screen.getByRole('button', { name: 'Senso-ji' });
    fireEvent.click(sensoji);
    expect(onSelectPlace).toHaveBeenCalledWith('pid_sensoji');
    const skytree = screen.getByRole('button', { name: 'Tokyo Skytree' });
    fireEvent.click(skytree);
    expect(onSelectPlace).toHaveBeenCalledWith('pid_skytree');
  });

  it('keeps bold formatting around place names without leaking ** markers', () => {
    // Regression test for the orphaned-`**` bug: the old split-on-name
    // renderer left literal asterisks when emphasis wrapped a place name.
    const onSelectPlace = vi.fn();
    const { container } = render(
      <ChatMarkdown
        text={'Top pick: **Senso-ji** is a must.\n\n- Also **Tokyo Skytree** at night'}
        places={[
          { name: 'Senso-ji', placeId: 'pid_sensoji' },
          { name: 'Tokyo Skytree', placeId: 'pid_skytree' },
        ]}
        onSelectPlace={onSelectPlace}
      />,
    );
    expect(container.textContent).not.toContain('**');
    const btn = screen.getByRole('button', { name: 'Senso-ji' });
    expect(btn.closest('strong')).not.toBeNull();
    const btn2 = screen.getByRole('button', { name: 'Tokyo Skytree' });
    fireEvent.click(btn2);
    expect(onSelectPlace).toHaveBeenCalledWith('pid_skytree');
  });

  it('matches place names case-insensitively and prefers the longest name', () => {
    const onSelectPlace = vi.fn();
    render(
      <ChatMarkdown
        text="Visit senso-ji temple grounds."
        places={[
          { name: 'Senso-ji', placeId: 'pid_short' },
          { name: 'Senso-ji Temple', placeId: 'pid_long' },
        ]}
        onSelectPlace={onSelectPlace}
      />,
    );
    const btn = screen.getByRole('button', { name: 'senso-ji temple' });
    fireEvent.click(btn);
    expect(onSelectPlace).toHaveBeenCalledWith('pid_long');
  });

  it('does not linkify place names inside existing markdown links', () => {
    render(
      <ChatMarkdown
        text="See [Senso-ji guide](https://example.com)"
        places={[{ name: 'Senso-ji', placeId: 'pid_sensoji' }]}
        onSelectPlace={() => {}}
      />,
    );
    // The link text stays inside the <a>, not converted to a button.
    const link = screen.getByRole('link', { name: 'Senso-ji guide' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(screen.queryByRole('button', { name: 'Senso-ji' })).toBeNull();
  });

  it('renders plain markdown text unchanged when no places are given', () => {
    const { container } = render(<ChatMarkdown text="Just **bold** words" />);
    expect(container.textContent).not.toContain('**');
    expect(container.querySelector('strong')).toHaveTextContent('bold');
  });
});
