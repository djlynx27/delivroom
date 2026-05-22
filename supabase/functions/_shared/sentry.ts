// Shared Sentry helper for all Delivroom Edge Functions.
//
// Why a wrapper rather than importing the SDK directly in every function:
// - Single source of truth for the DSN env var, environment tag, sample rate
// - One place to update when @sentry/deno releases a breaking change
// - Lets us no-op gracefully when SENTRY_DSN is not configured (e.g. local
//   `supabase functions serve`) instead of crashing the function

import * as Sentry from 'https://deno.land/x/sentry@7.119.1/index.mjs';

let initialised = false;

function ensureInit(): boolean {
  if (initialised) return true;
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: 'edge-function',
    // Sample 100 % of errors (free tier 5K/month is plenty for server-side)
    sampleRate: 1.0,
    // No transaction tracing on server side — keeps the budget for errors
    tracesSampleRate: 0,
  });
  initialised = true;
  return true;
}

/**
 * Capture an exception. Adds the function slug as a tag so we can filter in
 * the Sentry UI. Falls back to console.error when Sentry is not configured.
 */
export function captureEdgeException(
  err: unknown,
  functionSlug: string,
  extra: Record<string, unknown> = {},
): void {
  if (!ensureInit()) {
    console.error(`[${functionSlug}] (Sentry disabled)`, err, extra);
    return;
  }
  Sentry.withScope((scope) => {
    scope.setTag('edge_function', functionSlug);
    for (const [key, value] of Object.entries(extra)) {
      scope.setExtra(key, value);
    }
    Sentry.captureException(err);
  });
}

/**
 * Wraps a Deno.serve handler so any thrown exception is sent to Sentry before
 * being re-thrown as a 500 response. Usage:
 *
 *   serve(withSentry('my-function', async (req) => { ... }))
 */
export function withSentry(
  functionSlug: string,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (err) {
      captureEdgeException(err, functionSlug, {
        url: req.url,
        method: req.method,
      });
      throw err;
    }
  };
}
