import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import LandingPage from '../src/pages/LandingPage';
import LoginPage from '../src/pages/LoginPage';
import SignupPage from '../src/pages/SignupPage';

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  loading: false,
  login: vi.fn(),
  signup: vi.fn(),
}));

vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../src/components/landing/useScrollReveal', () => ({ useScrollReveal: () => ({ current: null }) }));

function Location() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname}{search}</output>;
}

function renderLanding(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Location />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/new" element={<div>New chat</div>} />
        <Route path="/trips" element={<div>My trips</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.loading = false;
  auth.login.mockReset();
  auth.signup.mockReset();
  localStorage.clear();
});

describe('landing page', () => {
  it('keeps a submitted prompt through signup, switching to login, and authentication', async () => {
    const user = userEvent.setup();
    auth.login.mockResolvedValue({ id: 1 });
    renderLanding();
    const prompt = 'Paris & cafés + art? 3 days';
    await user.type(screen.getByRole('textbox', { name: 'Tell us about your trip' }), prompt);
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent(`/signup?q=${encodeURIComponent(prompt)}`);
    await user.click(screen.getAllByRole('link', { name: 'Log in' })[0]);
    expect(screen.getByTestId('location')).toHaveTextContent(`/login?q=${encodeURIComponent(prompt)}`);
    await user.type(screen.getByLabelText('Email'), 'traveler@example.com');
    await user.type(screen.getByLabelText('Password'), 'test-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('New chat')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`/new?q=${encodeURIComponent(prompt)}`);
  });

  it('continues a destination starter after signup', async () => {
    const user = userEvent.setup();
    auth.signup.mockResolvedValue(undefined);
    renderLanding();
    await user.click(screen.getByRole('button', { name: 'Plan a trip to Paris' }));
    const prompt = 'Plan a 3-day trip to Paris';
    expect(screen.getByTestId('location')).toHaveTextContent(`/signup?q=${encodeURIComponent(prompt)}`);
    await user.type(screen.getByLabelText('Name'), 'Traveler');
    await user.type(screen.getByLabelText('Email'), 'traveler@example.com');
    await user.type(screen.getByLabelText('Password'), 'test-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('New chat')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`/new?q=${encodeURIComponent(prompt)}`);
  });

  it('takes an authenticated traveler straight to a new chat', async () => {
    const user = userEvent.setup();
    auth.isAuthenticated = true;
    renderLanding();
    expect(screen.getAllByRole('link', { name: 'My trips' }).length).toBeGreaterThan(0);
    await user.type(screen.getByRole('textbox', { name: 'Tell us about your trip' }), 'A week in Japan');
    await user.click(screen.getByRole('button', { name: 'Explore', exact: true }));
    expect(screen.getByTestId('location')).toHaveTextContent('/new?q=A%20week%20in%20Japan');
  });

  it('lets people edit an idea before submitting it', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(screen.getByRole('button', { name: 'A weekend in Paris' }));
    const input = screen.getByRole('textbox', { name: 'Tell us about your trip' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Plan a relaxed 3-day trip to Paris with cafés, art, and time to wander.');
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

  it('does not submit whitespace, Shift+Enter, or an IME composition', () => {
    renderLanding();
    const input = screen.getByRole('textbox', { name: 'Tell us about your trip' });
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Explore', exact: true })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Tokyo' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

  it('waits for the existing authentication check before starting a trip', () => {
    auth.loading = true;
    renderLanding();
    const input = screen.getByRole('textbox', { name: 'Tell us about your trip' });
    fireEvent.change(input, { target: { value: 'Tokyo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(screen.getByRole('button', { name: 'Plan a trip to Tokyo' })).toBeDisabled();
  });

  it('keeps a draft when the header login link is used', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.type(screen.getByRole('textbox', { name: 'Tell us about your trip' }), 'Paris');
    await user.click(screen.getByRole('link', { name: 'Log in', exact: true }));
    expect(screen.getByTestId('location')).toHaveTextContent('/login?q=Paris');
  });

  it('offers a public walkthrough without triggering authentication', async () => {
    const user = userEvent.setup();
    renderLanding();
    const tour = screen.getByRole('link', { name: /Take a walkthrough/ });
    expect(tour).toHaveAttribute('href', '#how-it-works');
    expect(within(screen.getByRole('region', { name: /One conversation/ })).getByText('Interactive preview')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next step', exact: true }));
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.signup).not.toHaveBeenCalled();
  });
});
