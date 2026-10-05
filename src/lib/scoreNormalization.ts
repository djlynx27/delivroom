// Lab experiment (2026-10): how to display zone demand scores when peak-hour raw
// scores exceed 100. recalculate_zone_scores() computes
//   raw = base_score x timeFactor x dayFactor   (+ boosts, then clamped to 0..100)
// and a Friday 18h peak multiplies by 1.30 x 1.30 = 1.69, so ~22 of 86 zones hit
// the ceiling and only ~17 distinct values survive. Pure functions only — nothing
// here touches the DB, the live scoring or the UI. Used by scripts/lab-score-normalizer.ts.

export const SCORE_CEILING = 100;
/** Highest time factor x highest day factor in recalculate_zone_scores (1.30 x 1.30). */
export const PEAK_FACTOR = 1.3 * 1.3;

export type NormalizationMethod = 'clamp' | 'softKnee' | 'fixedRescale' | 'percentileRank';

export const NORMALIZATION_METHODS: readonly NormalizationMethod[] = [
  'clamp',
  'softKnee',
  'fixedRescale',
  'percentileRank',
] as const;

// ── Raw score (mirror of recalculate_zone_scores, without event/weather boosts) ──

function timeFactor(hour: number): number {
  if (hour <= 2) return 1.2;
  if (hour <= 5) return 0.6;
  if (hour <= 8) return 1.1;
  if (hour <= 10) return 0.9;
  if (hour <= 13) return 1.0;
  if (hour <= 16) return 0.85;
  if (hour <= 19) return 1.3;
  return 1.15;
}

const DAY_FACTORS = [0.85, 0.9, 0.9, 0.95, 1.0, 1.3, 1.25] as const; // 0 = Sunday

/** Unclamped raw score for a zone at a given Montreal hour (0-23) / weekday (0 = Sunday). */
export function rawScore(baseScore: number, zoneType: string | null, dayOfWeek: number, hour: number): number {
  const day = DAY_FACTORS[dayOfWeek] ?? 1.0;
  let raw = baseScore * timeFactor(hour) * day;
  if (zoneType === 'commercial' && (hour >= 22 || hour < 6)) raw *= 0.1; // closed-mall penalty
  return raw;
}

// ── The four methods ──────────────────────────────────────────────────────────

/** Current behaviour: hard ceiling. Everything above 100 collapses onto 100. */
export function clampScore(raw: number): number {
  return Math.min(SCORE_CEILING, Math.max(0, raw));
}

/**
 * Identity up to `knee`, then an exponential approach to 100 with slope 1 at the
 * knee (continuous and smooth) — strictly increasing, so it never creates ties
 * or reorders zones, and low/mid scores keep their absolute meaning.
 */
export function softKneeScore(raw: number, knee = 80): number {
  if (raw <= knee) return Math.max(0, raw);
  const room = SCORE_CEILING - knee;
  return knee + room * (1 - Math.exp(-(raw - knee) / room));
}

/** Fixed linear rescale: the highest score the formula can ever produce maps to 100. */
export function fixedRescaleScore(raw: number, maxPossibleRaw: number): number {
  if (maxPossibleRaw <= 0) return 0;
  return Math.max(0, (raw * SCORE_CEILING) / maxPossibleRaw);
}

/** Percentile rank within the snapshot (ties get their average rank), 0..100. */
export function percentileRankScores(raws: readonly number[]): number[] {
  const n = raws.length;
  if (n === 0) return [];
  if (n === 1) return [50];
  return raws.map((value) => {
    let less = 0;
    let equal = 0;
    for (const other of raws) {
      if (other < value) less++;
      else if (other === value) equal++;
    }
    return ((less + (equal - 1) / 2) / (n - 1)) * SCORE_CEILING;
  });
}

export interface NormalizeOptions {
  knee?: number;
  /** For fixedRescale: the highest raw the formula can produce (maxBase x PEAK_FACTOR). */
  maxPossibleRaw: number;
}

export function normalizeAll(
  raws: readonly number[],
  options: NormalizeOptions
): Record<NormalizationMethod, number[]> {
  return {
    clamp: raws.map(clampScore),
    softKnee: raws.map((r) => softKneeScore(r, options.knee)),
    fixedRescale: raws.map((r) => fixedRescaleScore(r, options.maxPossibleRaw)),
    percentileRank: percentileRankScores(raws),
  };
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface RankAgreement {
  /** Kendall tau-b between raw and normalized (1 = same order, ties in either side lower it). */
  tau: number;
  /** Pairs strictly ordered in raw but strictly REVERSED after normalization. */
  inversions: number;
}

export function rankAgreement(raws: readonly number[], normalized: readonly number[]): RankAgreement {
  let concordant = 0;
  let discordant = 0;
  let tiedRawOnly = 0;
  let tiedNormOnly = 0;
  for (let i = 0; i < raws.length; i++) {
    for (let j = i + 1; j < raws.length; j++) {
      const dr = Math.sign((raws[i] ?? 0) - (raws[j] ?? 0));
      const dn = Math.sign((normalized[i] ?? 0) - (normalized[j] ?? 0));
      if (dr === 0 && dn === 0) continue;
      if (dr === 0) tiedRawOnly++;
      else if (dn === 0) tiedNormOnly++;
      else if (dr === dn) concordant++;
      else discordant++;
    }
  }
  const denom = Math.sqrt(
    (concordant + discordant + tiedRawOnly) * (concordant + discordant + tiedNormOnly)
  );
  return { tau: denom === 0 ? 1 : (concordant - discordant) / denom, inversions: discordant };
}

export interface NormalizationMetrics extends RankAgreement {
  /** Zones whose DISPLAYED (integer-rounded) score is 100. */
  at100: number;
  /** Distinct displayed (integer-rounded) values — the visible resolution. */
  distinctValues: number;
  min: number;
  max: number;
}

export function computeMetrics(raws: readonly number[], normalized: readonly number[]): NormalizationMetrics {
  const displayed = normalized.map((v) => Math.round(v));
  return {
    ...rankAgreement(raws, normalized),
    at100: displayed.filter((v) => v >= SCORE_CEILING).length,
    distinctValues: new Set(displayed).size,
    min: Math.min(...normalized),
    max: Math.max(...normalized),
  };
}
