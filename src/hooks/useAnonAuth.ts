import { supabase } from '@/integrations/supabase/client';
import { useEffect, useState } from 'react';

// 'ready' from the very first render — see below. 'degraded' means the last
// background attempt failed; nothing in the app gates on it, it exists only
// as an optional diagnostic signal.
type AuthStatus = 'ready' | 'degraded';

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

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
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          if (!cancelled) {
            setStatus('ready');
            setError(null);
          }
          return;
        }

        const { error: signInError } = await supabase.auth.signInAnonymously();
        if (cancelled) return;
        if (signInError) throw signInError;

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
