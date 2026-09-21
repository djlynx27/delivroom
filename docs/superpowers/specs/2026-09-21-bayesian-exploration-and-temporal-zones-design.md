# Bayesian Exploration Bonus & Temporal (POI) Zones — Design Spec

Status: approved by Oualid 2026-09-21, proceeding directly to implementation.

## Problem

The zone-scoring engine (`src/lib/scoringEngine.ts`, the live client-side
path behind `useDemandScores.ts` → `scoreAllZonesWithLearning` — NOT the
`score-calculator` edge function, which only maintains a cron baseline) has
two related gaps:

1. **Sampling bias / no exploration.** `zone_beliefs` (Bayesian
   posterior mean + variance per zone/day/slot, written by
   `learningEngine.ts` → `learningSync.ts`) is written on every sync but
   **never read back**. The engine always exploits the highest-scoring
   known zone and never nudges toward a plausible but under-sampled one —
   classic exploitation-only bandit behavior.
2. **Hardcoded, non-extensible time windows.** `MEDICAL_SHIFT_HOURS =
   [7, 15, 19, 23]` is a hardcoded special case wired only to
   `zone.type === 'médical'`. There is no way to tag a new POI type
   (CEGEP dismissal, school pickup) with its own recurring active window
   without editing `scoringEngine.ts` source.

## Goals

1. Add a bounded, additive exploration bonus driven by `zone_beliefs`
   posterior variance — under-sampled zones get nudged up, confidently-known
   zones get ~zero bonus, and the bonus can never eclipse a genuinely
   strong, well-known zone.
2. Replace `MEDICAL_SHIFT_HOURS` with a data-driven `active_windows` column
   on `zones`, generalized to any POI (hospital, CEGEP, school), with the
   CHUM / Hôpital Cité-de-la-Santé migration seeded in the same migration
   so their existing behavior does not regress.
3. A CLI script to provision a new POI zone with a neutral prior, letting
   the existing Bayesian belief system take over after a few real trips.

## Non-goals

- No change to the `score-calculator` edge function or the `scores`
  table — this only touches the live client path.
- No new `zone_type` enum values — temporal behavior is orthogonal to
  type (`is_temporal` + `active_windows`), so a hospital stays `médical`
  and a CEGEP can use `université` or `commercial` as fits.
- No pre-seeding of `zone_beliefs` rows for newly provisioned zones — a
  missing belief already means "default prior, max uncertainty" (see
  Architecture), so an empty table entry needs no row.

## Architecture

### 1. Exploration bonus (`src/lib/scoringEngine.ts`)

New pure function:

```ts
export const EXPLORATION_BONUS_MAX_PCT = 0.15; // hard ceiling: 15% of the zone's own score
const EXPLORATION_VARIANCE_SCALE = 0.35; // k in sqrt(variance) * k

export function computeExplorationBonus(
  preBonusScore: number,
  posteriorVariance: number | undefined,
  observationCount: number | undefined
): number {
  const variance = posteriorVariance ?? DEFAULT_PRIOR_VARIANCE; // 100, unseen zone = max uncertainty
  const rawBonus = Math.sqrt(variance) * EXPLORATION_VARIANCE_SCALE;
  const cap = preBonusScore * EXPLORATION_BONUS_MAX_PCT;
  return Math.min(rawBonus, cap);
}
```

Applied in `computeDemandScore`, additively, **after** the legacy/weighted
blend and **before** the hotspot multiplier:

```ts
finalScore += computeExplorationBonus(finalScore, belief?.posteriorVariance, belief?.observationCount);
```

Capping the bonus at a percentage of the zone's own pre-bonus score (not a
flat point cap) is what satisfies "never eclipse a real hotspot in rush
hour": a 90-scoring hotspot allows at most +13.5, while an unknown zone
sitting at a base 40 allows at most +6 — the unknown zone cannot leapfrog
the hotspot even at max uncertainty.

`ScoringContext` gains `beliefs?: ZoneBelief[]` (reuses the type already
exported by `learningEngine.ts`). `computeDemandScore` looks up the
matching `(zoneId, dayOfWeek, slotIndex)` belief the same way
`getHistoricalFactor` already looks up `history`.

