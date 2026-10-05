// supabase/functions/score-calculator/scoreFreshness.ts
//
// Freshness guard for score-calculator. The function is deployed with
// --no-verify-jwt and called straight from the PWA (anon key, anonymous
// sessions included), and every run bulk-INSERTs ~86 rows into `scores`, upserts
// zones.current_score and hits the weather/Gemini APIs. A JWT can't gate it (the
// anon key is a valid JWT), so instead: if the newest scores row is younger than
// the window, skip the whole run. Note the pg_cron recalculate_zone_scores()
// (every 10 min) writes the same table, so its rows also count as "fresh".
//
// Pure (no Deno/Supabase imports) so it can be unit-tested in isolation.

export const SCORE_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/** Seconds left before a recompute is allowed again; 0 = go ahead.
 * Missing/invalid timestamps mean "no usable signal" -> compute (fail open). */
export function freshnessRemainingSeconds(
  latestCalculatedAt: string | null | undefined,
  nowMs: number,
  windowMs: number = SCORE_FRESHNESS_WINDOW_MS,
): number {
  if (!latestCalculatedAt) return 0;
  const latestMs = Date.parse(latestCalculatedAt);
  if (!Number.isFinite(latestMs)) return 0;
  // A timestamp in the future (clock skew) is capped so it can never lock the
  // function out for longer than one window.
  const ageMs = Math.max(0, nowMs - latestMs);
  const remainingMs = windowMs - ageMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}
