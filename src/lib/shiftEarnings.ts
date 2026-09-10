// Pure calibration helpers for ShiftOptimizer's $/h projections — split out
// of the component so they're independently testable (and don't trip the
// react-refresh "only export components" lint rule on a .tsx file).

import type { TripWithZone } from '@/hooks/useTrips';
import {
  DEADHEAD_PENALTY_FACTOR,
  type LearningInsights,
} from '@/lib/learningEngine';
import { getTripHours, getTripRevenue } from '@/lib/tripAnalytics';

// ── Score-to-$/h mapping — conservative last-resort default ───────────────────
// Used ONLY when there's no real trip history to calibrate against at all
// (brand-new driver, or getRealAvgEarningsPerHour hasn't reached its minimum
// sample size). Previously this curve alone drove every projection (score 80
// → $45/h) regardless of the driver's actual results, which is why a 4h
// "demande moyenne" shift projected ~$141 ($35/h) against a real average well
// below that. $22–25/h net, nudged by zone score — real history always wins
// over this once there's enough of it (see getLearningAdjustedEarningsPerHour
// in ShiftOptimizer.tsx).
export const CONSERVATIVE_MIN_PER_H = 22;
export const CONSERVATIVE_MAX_PER_H = 25;

// Hard ceiling on any projected $/h for the MTL/Laval market — applied after
// blending real history/EMA/conservative default, so a noisy sample (e.g. one
// short high-fare trip skewing revenue/hours) can never inflate a shift
// projection past what's realistically achievable in this market.
export const MAX_EARNINGS_PER_HOUR = 40;

export function scoreToEarningsPerH(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    CONSERVATIVE_MIN_PER_H +
    (clamped / 100) * (CONSERVATIVE_MAX_PER_H - CONSERVATIVE_MIN_PER_H)
  );
}

// Below this many logged trips, the overall average $/h is too noisy to
// trust on its own — callers should blend it toward the conservative
// default rather than using it outright until trust grows.
export const MIN_TRIPS_FOR_REAL_AVG = 5;
export const REAL_AVG_FULL_TRUST_AT_TRIPS = 40;

export interface RealEarningsAverage {
  perHour: number;
  tripCount: number;
}

/** Overall $/h across the driver's own logged trip history (revenue+tips /
 * elapsed hours) — the calibration source of truth, preferred over the
 * theoretical curve. Null when there isn't enough history yet to trust it. */
export function getRealAvgEarningsPerHour(
  trips: TripWithZone[]
): RealEarningsAverage | null {
  // A caller may pass a list fetched with includeSynthetic: true (e.g. for
  // learning-insights derivation) — this helper's name and contract promise
  // the driver's own real history, so it must not trust seedSyntheticTrips.ts
  // rows even if they slip through.
  const realTrips = trips.filter((trip) => trip.source === 'real');
  let revenue = 0;
  let hours = 0;
  for (const trip of realTrips) {
    revenue += getTripRevenue(trip);
    hours += getTripHours(trip);
  }
  if (realTrips.length < MIN_TRIPS_FOR_REAL_AVG || hours <= 0) return null;
  return { perHour: revenue / hours, tripCount: realTrips.length };
}

/** Weighted average of two $/h estimates — `trust` is the weight on `preferred`. */
export function blend(preferred: number, fallback: number, trust: number): number {
  return trust * preferred + (1 - trust) * fallback;
}

/** Whether this zone's logged trips show a heavy average pickup approach
 * (deadhead) — the penalty is per-zone, not per-slot, so any matching
 * pattern (whatever day/slot it came from) carries the same flag. */
function zoneHasHeavyDeadhead(
  learningInsights: LearningInsights | null,
  zoneId: string
): boolean {
  return (
    learningInsights?.emaPatterns.some(
      (pattern) => pattern.zoneId === zoneId && pattern.deadheadPenaltyApplied
    ) ?? false
  );
}

/** $/h projection for one recommended shift block: theoretical curve →
 * blended with the driver's real average → blended with the exact
 * zone/day/slot EMA when enough observations exist — with a deadhead
 * discount applied wherever the best zone is known to eat extra unpaid
 * approach distance, so a projected block in that zone doesn't quote a
 * number the driver won't actually see. */
export function getLearningAdjustedEarningsPerHour({
  bestScore,
  block,
  bestZoneId,
  learningInsights,
  jsDay,
  realAvg,
}: {
  bestScore: number;
  block: { startHour: number };
  bestZoneId: string;
  learningInsights: LearningInsights | null;
  jsDay: number;
  realAvg: RealEarningsAverage | null;
}): number {
  const conservativeDefault = scoreToEarningsPerH(bestScore);

  // Overall real average takes priority over the theoretical default once
  // there's enough logged history — trust scales with sample size so a
  // handful of trips doesn't fully override the conservative floor.
  const baseline = realAvg
    ? blend(
        realAvg.perHour,
        conservativeDefault,
        Math.min(1, realAvg.tripCount / REAL_AVG_FULL_TRUST_AT_TRIPS)
      )
    : conservativeDefault;

  // Neither the driver's overall average nor the theoretical curve knows
  // this specific zone eats extra unpaid approach distance — apply the same
  // discount learningEngine.ts already uses for a zone's own EMA (the
  // exact-slot EMA branch below already carries this baked in; this covers
  // the far more common case where no exact zone/day/slot match exists yet).
  const deadheadAdjustedBaseline = zoneHasHeavyDeadhead(learningInsights, bestZoneId)
    ? baseline * DEADHEAD_PENALTY_FACTOR
    : baseline;

  if (!learningInsights) {
    return deadheadAdjustedBaseline;
  }

  const slotIdx = block.startHour * 4;
  const emaPattern = learningInsights.emaPatterns.find(
    (pattern) =>
      pattern.dayOfWeek === jsDay &&
      Math.abs(pattern.slotIndex - slotIdx) < 8 &&
      pattern.zoneId === bestZoneId
  );

  if (!emaPattern || emaPattern.observationCount < 2) {
    return deadheadAdjustedBaseline;
  }

  // Most granular real signal available (this exact zone/day/slot) —
  // outranks both the overall average and the theoretical default.
  const emaTrust = Math.min(0.85, emaPattern.observationCount * 0.1);
  return blend(emaPattern.emaEarningsPerHour, deadheadAdjustedBaseline, emaTrust);
}

// Strips non-digits and leading zeros ("02100" -> "2100", "00" -> "0",
// "" -> ""). A plain `type="number"` bound straight to numeric state
// re-derives its displayed value from `Number(...)` on every keystroke, so
// an empty field instantly snaps back to "0" instead of staying empty, and
// on WebViews that don't strip leading zeros themselves (the Android TWA
// this app ships as) typing after that stuck "0" produced "02100".
export function sanitizeTargetRevenueInput(raw: string): string {
  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly === '') return '';
  return String(Number(digitsOnly));
}
