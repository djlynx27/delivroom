import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

// Anonymous Supabase auth performs a real network fetch (signInAnonymously) that
// isn't reachable in CI's sandbox, which parked the app on its error screen and
// hid the nav shell. Mock the hook to 'ready' so this test exercises the rendered
// shell deterministically instead of depending on live network.
vi.mock('@/hooks/useAnonAuth', () => ({
  useAnonAuth: () => ({ status: 'ready', error: null }),
}));

describe('App', () => {
  it('renders the bottom navigation shell', async () => {
    render(<App />);
    expect(
      await screen.findByText(/Auj\.|Aujourd'hui|Today/i)
    ).toBeInTheDocument();
  });
});
