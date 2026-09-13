import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

describe('test harness sanity check', () => {
  it('vitest + RTL is running', () => {
    render(<div>hello tripwhat</div>);
    expect(screen.getByText('hello tripwhat')).toBeInTheDocument();
  });

  it('jsdom environment works', () => {
    const div = document.createElement('div');
    div.textContent = 'test';
    document.body.appendChild(div);
    expect(document.body.textContent).toContain('test');
  });
});
