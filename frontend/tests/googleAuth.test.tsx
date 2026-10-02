import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GoogleAuthSuccess from '../src/pages/GoogleAuthSuccess';
import LoginPage from '../src/pages/LoginPage';

const loginWithToken = vi.fn(async (token: string) => {
  localStorage.setItem('tripwhat_token', token);
  return { id: 1, name: 'Test', email: 't@example.com' };
});

vi.mock('../src/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false, login: vi.fn(), loginWithToken }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth/google/success" element={<GoogleAuthSuccess />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/trips" element={<div>My trips</div>} />
        <Route path="/new" element={<div>New trip</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Google auth handoff', () => {
  beforeEach(() => {
    localStorage.clear();
    loginWithToken.mockClear();
    window.history.replaceState(null, '', '/auth/google/success');
  });

  it('authenticates via the context with the fragment token, then lands on the redirect', async () => {
    window.history.replaceState(null, '', '/auth/google/success#token=abc.def&redirect=trips');
    renderAt('/auth/google/success');
    await waitFor(() => expect(loginWithToken).toHaveBeenCalledWith('abc.def'));
    expect(localStorage.getItem('tripwhat_token')).toBe('abc.def');
    expect(window.location.hash).toBe('');
    await waitFor(() => expect(screen.getByText('My trips')).toBeInTheDocument());
  });

  it('navigates to a deep redirect like /new?q=...', async () => {
    window.history.replaceState(null, '', '/auth/google/success#token=t.t&redirect=new%3Fq%3Dparis');
    renderAt('/auth/google/success');
    await waitFor(() => expect(screen.getByText('New trip')).toBeInTheDocument());
  });

  it('still accepts the legacy ?token= query', async () => {
    renderAt('/auth/google/success?token=legacy&redirect=trips');
    await waitFor(() => expect(loginWithToken).toHaveBeenCalledWith('legacy'));
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
