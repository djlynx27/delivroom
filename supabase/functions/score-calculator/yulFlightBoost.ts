// supabase/functions/score-calculator/yulFlightBoost.ts
//
// Converts a live YUL incoming-arrivals count into a score boost applied
// only to 'aéroport'-type zones. Split out from index.ts (which owns the
// live Aviationstack fetch, not testable without network I/O) so the pure
// scoring logic gets the same Deno.test coverage as eventBoost.ts.

// Points added per live incoming flight, capped the same way weather (50)
// and event boosts (25) are -- a flight surge should be a strong signal but
// never alone drive a zone to 100.
export const YUL_FLIGHT_BOOST_PER_FLIGHT = 1.2;
export const YUL_FLIGHT_BOOST_CAP = 30;

export function computeYulFlightBoost(incomingFlightsCount: number | null): number {
  if (incomingFlightsCount == null || incomingFlightsCount <= 0) return 0;
  return Math.min(
    YUL_FLIGHT_BOOST_CAP,
    Math.round(incomingFlightsCount * YUL_FLIGHT_BOOST_PER_FLIGHT)
  );
}

// Aviationstack is quota-limited, and score-calculator can be invoked by
// anyone (deployed --no-verify-jwt). Reuse the snapshot persisted in
// yul_flight_stats instead of re-fetching on every invocation. 4h matches
// the s-maxage already used by the Vercel route api/yul-flights.ts.
export const YUL_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

export function isYulSnapshotFresh(
  fetchedAt: string | null | undefined,
  nowMs: number,
  ttlMs: number = YUL_CACHE_TTL_MS
): boolean {
  if (!fetchedAt) return false;
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return false;
  const ageMs = nowMs - fetchedMs;
  return ageMs >= 0 && ageMs < ttlMs;
}
