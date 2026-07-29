import { supabase } from '@/integrations/supabase/client';
import { useEffect, useState } from 'react';

type AuthStatus = 'loading' | 'ready' | 'error';

// Cold Android opens can leave the radio/DNS warming up; an un-timed
// signInAnonymously() then hangs forever and the app sits on a blank screen
// until the driver force-closes and reopens. Cap the whole auth handshake so a
// stall surfaces the visible "Réessayer" error UI instead of a black screen.
const AUTH_TIMEOUT_MS = 10_000;

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

export function useAnonAuth(): { status: AuthStatus; error: string | null } {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function ensureSession() {
      try {
        // getSession() is a local read (persisted session) — the network path
        // is only signInAnonymously(). Race the whole thing against a timeout.
        const { data } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_TIMEOUT_MS
        );
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
          console.error('[useAnonAuth] signInAnonymously failed:', signInError);
          setError(signInError.message);
          setStatus('error');
          return;
        }
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Auth anonyme indisponible.';
        console.error('[useAnonAuth] auth handshake failed:', message);
        setError(message);
        setStatus('error');
      }
    }

    void ensureSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, error };
}
