// Pure push-noise-control logic for surge-detector, split out of index.ts
// so it's testable with `deno test` without binding a listener (index.ts
// calls serve() at module load — see ingest-lyft-screenshots/lyftSnapshot.ts
// for the same pattern in this repo).
//
// Cron runs every 5 min; without gating, a zone sitting at 'peak' for an
// hour fired an identical-ish push every single cycle (~12/hour). Two
// independent gates, both required unless the "major spike" bypass fires:
//   1. Rising edge only — a zone must newly CROSS INTO 'peak' this cycle
//      (its class last cycle was lower) to be a candidate at all. Staying
//      at peak fires nothing further (see isRisingIntoPeak, applied by the
//      caller per-zone before a candidate ever reaches decidePush).
//   2. Cooldown — even with a genuine new candidate, at most one push per
//      COOLDOWN_MS since the last surge_peak notification.
// Bypass: a single cycle producing >=2 brand-new peak zones, or any one
// crossing with an unusually extreme multiplier, reads as a real demand
// spike worth interrupting the cooldown for.

export type SurgeClass = 'normal' | 'elevated' | 'high' | 'peak';

export const SURGE_CLASS_RANK: Record<SurgeClass, number> = {
  normal: 0,
  elevated: 1,
  high: 2,
  peak: 3,
};

export const COOLDOWN_MS = 50 * 60_000; // 50 min — middle of the requested 45-60 min band
export const MAJOR_SPIKE_MULTIPLIER = 2.2; // top of the 1.0-2.5 range computeSurgeFast produces

export interface PriorSurgeState {
  surge_class: SurgeClass;
  surge_multiplier: number;
}

export interface NewPeakCandidate {
  zone_id: string;
  zone_name: string;
  surge_multiplier: number;
  delta: number;
}

/** True when this cycle's class is 'peak' and the zone's own prior class
 * (from zone_context_vectors, 'normal' if it has no history) was lower —
 * i.e. it just crossed the threshold rather than having sat there already. */
export function isRisingIntoPeak(
  surgeClass: SurgeClass,
  prior: PriorSurgeState | undefined
): boolean {
  return (
    surgeClass === 'peak' &&
    SURGE_CLASS_RANK.peak > SURGE_CLASS_RANK[prior?.surge_class ?? 'normal']
  );
}

/** Stable signature for a set of candidates — lets the dedup check catch
 * "same zones, same rounded numbers" even across a cooldown boundary,
 * without needing exact float equality. */
export function candidatesSignature(candidates: NewPeakCandidate[]): string {
  return candidates
    .map((c) => `${c.zone_id}:${c.surge_multiplier.toFixed(2)}`)
    .sort()
    .join('|');
}

export type PushDecision =
  | 'sent'
  | 'skipped_no_candidates'
  | 'skipped_cooldown'
  | 'skipped_duplicate';

export interface LastPush {
  createdAtMs: number;
  signature?: string;
}

export interface DecidePushResult {
  decision: PushDecision;
  top3: NewPeakCandidate[];
  signature: string;
}

/** Ranks all candidates, keeps the top 3, and decides whether this cycle
 * should actually push — pure function, no I/O, fully unit-testable. */
export function decidePush(params: {
  candidates: NewPeakCandidate[];
  lastPush: LastPush | null;
  nowMs: number;
}): DecidePushResult {
  const { candidates, lastPush, nowMs } = params;
  if (candidates.length === 0) {
    return { decision: 'skipped_no_candidates', top3: [], signature: '' };
  }

  const top3 = [...candidates]
    .sort((a, b) => b.surge_multiplier - a.surge_multiplier)
    .slice(0, 3);
  const signature = candidatesSignature(top3);

  if (lastPush?.signature === signature) {
    return { decision: 'skipped_duplicate', top3, signature };
  }

  const msSinceLastPush = lastPush ? nowMs - lastPush.createdAtMs : Infinity;
  const isMajorSpike =
    top3.length >= 2 || top3.some((c) => c.surge_multiplier >= MAJOR_SPIKE_MULTIPLIER);
  const cooldownActive = msSinceLastPush < COOLDOWN_MS && !isMajorSpike;

  if (cooldownActive) {
    return { decision: 'skipped_cooldown', top3, signature };
  }

  return { decision: 'sent', top3, signature };
}

/** Targeted, specific message — never a generic "N zones en surge" blurb.
 * Always names the exact zone(s) and their multiplier + delta. */
export function formatSurgeMessage(top3: NewPeakCandidate[]): {
  title: string;
  body: string;
} {
  const fmtDelta = (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
  const body = top3
    .map((c) => `🔥 ${c.zone_name}: ${c.surge_multiplier.toFixed(2)}× (${fmtDelta(c.delta)})`)
    .join(' · ');
  const title =
    top3.length === 1
      ? `Surge Peak — ${top3[0].zone_name}`
      : `Surge Peak — ${top3.length} nouvelles zones`;
  return { title, body };
}
