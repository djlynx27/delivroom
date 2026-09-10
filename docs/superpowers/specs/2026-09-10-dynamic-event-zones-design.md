# Dynamic Event Zones — Design Spec

Status: approved by Oualid 2026-09-10, pending implementation plan.

## Problem

Delivroom's event boost (`computeEventBoostPoints` in `src/lib/scoringEngine.ts`,
`computeEventBoost` in `supabase/functions/score-calculator/index.ts`) only
raises the score of a *real* zone that falls within the event's
`boost_radius_km`. An event that lands outside every one of the 61 fixed
zones' influence (a one-off festival, an outdoor concert in a park, an
event in an industrial/undeveloped area) gets a boost of exactly zero — no
zone anywhere reflects it, and the driver never gets a repositioning
suggestion toward it.

Separately, the two engines already disagree on decay shape:
`scoringEngine.ts` uses a linear falloff (`1 - dist/radius`),
`score-calculator/index.ts` uses a binary cutoff (full boost inside
`boost_radius_km`, zero outside). Neither is a Gaussian curve.

## Goals

1. An event far from every fixed zone still produces demand a driver can be
   routed to.
2. The existing UI/consumer ecosystem (Planning, NearestHotspot,
   ZonesScreen, score-calculator, surge-detector) sees this new demand
   *without* being individually modified — they all already consume
   `public.zones` as their source of truth.
3. Decay math is unified (Gaussian) and identical in both the client and
   server scoring engines.
4. The mechanism is ephemeral: a virtual zone must not persist forever
   after its event ends.

## Non-goals (explicitly out of scope for this pass)

- Un-creating a virtual zone if the triggering event is edited to no
  longer qualify (accepted limitation — mirrors the existing
  `zone_discoveries_auto_promote()` one-directional behavior).
- Merging/deduplicating virtual zones for two nearby simultaneous events.
- Any UI badge/visual distinction marking a zone as event-derived.
- Precise geocoding/venue-shape modeling — a virtual zone is a single
  point at the event's own coordinates, same simplification the existing
  `zone_discoveries_auto_promote()` already uses for auto-promoted zones.

## A — Data model

```sql
ALTER TABLE public.zones
  ADD COLUMN event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;
```

- `event_id IS NOT NULL` is the **sole** marker of a virtual/event-derived
  zone — no separate `is_virtual` boolean, so there is no way for the two
  to disagree.
- `id`: deterministic, `'evt-' || substr(md5(event.id::text), 1, 10)` —
  same construction `zone_discoveries_auto_promote()` already uses for its
  `disc-*` ids. Deterministic id + `ON CONFLICT (id) DO UPDATE` makes the
  trigger idempotent across repeated `UPDATE`s of the same event row.
- `type = 'événements'` — already a valid `zone_type` enum value, no schema
  change needed there.
- `city_id = NEW.city_id` — copied directly from the event row (events
  already carry their own `city_id`, unlike zone discoveries which had to
  guess one from an address).
- `ON DELETE CASCADE`: deleting an `events` row also deletes its virtual
  zone as a free side effect (on top of the explicit cleanup in section E,
  which handles the far more common "expired but not deleted" case).

## B — Trigger condition

New trigger, `AFTER INSERT OR UPDATE OF latitude, longitude, capacity, demand_impact, boost_radius_km ON public.events`,
mirrors the structure of `zone_discoveries_auto_promote()`
(`supabase/migrations/20260907000000_auto_promote_zone_discoveries.sql`).

Creates a virtual zone only when **both** hold:

1. **Outside current influence** — the nearest existing real zone (any
   zone with `event_id IS NULL`) is farther than the event's own
   `boost_radius_km`. If a real zone already sits inside that radius, the
   event already has somewhere to boost; no virtual zone needed.
2. **Meaningful crowd** — `capacity >= 500 OR demand_impact >= 3`. Filters
   out minor/local events so the trigger doesn't spawn a zone per
   neighborhood block party.