### 2. Temporal zones (`zones.is_temporal`, `zones.active_windows`)

Migration `supabase/migrations/20260921120000_zone_exploration_and_temporal.sql`:

```sql
ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS is_temporal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_windows jsonb NOT NULL DEFAULT '[]';

-- Seed CHUM / Hôpital Cité-de-la-Santé with the exact windows the old
-- MEDICAL_SHIFT_HOURS = [7, 15, 19, 23] logic produced (diff===0, or
-- diff===1 gated by the :30 half-hour split), so this migration is a
-- behavior-preserving refactor, not a regression.
UPDATE public.zones
SET is_temporal = true,
    active_windows = '[
      {"days": [], "startHour": 6,  "startMin": 30, "endHour": 8,  "endMin": 30, "weight_multiplier": 1.3},
      {"days": [], "startHour": 14, "startMin": 30, "endHour": 16, "endMin": 30, "weight_multiplier": 1.3},
      {"days": [], "startHour": 18, "startMin": 30, "endHour": 20, "endMin": 30, "weight_multiplier": 1.3},
      {"days": [], "startHour": 22, "startMin": 30, "endHour": 0,  "endMin": 30, "weight_multiplier": 1.3}
    ]'::jsonb
WHERE name IN ('CHUM Hôpital', 'Hôpital Cité-de-la-Santé');
```

`ActiveWindow` type + `isInActiveWindow(now, windows)` (reuses
`timeInRange`/`dayMatches`'s wrap-midnight logic already in the file, just
parameterized over a `Zone`-supplied window instead of a static `TimeRule`).

In `computeTimePatternBase`: after the existing `TIME_RULES` pass, if
`zone.is_temporal`:
- inside an active window → apply that window's `weight_multiplier`
  (replaces the `MEDICAL_SHIFT_HOURS` block entirely — deleted, not kept
  alongside).
- outside every window → apply `TEMPORAL_OFF_WINDOW_PENALTY = 0.3`
  (same shape as the existing `OFF_PEAK_COMMERCIAL_PENALTY = 0.1` pattern
  a few lines above it).

Non-temporal zones (`is_temporal = false`, the default — everything
existing today) are completely unaffected; this is additive.

### 3. Zone provisioning CLI (`src/scripts/addZone.ts`)

```
tsx src/scripts/addZone.ts --name "..." --lat 45.x --lng -73.x \
  --type médical --city-id mtl --territory mtl \
  [--temporal] [--window "days=1,2,3,4,5;start=14:30;end=16:30;mult=1.3"]
```

- Inserts one `zones` row: `base_score`/`current_score` = 40 (matches the
  existing generic `BASE_SCORES` fallback already used for any unmodeled
  type), `is_temporal`/`active_windows` from flags.
- Does **not** touch `zone_beliefs` — no row means
  `computeExplorationBonus` already falls back to
  `DEFAULT_PRIOR_VARIANCE` (max uncertainty, max bonus within the 15%
  cap), and the first real trip through this zone creates the belief row
  naturally via the existing `updateBayesianBelief` path in
  `learningEngine.ts`. No new mechanism needed.
- Follows `batchImportScreenshots.ts`'s existing CLI-arg-parsing and
  Supabase-client-init style; no new dependency.

## Testing

`src/test/scoringEngine.test.ts`:
- `computeExplorationBonus`: high variance → bonus at the 15%-of-score
  ceiling, not above it; low variance / high observationCount → bonus
  ~0; missing belief → treated as `DEFAULT_PRIOR_VARIANCE`.
- `computeDemandScore` end-to-end: an unknown zone's boosted score still
  loses to a real, well-known hotspot during its own peak window.
- Temporal zone: inside an active window → multiplier applied; outside →
  `TEMPORAL_OFF_WINDOW_PENALTY` applied; non-temporal zone unaffected by
  either code path.
- Regression: CHUM / Hôpital Cité-de-la-Santé produce the same scores at
  the same hours as before the `MEDICAL_SHIFT_HOURS` removal (7h/15h/19h/23h
  ±1h boundary cases explicitly, since that's where the old diff===1 +
  `:30` gate lived).

`npm run type-check && npm run lint && npm run test:run` before commit
(CLAUDE.md standing rule), then commit + push per the auto-commit rule.
