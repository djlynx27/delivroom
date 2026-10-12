function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface LyftMarketSignal {
  demandLevel?: number | null;
  estimatedWaitMin?: number | null;
  surgeActive?: boolean | null;
}

export interface SuccessProbabilityInput extends LyftMarketSignal {
  demandContextScore: number;
  distanceKm?: number | null;
}

export interface HabitBoostInput {
  score: number;
  similarity?: number | null;
  successfulMatches?: number;
  coldZoneThreshold?: number;
}

export function computeProximityFactor(distanceKm?: number | null) {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return 0.55;
  if (distanceKm <= 0.5) return 1;
  return round(clamp(1 - distanceKm / 12, 0.35, 1), 3);
}

export function estimateDriverSupply({
  demandLevel,
  estimatedWaitMin,
  surgeActive,
  demandContextScore,
}: LyftMarketSignal & { demandContextScore: number }) {
  const normalizedDemand = clamp(
    Number.isFinite(Number(demandLevel))
      ? Number(demandLevel)
      : clamp(demandContextScore / 10, 0, 10),
    0,
    10
  );
  const waitPressure = clamp(Number(estimatedWaitMin ?? 6) / 12, 0, 1.5);
  const saturationPenalty = clamp((10 - normalizedDemand) / 2.5, 0, 4);
  const noSurgePenalty = surgeActive === false ? 0.75 : 0;

  return round(saturationPenalty + waitPressure + noSurgePenalty, 2);
}

export function computeSuccessProbabilityScore({
  demandContextScore,
  distanceKm,
  demandLevel,
  estimatedWaitMin,
  surgeActive,
}: SuccessProbabilityInput) {
  const demandContext = clamp(demandContextScore / 100, 0, 1);
  const driverSupply = estimateDriverSupply({
    demandContextScore,
    demandLevel,
    estimatedWaitMin,
    surgeActive,
  });
  const proximityFactor = computeProximityFactor(distanceKm);
  const probability = clamp(
    (demandContext / (driverSupply + 1)) * proximityFactor,
    0,
    1
  );

  return {
    successProbability: round(probability, 4),
    score: Math.round(probability * 100),
    driverSupply,
    proximityFactor,
  };
}

/**
 * Lab (taxi) base score: the demand context as-is. computeSuccessProbabilityScore
 * models rideshare driver supply (demand / (supply + 1) x proximity) and, even
 * with no Lyft signal, collapses a 70 to ~15 -- which made distance dominate
 * the Lab ranking. Proximity is already penalized at ranking time, so it is
 * neutral (1) here.
 */
export function computeTaxiBaseScore(demandContextScore: number) {
  const score = Math.round(clamp(demandContextScore, 0, 100));
  return {
    successProbability: round(score / 100, 4),
    score,
    driverSupply: 0,
    proximityFactor: 1,
  };
}

export function applyHabitBoost({
  score,
  similarity,
  successfulMatches = 0,
  coldZoneThreshold = 55,
}: HabitBoostInput) {
  const normalizedSimilarity = Number(similarity ?? 0);
  const shouldBoost =
    score <= coldZoneThreshold &&
    successfulMatches > 0 &&
    normalizedSimilarity >= 0.78;

  if (!shouldBoost) {
    return {
      applied: false,
      score,
      boostPercent: 0,
    };
  }

  return {
    applied: true,
    score: Math.min(100, Math.round(score * 1.3)),
    boostPercent: 30,
  };
}
