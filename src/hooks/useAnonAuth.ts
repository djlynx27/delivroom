import { supabase } from '@/integrations/supabase/client';
import { useEffect, useState } from 'react';

type AuthStatus = 'loading' | 'ready' | 'error';

// Cold Android opens can leave the radio/DNS warming up; an un-timed
// signInAnonymously() then hangs forever and the app sits on a blank screen
// until the driver force-closes and reopens. Cap the whole auth handshake so a
// stall surfaces the visible "Réessayer" error UI instead of a black screen.
//
// This used to race the call against its OWN 10s timer on top of the
// Supabase client's fetch already having a 15s AbortController-backed
// timeout (see integrations/supabase/client.ts's fetchWithTimeout). Two
// independent timeouts, the shorter one always winning, meant this always
// fired first and never actually cancelled the in-flight request — which
// then went on to reject on its own 15-20s later as an unhandled
// "AuthRetryableFetchError: signal is aborted without reason", visible only
// in logs after the UI had already shown the hard error. Confirmed on
// device: this fired mid-handshake while the app was backgrounded (Android
// throttles the WebView's network then), a case that isn't a real failure —
// it resolves itself the moment the app is foregrounded again. So: only one
// timeout now (the client's own, already the correct cancel-based one), and
// a backgrounded-during-handshake failure retries once automatically on
// resume instead of going straight to the error screen.
const AUTH_TIMEOUT_MS = 20_000;

class AuthTimeoutError extends Error {
  constructor() {
    super('Connexion trop lente — réessaie.');
    this.name = 'AuthTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function waitForVisible(): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVisible);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
  });
}

export function useAnonAuth(): { status: AuthStatus; error: string | null } {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function attemptHandshake() {
      // getSession() is a local read (persisted session) — the network path
      // is only signInAnonymously().
      const { data } = await withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS);
      if (data.session) {
        if (!cancelled) setStatus('ready');
        return;
      }

      const { error: signInError } = await withTimeout(
        supabase.auth.signInAnonymously(),
        AUTH_TIMEOUT_MS
      );
      if (cancelled) return;

      if (signInError) {
        throw signInError;
      }
      setStatus('ready');
    }

    async function ensureSession(isRetry: boolean) {
      try {
        await attemptHandshake();
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Auth anonyme indisponible.';

        // A failure while backgrounded isn't a real failure — Android
        // throttles the WebView's network while hidden. Wait for the app to
        // come back to the foreground and try once more before giving up.
        if (!isRetry && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          console.warn('[useAnonAuth] handshake failed while backgrounded, retrying on resume:', message);
          await waitForVisible();
          if (!cancelled) void ensureSession(true);
          return;
        }

        console.error('[useAnonAuth] auth handshake failed:', message);
        setError(message);
        setStatus('error');
      }
    }

    void ensureSession(false);
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, error };
}
