import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GoogleAuthSuccess from '../src/pages/GoogleAuthSuccess';
import LoginPage from '../src/pages/LoginPage';

vi.mock('../src/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false, login: vi.fn() }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth/google/success" element={<GoogleAuthSuccess />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/trips" element={<div>My trips</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Google auth handoff', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/auth/google/success');
  });

  it('reads the token from the URL fragment, stores it and clears the hash', () => {
    window.history.replaceState(null, '', '/auth/google/success#token=abc.def&redirect=trips');
    renderAt('/auth/google/success');
    expect(localStorage.getItem('tripwhat_token')).toBe('abc.def');
    expect(window.location.hash).toBe('');
    expect(screen.getByText('My trips')).toBeInTheDocument();
  });

  it('still accepts the legacy ?token= query', () => {
    renderAt('/auth/google/success?token=legacy&redirect=trips');
    expect(localStorage.getItem('tripwhat_token')).toBe('legacy');
  });

  it('shows messages for Google account errors on the login page', () => {
    renderAt('/login?error=google_account_exists');
    expect(
      screen.getByText('An account with this email already exists. Log in with your password.'),
    ).toBeInTheDocument();
  });

  it('shows a message for unverified Google emails', () => {
    renderAt('/login?error=google_unverified');
    expect(screen.getByText("Google couldn't verify this email.")).toBeInTheDocument();
  });
});
