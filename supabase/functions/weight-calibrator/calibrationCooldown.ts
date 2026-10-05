// supabase/functions/weight-calibrator/calibrationCooldown.ts
//
// Anti-ratchet cooldown for weight-calibrator's POST. The function is deployed
// --no-verify-jwt, every POST persists a new weight_history row and moves each
// weight by up to MAX_WEIGHT_DELTA (0.08), clamped to [0.03, 0.45]: without a
// cooldown, repeated calls drive the weights to their bounds. At most one
// calibration per CALIBRATION_COOLDOWN_MS (GET stays free).
//
// Reuses the pure freshness helper from score-calculator (same semantics:
// missing/invalid timestamp -> 0 = go ahead, future timestamps capped to one window).

import { freshnessRemainingSeconds } from '../score-calculator/scoreFreshness.ts';

export const CALIBRATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Seconds left before another calibration is allowed; 0 = go ahead. */
export function calibrationCooldownRemainingSeconds(
  lastCalibratedAt: string | null | undefined,
  nowMs: number,
): number {
  return freshnessRemainingSeconds(lastCalibratedAt, nowMs, CALIBRATION_COOLDOWN_MS);
}
