// Auto-promotion algorithm for "zone discoveries" (addresses the AI has seen
// repeatedly in screenshots but that aren't in the zone catalog yet). A
// discovery only clears this gate once it's both a recurring spot AND a
// genuine earner — otherwise it stays in manual review (AdminZoneDiscoveriesScreen).

export interface DiscoveryPerformance {
  /** zone_discoveries.count — how many times this exact address was seen. */
  occurrenceCount: number;
  /** How many real trips (via get_discovery_performance RPC) back the averages below. */
  sampleSize: number;
  avgPerKm: number | null;
  avgPerH: number | null;
}

export interface MajorZoneBenchmark {
  avgPerKm: number;
  avgPerH: number;
}

// n >= 3 real occurrences before a coincidence gets treated as a pattern;
// n >= 3 matched trips before an average is trusted rather than noise.
export const MIN_OCCURRENCES_FOR_AUTO_PROMOTION = 3;
export const MIN_SAMPLE_SIZE_FOR_AUTO_PROMOTION = 3;

export interface PromotionVerdict {
  eligible: boolean;
  reason: string;
}

/**
 * A discovery auto-promotes only when it's recurring (occurrenceCount) AND
 * its own real-trip performance ($/km and $/h) is at least as good as the
 * major zones' benchmark — never on repetition alone, never on performance
 * alone with too few samples to trust.
 */
export function evaluatePromotionCandidate(
  perf: DiscoveryPerformance,
  benchmark: MajorZoneBenchmark,
): PromotionVerdict {
  if (perf.occurrenceCount < MIN_OCCURRENCES_FOR_AUTO_PROMOTION) {
    return {
      eligible: false,
      reason: `Vu ${perf.occurrenceCount}× seulement (minimum ${MIN_OCCURRENCES_FOR_AUTO_PROMOTION})`,
    };
  }
  if (
    perf.sampleSize < MIN_SAMPLE_SIZE_FOR_AUTO_PROMOTION ||
    perf.avgPerKm == null ||
    perf.avgPerH == null
  ) {
    return {
      eligible: false,
      reason: `Pas assez de courses réelles rattachées (${perf.sampleSize}/${MIN_SAMPLE_SIZE_FOR_AUTO_PROMOTION})`,
    };
  }
  if (perf.avgPerKm < benchmark.avgPerKm) {
    return {
      eligible: false,
      reason: `$/km (${perf.avgPerKm.toFixed(2)}) sous les zones majeures (${benchmark.avgPerKm.toFixed(2)})`,
    };
  }
  if (perf.avgPerH < benchmark.avgPerH) {
    return {
      eligible: false,
      reason: `$/h (${perf.avgPerH.toFixed(2)}) sous les zones majeures (${benchmark.avgPerH.toFixed(2)})`,
    };
  }
  return {
    eligible: true,
    reason: `≥ zones majeures sur ${perf.sampleSize} course(s) réelle(s)`,
  };
}
