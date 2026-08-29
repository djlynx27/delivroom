// Pure calibration helpers for ShiftOptimizer's $/h projections — split out
// of the component so they're independently testable (and don't trip the
// react-refresh "only export components" lint rule on a .tsx file).

import type { TripWithZone } from '@/hooks/useTrips';
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
  let revenue = 0;
  let hours = 0;
  for (const trip of trips) {
    revenue += getTripRevenue(trip);
    hours += getTripHours(trip);
  }
  if (trips.length < MIN_TRIPS_FOR_REAL_AVG || hours <= 0) return null;
  return { perHour: revenue / hours, tripCount: trips.length };
}

/** Weighted average of two $/h estimates — `trust` is the weight on `preferred`. */
export function blend(preferred: number, fallback: number, trust: number): number {
  return trust * preferred + (1 - trust) * fallback;
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
