import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

// 'ready' from the very first render — see below. 'degraded' means the last
// background attempt failed; nothing in the app gates on it, it exists only
// as an optional diagnostic signal.
type AuthStatus = 'ready' | 'degraded';

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

// Shared in-flight guard: this hook's own background attempt() and any
// on-demand caller (e.g. getAuthedUserId in screenshotDedup.ts, needed
// before a bulk upload can start) must never both call signInAnonymously()
// at once — each call mints a brand new anonymous user with no way to
// dedupe, so a race would silently fork the driver's identity mid-session.
// Confirmed on-device: a bulk batch started right after opening the app
// (before this hook's own attempt() had finished) hit "Authentification
// requise" on its first few files because there was no session yet to
// refresh — refreshSession() needs an existing session's refresh token,
// it can't create one from nothing.
let inFlightSignIn: Promise<Session | null> | null = null;

// A live Supabase-side audit (2026-09-20, this project) traced the recurring
// "Authentification requise" to intermittent PgBouncer/Postgres contention
// (unrelated background dashboard queries), causing GoTrue to 504 on
// /signup and /token for roughly 12-50s at a stretch — not a permanent
// outage, not an RLS/config issue. A single attempt at even a generous
// timeout can still lose that race; a short bounded retry rides out one
// transient window without risking an unbounded hang.
const SIGN_IN_RETRY_DELAYS_MS = [5_000, 10_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signInAnonymouslyWithRetry(): Promise<Session | null> {
  for (let attempt = 0; ; attempt++) {
    const { data: signedIn, error } = await supabase.auth.signInAnonymously();
    if (!error) return signedIn.session;

    const delayMs = SIGN_IN_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined) {
      console.warn('[useAnonAuth] signInAnonymously failed after retries', error);
      return null;
    }
    console.warn(
      `[useAnonAuth] signInAnonymously failed, retrying in ${delayMs}ms`,
      error,
    );
    await sleep(delayMs);
  }
}

/** Resolves once a session exists — the current one if valid, otherwise a
 * freshly established anonymous one. Safe to call from anywhere; concurrent
 * callers (this hook's own effect, or an on-demand caller) share the same
 * in-flight sign-in instead of racing separate ones. */
export async function ensureAuthSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  if (!inFlightSignIn) {
    inFlightSignIn = signInAnonymouslyWithRetry().finally(() => {
      inFlightSignIn = null;
    });
  }
  return inFlightSignIn;
}

// This used to be a hard gate: AppContent wouldn't mount at all until this
// resolved, and a failure (slow network, backgrounded mid-handshake, fully
// offline) showed a full-screen "Connexion impossible" blocker with no way
// past it except a manual reload — confirmed on-device this can wedge the
// app completely on a bad connection, unacceptable for a driver mid-shift
// who needs Drive/the shift tracker regardless of Supabase reachability.
//
// Auth is now a background concern only. getSession() (local, no network)
// picks up a persisted session near-instantly when one exists; when it
// doesn't, the app renders immediately anyway and signInAnonymously() keeps
// retrying silently with backoff until it succeeds or the user goes back
// online. Individual Supabase-backed screens already handle their own
// query failures — that's the right layer for "no session yet", not the
// app shell.
export function useAnonAuth(): { status: AuthStatus; error: string | null } {
  const [status, setStatus] = useState<AuthStatus>('ready');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryDelay = RETRY_BASE_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function attempt() {
      try {
        const session = await ensureAuthSession();
        if (cancelled) return;
        if (!session) throw new Error('Auth anonyme indisponible.');

        setStatus('ready');
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Auth anonyme indisponible.';
        console.warn(
          '[useAnonAuth] handshake failed, app stays usable — retrying in background:',
          message
        );
        setStatus('degraded');
        setError(message);

        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
          void attempt();
        }, retryDelay);
      }
    }

    void attempt();

    const onOnline = () => {
      retryDelay = RETRY_BASE_MS;
      if (retryTimer) clearTimeout(retryTimer);
      void attempt();
    };
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return { status, error };
}
