// Bayesian shrinkage for per-zone $/h rates.
//
// A zone's observed hourly rate is revenue / hours, and with a handful of
// samples that ratio is dominated by the denominator: one 12-minute $16 ride
// logged in Station Concorde reads as $80/h and outranks a zone with thirty
// stable observations at $31/h. Sample-size *gates* (tripAnalytics'
// MIN_RATE_TRIPS, learningEngine's MIN_OBSERVATIONS_FOR_LEADERBOARD) stop the
// worst of it by refusing to publish a rate at all below a floor, but they say
// nothing about the samples that do clear the floor — 3 trips at $78/h still
// prints $78/h.
//
// Shrinkage handles that residual: the published rate is a weighted average of
// what the zone actually showed and the market prior, with the prior's weight
// fixed at MIN_SAMPLE_WEIGHT "virtual samples". At n=1 the prior carries 5/6 of
// the result; by n=40 it carries 1/9 and the zone's own history dominates. No
// separate confidence flag to thread through the UI — the number itself just
// stops lying.
//
// IMPORTANT — shrinkage is a *display* correction, not a ranking fix. It moves
// a value toward the mean, never across it, so an above-mean thin sample still
// sorts ahead of a below-mean thick one. That ordering problem is what the
// minimum-sample gates exist for (see the long comment above
// MIN_OBSERVATIONS_FOR_LEADERBOARD in learningEngine.ts); this module is
// complementary to them, not a replacement.

/** An observed hourly rate plus how much evidence stands behind it. */
export interface ZoneStats {
  /** Raw observed rate in CAD/h (revenue ÷ hours, or an EMA of it). */
  hourlyRate: number;
  /** Number of trips / observations the rate was computed from. */
  sampleCount: number;
}

/**
 * Market prior for MTL/Laval, CAD/h gross. Sits between the conservative
 * no-history floor used for shift projections (CONSERVATIVE_MIN_PER_H = 22,
 * shiftEarnings.ts) and learningEngine's own Bayesian DEFAULT_PRIOR_MEAN of
 * 25 — deliberately a touch above both, because those two describe *net-ish
 * planning* numbers while the rates shrunk here are gross revenue ÷ hours.
 */
export const GLOBAL_PRIOR_RATE = 28.5;

/**
 * Prior strength in virtual samples (the `k` of the (k·μ + n·x̄) / (k + n)
 * estimator). 5 matches MIN_TRIPS_FOR_REAL_AVG — the same point at which
 * shiftEarnings.ts starts trusting the driver's own overall average at all.
 */
export const MIN_SAMPLE_WEIGHT = 5;

/**
 * Winsorization ceiling on any smoothed rate, CAD/h. Above this is not a good
 * zone, it is a measurement artifact (a missing ended_at, a bonus attributed
 * to a 4-minute ride). Intentionally looser than shiftEarnings'
 * MAX_EARNINGS_PER_HOUR (40): that one caps a forward *projection* a driver
 * will plan a shift around, this one caps a backward-looking observation,
 * where a genuinely exceptional surge hour should still be allowed to read
 * high. Projections stay capped at 40 downstream regardless.
 */
export const MAX_HOURLY_CAP = 55;

export interface SmoothingOptions {
  /**
   * Prior to shrink toward, CAD/h. Defaults to GLOBAL_PRIOR_RATE; pass the
   * driver's own measured market average when one exists so the correction
   * tracks their real baseline instead of a hardcoded constant.
   */
  priorRate?: number;
  /** Prior strength in virtual samples. Defaults to MIN_SAMPLE_WEIGHT. */
  priorWeight?: number;
  /** Winsorization ceiling, CAD/h. Defaults to MAX_HOURLY_CAP. */
  maxRate?: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Shrinks an observed zone rate toward the market prior in proportion to how
 * thin its sample is, then clamps the result to [0, maxRate].
 *
 * Returns the prior itself when there is no usable evidence (zero/negative/
 * non-finite sample count, or a non-finite rate), which is the honest answer
 * for an unobserved zone — not 0, which would read as "this zone is dead".
 */
export function calculateSmoothedHourlyRate(
  stats: ZoneStats,
  options: SmoothingOptions = {}
): number {
  const priorRate = Math.max(0, finiteOr(options.priorRate ?? GLOBAL_PRIOR_RATE, GLOBAL_PRIOR_RATE));
  const priorWeight = Math.max(0, finiteOr(options.priorWeight ?? MIN_SAMPLE_WEIGHT, MIN_SAMPLE_WEIGHT));
  const maxRate = Math.max(0, finiteOr(options.maxRate ?? MAX_HOURLY_CAP, MAX_HOURLY_CAP));

  const sampleCount = Math.max(0, finiteOr(stats.sampleCount, 0));
  const hourlyRate = Math.max(0, finiteOr(stats.hourlyRate, 0));

  if (sampleCount <= 0 || !Number.isFinite(stats.hourlyRate)) {
    return Math.min(priorRate, maxRate);
  }

  // (k·μ + n·x̄) / (k + n). priorWeight 0 degenerates to the raw rate, which
  // is the documented way for a caller to opt out of shrinkage while keeping
  // the cap.
  const denominator = priorWeight + sampleCount;
  const smoothed = (priorWeight * priorRate + sampleCount * hourlyRate) / denominator;

  return Math.min(smoothed, maxRate);
}
