// Pure, side-effect-free logic for ingest-lyft-screenshots — split out from
// index.ts so it can be unit-tested (deno test) without triggering index.ts's
// module-level serve() call, which binds a listener on import.

export interface LyftSnapshot {
  demand_score: number;
  wait_time_min: number;
  nearby_drivers_count: number;
}

/** Clamps a Gemini-extracted numeric field into a sane, finite range. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validates and clamps the raw Gemini JSON into a safe LyftSnapshot — a
 * hallucinated demand_score of 47 or a negative wait time must never reach
 * platform_signals (demand_level has a DB-level 0-10 CHECK anyway, but
 * failing closer to the source gives a clearer error).
 */
export function parseLyftSnapshot(raw: unknown): LyftSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (
    obj.demand_score === undefined ||
    obj.wait_time_min === undefined ||
    obj.nearby_drivers_count === undefined
  ) {
    return null;
  }
  return {
    demand_score: clampNumber(obj.demand_score, 1, 10, 5),
    wait_time_min: clampNumber(obj.wait_time_min, 0, 120, 5),
    nearby_drivers_count: Math.round(clampNumber(obj.nearby_drivers_count, 0, 200, 0)),
  };
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}