No Haversine function exists anywhere in the DB today (checked via
`pg_proc` — only unrelated geometry-type and pgvector distance functions
exist). The trigger needs a small SQL/plpgsql `public.haversine_km(lat1,
lng1, lat2, lng2)` helper (new, ~10 lines, same formula as
`src/scripts/lib/geo.ts`/`score-calculator`'s copies) to compute "nearest
real zone" distance — this is new surface the implementation plan must
account for, not a reuse of something existing.

## C — Score formula

```
base_score = current_score =
  LEAST(100, 40 + (boost_multiplier - 1) * 25 + LEAST(demand_impact, 5) * 6)
```

Calibration: an average qualifying event (`boost_multiplier=1.3`,
`demand_impact=3`) scores ~65.5; a large festival (`boost_multiplier=2.0`,
`demand_impact=5`) hits the 100 ceiling. Recalculated by `score-calculator`
on its normal 10-minute cron pass like any other zone — no special-casing
needed there (see F).

## D — Gaussian decay (both engines)

Replaces the linear decay in `computeEventBoostPoints`
(`src/lib/scoringEngine.ts`) and the binary cutoff in `computeEventBoost`
(`supabase/functions/score-calculator/index.ts`) with the same formula in
both places:

```
sigma = boost_radius_km / 2
boost = maxBoostPoints * exp(-(dist^2) / (2 * sigma^2))
```

At `dist = boost_radius_km`, ~13.5% of `maxBoostPoints` remains (soft
falloff, no hard edge) instead of the current cliff (binary) or straight
line (linear). `maxBoostPoints` keeps each engine's existing scaling from
`boost_multiplier` — only the distance-decay shape changes.

Implemented as a small duplicated pure function in each runtime (matching
the existing precedent of `haversineKm`/`haversineMeters` being
deliberately duplicated across the Vite/Deno boundary rather than shared,
since a shared module would need to cross that boundary cleanly, which
this codebase's established pattern avoids) — a comment in each copy
cross-references the other.

## E — Cleanup

```sql
CREATE OR REPLACE FUNCTION public.cleanup_expired_event_zones()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.zones
  WHERE event_id IS NOT NULL
    AND event_id IN (
      SELECT id FROM public.events WHERE end_at < now() - interval '2 hours'
    );
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_event_zones() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_event_zones() TO service_role;
```

Scheduled hourly via `pg_cron`, same mechanism as the existing
`cleanup_old_platform_signals`/`cleanup_old_weight_history` jobs. The
2-hour grace period after `end_at` avoids a virtual zone vanishing while a
driver is mid-shift still near it.

## F — Integration (no other consumer changes)

- `score-calculator/index.ts`'s zone query has no filter excluding virtual
  zones — they're scored on the very next 10-minute cron run automatically.
- `useZones(cityId)` (client) is likewise unfiltered — Planning,
  NearestHotspot, ZonesScreen see the new zone immediately once
  `score-calculator` has written its score.
- `surge-detector` reads `current_score` the same way for every zone;
  `get_surge_baseline` already falls back gracefully
  (`baselineScore ?? zone.base_score ?? zone.current_score * 0.85`) for a
  zone_id it has no history for, so a brand-new virtual zone doesn't error.

## Testing

- SQL: a migration-level check (or manual `execute_sql` verification during
  rollout) that inserting a qualifying event produces exactly one `zones`
  row with the expected `id`/`city_id`/`type`/score, and that a
  non-qualifying event (low capacity, or near an existing zone) produces
  none.
- `cleanup_expired_event_zones()`: verify it deletes a zone whose event
  ended > 2h ago and leaves one whose event ended < 2h ago untouched.
- Gaussian decay: pure-function unit tests in both
  `src/test/scoringEngine.*.test.ts` (client) and a Deno test alongside
  `score-calculator` for the formula itself (same input distances/radii →
  same output in both runtimes, guarding the two duplicated copies against
  drifting apart — mirrors the existing precedent of Haversine parity
  wanted in the earlier geospatial audit finding).
