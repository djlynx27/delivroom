import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Support both key naming conventions
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  '';

// Plain fetch never times out on its own — confirmed on a real device that a
// request can hang forever with zero response (Supabase connection-pool
// exhaustion after a heavy batch import), which froze every screen reading
// from this same client, Drive included, since nothing ever rejected.
// AbortController here is the floor: every request now fails fast instead
// of hanging indefinitely, regardless of cause.
const REQUEST_TIMEOUT_MS = 15_000;

// signInAnonymously()/refreshSession() got their own, longer floor after a
// real device logged this exact fetch aborting repeatedly with zero bytes
// received. A live Supabase-side audit (2026-09-20, this project) traced it
// to intermittent PgBouncer/Postgres contention from unrelated background
// dashboard queries, causing GoTrue itself to take 12-50s (confirmed up to
// 40s+ with a direct curl from a different network entirely, ruling out the
// device/WebView) before returning its own 504 — not a permanent outage,
// not an RLS/config issue. Sized comfortably past that reported worst case
// so the client waits for GoTrue's own response/504 instead of racing it
// with an earlier abort. Kept separate from REQUEST_TIMEOUT_MS rather than
// raising it globally: a hang during a 700+ file batch (storage/functions
// calls) is exactly what the tighter floor still needs to catch fast.
const AUTH_REQUEST_TIMEOUT_MS = 60_000;

function isAuthRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return url.includes('/auth/v1/');
}

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeoutMs = isAuthRequest(input) ? AUTH_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  // A caller-supplied signal (e.g. a manual .abortSignal() on a query) must
  // still cancel the request — chain it into ours rather than overwriting it.
  init?.signal?.addEventListener('abort', () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId),
  );
}

// Safe client: returns a no-op client when env vars are missing (avoids crash at module load time)
export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          storage:
            typeof localStorage !== 'undefined' ? localStorage : undefined,
          persistSession: true,
          autoRefreshToken: true,
        },
        global: {
          fetch: fetchWithTimeout,
        },
      })
    : createClient<Database>(
        'https://placeholder.supabase.co',
        'placeholder-anon-key'
      );
