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
