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

// ── Hour-clustered guardrail ("Algorithm Alignment" policy, 2026-09-19) ────
// A discovered micro-zone must NEVER outrank a major hub in the Hero Zone
// ranking on raw occurrence count alone -- the same failure mode that
// required gating zone_discoveries_auto_promote_trg (see migration
// 20260919120000) can resurface through live scoring instead of promotion.
// It may only surface/boost when BOTH hold for the CURRENT hour window and
// day-type (backed by src/../../supabase/migrations/20260919130000_hour_clustered_discovery_performance.sql
// RPCs get_discovery_performance_at_hour / get_major_zone_benchmark_at_hour):
//   1. >= 3 real trips at that address inside that specific hour window
//      (not 3 occurrences ever, at any time of day).
//   2. $/km AND $/h at that window beat the major zones' own $/km and $/h
//      at that SAME window (not the all-day average).
// Without both, the discovery stays 'pending' / secondary and must never
// become a Hero Zone recommendation.
export const MIN_SAMPLE_SIZE_AT_HOUR = 3;

export interface HourWindow {
  /** Inclusive, 0-23. */
  startHour: number;
  /** Exclusive, 0-23; wraps past midnight when < startHour. */
  endHour: number;
  weekend: boolean;
}

/** Buckets a Date into the (startHour, endHour, weekend) triple the DB RPCs expect. */
export function hourWindowFor(now: Date, windowSizeHours = 1): HourWindow {
  const hour = now.getHours();
  const day = now.getDay();
  return {
    startHour: hour,
    endHour: (hour + windowSizeHours) % 24,
    weekend: day === 0 || day === 6,
  };
}

/**
 * Same shape as evaluatePromotionCandidate, but never eligible on repetition
 * or all-day performance alone -- both the recurrence AND the financial bar
 * must be met specifically within the current hour window.
 */
export function evaluateHourClusteredCandidate(
  perf: DiscoveryPerformance,
  benchmark: MajorZoneBenchmark,
): PromotionVerdict {
  if (perf.sampleSize < MIN_SAMPLE_SIZE_AT_HOUR) {
    return {
      eligible: false,
      reason: `Vu ${perf.sampleSize}× seulement à cette heure (minimum ${MIN_SAMPLE_SIZE_AT_HOUR})`,
    };
  }
  if (perf.avgPerKm == null || perf.avgPerH == null) {
    return {
      eligible: false,
      reason: 'Pas assez de courses réelles rattachées à cette heure',
    };
  }
  if (perf.avgPerKm < benchmark.avgPerKm) {
    return {
      eligible: false,
      reason: `$/km à cette heure (${perf.avgPerKm.toFixed(2)}) sous les zones majeures (${benchmark.avgPerKm.toFixed(2)})`,
    };
  }
  if (perf.avgPerH < benchmark.avgPerH) {
    return {
      eligible: false,
      reason: `$/h à cette heure (${perf.avgPerH.toFixed(2)}) sous les zones majeures (${benchmark.avgPerH.toFixed(2)})`,
    };
  }
  return {
    eligible: true,
    reason: `≥ zones majeures à cette heure sur ${perf.sampleSize} course(s) réelle(s)`,
  };
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
