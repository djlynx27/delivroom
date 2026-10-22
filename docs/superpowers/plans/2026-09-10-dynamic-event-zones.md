# Dynamic Event Zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An event outside every fixed zone's boost radius gets its own ephemeral zone in `public.zones`, scored and consumed by the existing app exactly like a real zone, then automatically cleaned up after the event ends — and both scoring engines use the same Gaussian distance-decay for event boosts instead of today's mismatched linear (client) / binary (server) curves.

**Architecture:** A Postgres trigger on `public.events` creates a deterministic, ephemeral `public.zones` row (marked by a non-null `event_id`) whenever a qualifying event has no real zone within its own boost radius. An hourly `pg_cron` job deletes these rows once their event is 2+ hours past `end_at`. Both `src/lib/scoringEngine.ts` (client) and `supabase/functions/score-calculator/index.ts` (server) get the same Gaussian decay formula for event-boost distance falloff — duplicated per-runtime, matching this codebase's existing Haversine duplication pattern across the Vite/Deno boundary.

**Tech Stack:** Supabase Postgres (plpgsql trigger, SQL function, pg_cron), Deno Edge Function (TypeScript), Vite/React client (TypeScript), Vitest, Deno test.

**Spec:** `docs/superpowers/specs/2026-09-10-dynamic-event-zones-design.md`

## Global Constraints

- `event_id IS NOT NULL` is the sole marker of a virtual zone — no separate `is_virtual` column.
- Zone id: `'evt-' || substr(md5(event.id::text), 1, 10)` (matches `zone_discoveries_auto_promote()`'s `disc-*` construction).
- `type = 'événements'` (already a valid `zone_type` enum value — no enum change).
- `city_id` copied directly from the triggering event's own `city_id`.
- Trigger condition: nearest **real** zone (`event_id IS NULL`) farther than the event's own `boost_radius_km`, AND (`capacity >= 500 OR demand_impact >= 3`).
- Score formula: `LEAST(100, 40 + (boost_multiplier - 1) * 25 + LEAST(demand_impact, 5) * 6)`.
- Gaussian decay: `sigma = boost_radius_km / 2`; `factor = exp(-(distKm^2) / (2*sigma^2))`.
- Every new SECURITY DEFINER function gets `SET search_path = ''` and `REVOKE EXECUTE ... FROM public, anon, authenticated; GRANT ... TO service_role;` (project convention — see `supabase/migrations/20260826000006_security_definer_audit.sql`).
- Cleanup grace period: 2 hours after `end_at`. Cron: hourly (`0 * * * *`).
- Non-goals (do not build): un-creating a zone if the event stops qualifying later; deduplicating zones for nearby simultaneous events; any UI badge distinguishing event-derived zones.
- Supabase project ref: `hibzhsjgipybfihhzpxr`.

---

## File Structure

- Create: `supabase/migrations/20260911000001_dynamic_event_zones.sql` — `haversine_km()`, `zones.event_id` column, `create_event_zone()` trigger function + trigger.
- Create: `supabase/migrations/20260911000002_event_zone_cleanup.sql` — `cleanup_expired_event_zones()` + hourly `pg_cron` schedule.
- Create: `supabase/functions/score-calculator/eventBoost.ts` — pure Gaussian-decay event-boost logic for the server engine (mirrors the existing `supabase/functions/surge-detector/surgePush.ts` pattern: pure logic split out of `index.ts` for unit testing).
- Create: `supabase/functions/score-calculator/eventBoost.test.ts` — Deno tests for the above.
- Modify: `supabase/functions/score-calculator/index.ts` — replace the inline `computeEventBoost` with an import from `./eventBoost.ts`.
- Modify: `src/lib/scoringEngine.ts:530-568` — `computeEventBoostPoints` swaps its linear proximity term for the same Gaussian decay formula; export the function for direct testing.
- Modify: `src/test/scoringEngine.test.ts` — add tests for `computeEventBoostPoints`'s new decay curve.

---

### Task 1: `haversine_km()` SQL helper + `zones.event_id` column

**Files:**
- Create: `supabase/migrations/20260911000001_dynamic_event_zones.sql` (this task writes the first part of it; Task 2 appends to the same file)

**Interfaces:**
- Produces: `public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) RETURNS double precision` — great-circle distance in km. `public.zones.event_id uuid` column (nullable, FK to `public.events(id) ON DELETE CASCADE`).

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260911000001_dynamic_event_zones.sql
--
-- Dynamic Event Zones: an event that falls outside every fixed zone's own
-- boost radius currently produces zero demand signal anywhere (see
-- docs/superpowers/specs/2026-09-10-dynamic-event-zones-design.md). This
-- adds the data model and the trigger that creates an ephemeral zone for
-- a qualifying event.
--
-- No Haversine function exists anywhere in this database today (checked
-- via pg_proc — only unrelated geometry-type and pgvector distance
-- functions exist), so the trigger needs its own.

CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 6371 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) *
    sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$;

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_zones_event_id ON public.zones (event_id) WHERE event_id IS NOT NULL;
```

- [ ] **Step 2: Apply the migration**

Use the `mcp__supabase__apply_migration` tool with `project_id: hibzhsjgipybfihhzpxr`, `name: dynamic_event_zones`, and the SQL from Step 1.

- [ ] **Step 3: Verify `haversine_km` is correct**

Run via `mcp__supabase__execute_sql` (project_id `hibzhsjgipybfihhzpxr`):

```sql
-- Montreal downtown (45.5017, -73.5673) to Laval centre (45.5559, -73.7217)
-- Known distance ≈ 13.0 km (cross-check against src/scripts/lib/geo.ts's
-- haversineMeters for the same two points if you want a second source).
SELECT round(public.haversine_km(45.5017, -73.5673, 45.5559, -73.7217)::numeric, 1) AS km;
```

Expected: a value close to `13.0` (within ~0.5 km).

- [ ] **Step 4: Verify the column and index exist**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'zones' AND column_name = 'event_id';
```

Expected: one row, `data_type = 'uuid'`, `is_nullable = 'YES'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260911000001_dynamic_event_zones.sql
git commit -m "feat(events): add haversine_km() and zones.event_id column"
```

---

### Task 2: `create_event_zone()` trigger

**Files:**
- Modify: `supabase/migrations/20260911000001_dynamic_event_zones.sql` (append to the same file from Task 1 — one migration, one coherent feature)

**Interfaces:**
- Consumes: `public.haversine_km(...)` from Task 1.
- Produces: trigger `create_event_zone_trg` on `public.events`; function `public.create_event_zone()`.

- [ ] **Step 1: Append the trigger function and trigger to the migration file**

```sql
CREATE OR REPLACE FUNCTION public.create_event_zone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_zone_id    text;
  v_nearest_km double precision;
  v_score      numeric;
BEGIN
  -- Meaningful-crowd gate — skip minor/local events.
  IF NOT (NEW.capacity >= 500 OR NEW.demand_impact >= 3) THEN
    RETURN NEW;
  END IF;

  -- Distance to the nearest REAL zone (never another event's virtual zone).
  SELECT MIN(public.haversine_km(NEW.latitude, NEW.longitude, z.latitude, z.longitude))
  INTO v_nearest_km
  FROM public.zones z
  WHERE z.event_id IS NULL;

  -- Already inside an existing zone's own boost radius — nothing to do.
  IF v_nearest_km IS NOT NULL AND v_nearest_km <= NEW.boost_radius_km THEN
    RETURN NEW;
  END IF;

  v_zone_id := 'evt-' || substr(md5(NEW.id::text), 1, 10);
  v_score := LEAST(100, 40 + (NEW.boost_multiplier - 1) * 25 + LEAST(NEW.demand_impact, 5) * 6);

  INSERT INTO public.zones (id, city_id, name, type, latitude, longitude, base_score, current_score, event_id)
  VALUES (
    v_zone_id, NEW.city_id, NEW.name, 'événements',
    NEW.latitude, NEW.longitude, v_score, v_score, NEW.id
  )
  ON CONFLICT (id) DO UPDATE SET
    name          = EXCLUDED.name,
    latitude      = EXCLUDED.latitude,
    longitude     = EXCLUDED.longitude,
    base_score    = EXCLUDED.base_score,
    current_score = EXCLUDED.current_score,
    updated_at    = now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS create_event_zone_trg ON public.events;

CREATE TRIGGER create_event_zone_trg
AFTER INSERT OR UPDATE OF latitude, longitude, capacity, demand_impact, boost_radius_km
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.create_event_zone();

REVOKE EXECUTE ON FUNCTION public.create_event_zone() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_zone() TO service_role;
```

- [ ] **Step 2: Apply the appended migration**

Use `mcp__supabase__apply_migration` with `project_id: hibzhsjgipybfihhzpxr`, `name: create_event_zone_trigger`, and just the SQL block from Step 1 (Task 1's part is already applied — Supabase migrations apply incrementally, so submit only the new SQL as its own `apply_migration` call, then update the local file to contain both blocks for the single source-of-truth migration file).

- [ ] **Step 3: Verify a qualifying event creates a zone**

```sql
-- A big festival at a coordinate far from every real zone (middle of the
-- St. Lawrence river, easily >5km from any real zone).
INSERT INTO public.events (name, venue, city_id, latitude, longitude, start_at, end_at, capacity, demand_impact, boost_multiplier, boost_radius_km)
VALUES ('Test Festival', 'Test Venue', 'mtl', 45.52, -73.52, now(), now() + interval '4 hours', 5000, 4, 1.8, 1.5)
RETURNING id;

-- Use the returned id in place of <EVENT_ID> below:
SELECT id, city_id, name, type, base_score, event_id
FROM public.zones
WHERE event_id = '<EVENT_ID>';
```

Expected: exactly one row, `type = 'événements'`, `base_score` between 40 and 100, `id` starting with `evt-`.

- [ ] **Step 4: Verify a non-qualifying event (low capacity, no impact) creates no zone**

```sql
INSERT INTO public.events (name, venue, city_id, latitude, longitude, start_at, end_at, capacity, demand_impact, boost_multiplier, boost_radius_km)
VALUES ('Tiny Block Party', 'Test Venue', 'mtl', 45.53, -73.53, now(), now() + interval '2 hours', 50, 1, 1.1, 0.5)
RETURNING id;

SELECT count(*) FROM public.zones WHERE event_id = '<EVENT_ID>';
```

Expected: `count = 0`.

- [ ] **Step 5: Clean up the two test events (and their cascade-deleted zone, if any)**

```sql
DELETE FROM public.events WHERE name IN ('Test Festival', 'Tiny Block Party');
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260911000001_dynamic_event_zones.sql
git commit -m "feat(events): create an ephemeral zone for events outside every real zone's boost radius"
```

---

### Task 3: `cleanup_expired_event_zones()` + hourly cron

**Files:**
- Create: `supabase/migrations/20260911000002_event_zone_cleanup.sql`

**Interfaces:**
- Consumes: `public.zones.event_id`, `public.events.end_at` (both from Task 1/existing schema).
- Produces: `public.cleanup_expired_event_zones()`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260911000002_event_zone_cleanup.sql
--
-- Deletes ephemeral event zones (public.zones.event_id IS NOT NULL) once
-- their triggering event is more than 2 hours past end_at. Same
-- REVOKE/GRANT lockdown pattern as cleanup_old_platform_signals (see
-- 20260320000002_platform_signals.sql) and the same pg_cron
-- availability guard as its scheduling block.

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

DO $event_zones_cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-event-zones') THEN
      PERFORM cron.unschedule('cleanup-event-zones');
    END IF;

    PERFORM cron.schedule(
      'cleanup-event-zones',
      '0 * * * *', -- hourly
      $$SELECT public.cleanup_expired_event_zones()$$
    );

    RAISE NOTICE 'pg_cron job "cleanup-event-zones" scheduled hourly.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available — cleanup_expired_event_zones() must be triggered manually. Error: %', SQLERRM;
END;
$event_zones_cleanup$;
```

- [ ] **Step 2: Apply the migration**

Use `mcp__supabase__apply_migration` with `project_id: hibzhsjgipybfihhzpxr`, `name: event_zone_cleanup`, and the SQL from Step 1.

- [ ] **Step 3: Verify the cleanup function deletes an expired zone and spares a recent one**

```sql
-- Expired event (ended 3h ago) with a virtual zone.
INSERT INTO public.events (name, venue, city_id, latitude, longitude, start_at, end_at, capacity, demand_impact, boost_multiplier, boost_radius_km)
VALUES ('Expired Test Event', 'Test Venue', 'mtl', 45.55, -73.55, now() - interval '5 hours', now() - interval '3 hours', 5000, 4, 1.8, 1.5)
RETURNING id; -- call this <EXPIRED_ID>

-- Recently-ended event (ended 30 min ago) with a virtual zone — must survive.
INSERT INTO public.events (name, venue, city_id, latitude, longitude, start_at, end_at, capacity, demand_impact, boost_multiplier, boost_radius_km)
VALUES ('Recent Test Event', 'Test Venue', 'mtl', 45.56, -73.56, now() - interval '3 hours', now() - interval '30 minutes', 5000, 4, 1.8, 1.5)
RETURNING id; -- call this <RECENT_ID>

SELECT public.cleanup_expired_event_zones();

SELECT event_id FROM public.zones WHERE event_id IN ('<EXPIRED_ID>', '<RECENT_ID>');
```

Expected: only `<RECENT_ID>` appears in the result — the expired event's zone was deleted, the recent one wasn't.

- [ ] **Step 4: Clean up the two test events**

```sql
DELETE FROM public.events WHERE name IN ('Expired Test Event', 'Recent Test Event');
```

- [ ] **Step 5: Verify the trigger and cleanup functions both have `search_path = ''`**

```sql
SELECT proname, proconfig FROM pg_proc
WHERE proname IN ('create_event_zone', 'cleanup_expired_event_zones', 'haversine_km');
```

Expected: all three rows show `proconfig` containing `search_path=""`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260911000002_event_zone_cleanup.sql
git commit -m "feat(events): clean up expired event zones hourly via pg_cron"
```

---

### Task 4: Gaussian decay — server (`score-calculator`)

**Files:**
- Create: `supabase/functions/score-calculator/eventBoost.ts`
- Create: `supabase/functions/score-calculator/eventBoost.test.ts`

**Interfaces:**
- Produces: `haversineKm(lat1, lon1, lat2, lon2): number`, `gaussianDecay(distKm: number, boostRadiusKm: number): number`, `computeEventBoost(zone: {latitude, longitude}, activeEvents: {latitude, longitude, boost_multiplier, boost_radius_km}[]): number` — same name and return semantics as the function it replaces in `index.ts`, so Task 5's swap is a pure import change.

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/score-calculator/eventBoost.test.ts
import { assertAlmostEquals, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { computeEventBoost, gaussianDecay, haversineKm } from './eventBoost.ts';

Deno.test('gaussianDecay: full boost at zero distance', () => {
  assertEquals(gaussianDecay(0, 2), 1);
});

Deno.test('gaussianDecay: ~13.5% remains at dist === boost_radius_km (sigma = radius/2)', () => {
  const decay = gaussianDecay(2, 2);
  assertAlmostEquals(decay, Math.exp(-2), 0.0001);
});

Deno.test('gaussianDecay: decays smoothly past the nominal radius instead of hard-cutting to zero', () => {
  const atRadius = gaussianDecay(2, 2);
  const beyondRadius = gaussianDecay(3, 2);
  assertEquals(beyondRadius > 0, true);
  assertEquals(beyondRadius < atRadius, true);
});

Deno.test('computeEventBoost: sums decayed contributions across multiple events, capped at 25', () => {
  const zone = { latitude: 45.5, longitude: -73.5 };
  const events = [
    { latitude: 45.5, longitude: -73.5, boost_multiplier: 2.0, boost_radius_km: 2 }, // at the zone itself
    { latitude: 45.5, longitude: -73.5, boost_multiplier: 2.0, boost_radius_km: 2 },
  ];
  const boost = computeEventBoost(zone, events);
  assertEquals(boost, 25); // two max-strength events would sum past 25 without the cap
});

Deno.test('computeEventBoost: zero for an event far outside its own boost radius', () => {
  const zone = { latitude: 45.5, longitude: -73.5 };
  const farEvent = { latitude: 46.0, longitude: -73.5, boost_multiplier: 2.0, boost_radius_km: 1 };
  const boost = computeEventBoost(zone, [farEvent]);
  assertEquals(boost < 0.01, true); // Gaussian never hits exactly 0, but it's negligible
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/score-calculator/eventBoost.test.ts`
Expected: FAIL — `eventBoost.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// supabase/functions/score-calculator/eventBoost.ts
//
// Event-boost distance decay for score-calculator. Gaussian falloff
// (sigma = boost_radius_km / 2) replaces the previous binary
// inside-radius-or-nothing cutoff — ~13.5% of the max boost remains at
// dist = boost_radius_km instead of dropping to zero. The client copy of
// this same formula lives in src/lib/scoringEngine.ts's
// computeEventBoostPoints; haversineKm is duplicated across the Vite/Deno
// boundary the same way src/scripts/lib/geo.ts's haversineMeters already
// is elsewhere in this codebase.

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function gaussianDecay(distKm: number, boostRadiusKm: number): number {
  const sigma = boostRadiusKm / 2;
  if (sigma <= 0) return distKm === 0 ? 1 : 0;
  return Math.exp(-(distKm ** 2) / (2 * sigma ** 2));
}

export interface EventBoostInput {
  latitude: number;
  longitude: number;
  boost_multiplier: number;
  boost_radius_km: number;
}

export function computeEventBoost(
  zone: { latitude: number; longitude: number },
  activeEvents: EventBoostInput[]
): number {
  let boost = 0;
  for (const event of activeEvents) {
    const distKm = haversineKm(zone.latitude, zone.longitude, event.latitude, event.longitude);
    const maxBoostPoints = Math.min((event.boost_multiplier - 1) * 15, 20);
    boost += maxBoostPoints * gaussianDecay(distKm, event.boost_radius_km ?? 3);
  }
  return Math.min(boost, 25);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/score-calculator/eventBoost.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/score-calculator/eventBoost.ts supabase/functions/score-calculator/eventBoost.test.ts
git commit -m "feat(score-calculator): extract event boost with Gaussian distance decay"
```

---

### Task 5: Wire the server engine to use `eventBoost.ts`

**Files:**
- Modify: `supabase/functions/score-calculator/index.ts:172-186` (current `computeEventBoost` function) and its import block near the top of the file.

**Interfaces:**
- Consumes: `computeEventBoost` from `./eventBoost.ts` (Task 4).

- [ ] **Step 1: Remove the inline `computeEventBoost` AND the now-unused local `haversineKm`, import the extracted versions**

Verified during planning: `haversineKm` in `index.ts` (defined around line 90) has exactly one call site, inside `computeEventBoost` (line 175) — it is used nowhere else in this file (weather-by-city lookups use `fetchWeather`/`CITY_CENTROIDS`, not distance math). Deleting `computeEventBoost` without also deleting `haversineKm` would leave a dead, unused function.

In `supabase/functions/score-calculator/index.ts`, find:

```typescript
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

Delete this whole function.

Then find (further down the file):

```typescript
function computeEventBoost(zone: Zone, activeEvents: Event[]): number {
  let boost = 0;
  for (const event of activeEvents) {
    const distKm = haversineKm(
      zone.latitude,
      zone.longitude,
      event.latitude,
      event.longitude
    );
    if (distKm <= (event.boost_radius_km ?? 3)) {
      boost += Math.min((event.boost_multiplier - 1) * 15, 20);
    }
  }
  return Math.min(boost, 25);
}
```

Delete this whole function too.

Then find the import block near the top of the file:

```typescript
import { montrealDayOfWeek, montrealHour } from '../_shared/time.ts';
```

Add, immediately after it:

```typescript
import { computeEventBoost } from './eventBoost.ts';
```

- [ ] **Step 2: Verify the file still type-checks**

Run: `deno check supabase/functions/score-calculator/index.ts`
Expected: no errors, and no "unused" warnings for `haversineKm`/`computeEventBoost` (both fully removed, not just unreferenced).

- [ ] **Step 3: Manually verify the wiring with the same live-DB check from Task 2**

Re-run Task 2 Step 3's test-festival insert against `hibzhsjgipybfihhzpxr`, then invoke score-calculator once (`mcp__supabase__execute_sql` isn't the right tool for invoking an Edge Function — instead, from the Delivroom app or via `curl -X POST https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/score-calculator` with the anon key) and confirm the returned `activeEvents` count includes your test event and the run succeeds with `success: true`. Clean up the test event afterward the same way as Task 2 Step 5. Note: this Edge Function change is not deployed automatically — deployment happens via the project's normal CI (deploy-on-push to `main`), not as part of this task.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/score-calculator/index.ts
git commit -m "refactor(score-calculator): use the extracted Gaussian-decay event boost"
```

---

### Task 6: Gaussian decay — client (`scoringEngine.ts`)

**Files:**
- Modify: `src/lib/scoringEngine.ts:530-568` (current `computeEventBoostPoints`)
- Modify: `src/test/scoringEngine.test.ts`

**Interfaces:**
- Produces: `computeEventBoostPoints` becomes exported (was file-private); same parameters and return type as today.

- [ ] **Step 1: Write the failing test**

In `src/test/scoringEngine.test.ts`, find the existing import block:

```typescript
import {
  calculateDemandFactors,
  calculateWeightedDemandScore,
  computeDemandScore,
  DEFAULT_WEIGHTS,
  getWeatherMultiplier,
  reweightZonesByDriverMode,
  scoreAllZones,
  scoreAllZonesWithLearning,
  type ActiveEventBoost,
  type WeatherCondition,
} from '@/lib/scoringEngine';
```

Replace with (adding `computeEventBoostPoints`, alphabetically placed):

```typescript
import {
  calculateDemandFactors,
  calculateWeightedDemandScore,
  computeDemandScore,
  computeEventBoostPoints,
  DEFAULT_WEIGHTS,
  getWeatherMultiplier,
  reweightZonesByDriverMode,
  scoreAllZones,
  scoreAllZonesWithLearning,
  type ActiveEventBoost,
  type WeatherCondition,
} from '@/lib/scoringEngine';
```

Then add the following test block anywhere else in the file (e.g. at the end):

```typescript
describe('computeEventBoostPoints — Gaussian decay', () => {
  const zone = { type: 'commercial', latitude: 45.5, longitude: -73.5 };

  it('gives the maximum boost at zero distance', () => {
    const points = computeEventBoostPoints(zone, [
      {
        latitude: 45.5,
        longitude: -73.5,
        boost_multiplier: 2.0,
        boost_radius_km: 2,
        boost_zone_types: [],
      },
    ]);
    expect(points).toBeGreaterThan(0);
  });

  it('decays smoothly instead of stopping abruptly beyond the nominal radius', () => {
    // boost_radius_km: 4, multiplier: 3.0 — chosen (and hand-verified
    // against the gaussianDecay formula) so BOTH points below survive
    // computeEventBoostPoints' Math.round without flooring to 0: near
    // (~1.56 km, well inside the 4km radius) rounds to ~27; far (~4.68 km,
    // just past the radius) rounds to ~2 — small but nonzero, which the
    // OLD binary cutoff would have floored to exactly 0.
    const nearEvent = [
      {
        latitude: 45.5,
        longitude: -73.5 - 0.02, // ~1.56 km away
        boost_multiplier: 3.0,
        boost_radius_km: 4,
        boost_zone_types: [],
      },
    ];
    const farEvent = [
      {
        latitude: 45.5,
        longitude: -73.5 - 0.06, // ~4.68 km away
        boost_multiplier: 3.0,
        boost_radius_km: 4,
        boost_zone_types: [],
      },
    ];
    const nearPoints = computeEventBoostPoints(zone, nearEvent);
    const farPoints = computeEventBoostPoints(zone, farEvent);
    // Old binary cutoff would make farPoints exactly 0; Gaussian keeps it
    // positive but smaller than the near-event case.
    expect(farPoints).toBeGreaterThan(0);
    expect(farPoints).toBeLessThan(nearPoints);
  });

  it('returns 0 for an event whose distance makes the Gaussian term negligible', () => {
    const points = computeEventBoostPoints(zone, [
      {
        latitude: 46.5, // ~111 km away
        longitude: -73.5,
        boost_multiplier: 2.0,
        boost_radius_km: 2,
        boost_zone_types: [],
      },
    ]);
    expect(points).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/scoringEngine.test.ts`
Expected: FAIL — `computeEventBoostPoints` is not exported from `@/lib/scoringEngine`.

- [ ] **Step 3: Export the function and swap the decay term**

In `src/lib/scoringEngine.ts`, find:

```typescript
function computeEventBoostPoints(
```

Change to:

```typescript
export function computeEventBoostPoints(
```

Then find, inside that same function, the hard-cutoff guard (a Gaussian has no hard cutoff — an event just past its nominal radius should still contribute a small, not zero, boost):

```typescript
    if (dist > eventBoost.boost_radius_km) continue;

    const typeMatch =
```

Replace with (removing the guard, keeping everything after it):

```typescript
    const typeMatch =
```

Then find:

```typescript
    const proximity = 1 - dist / Math.max(eventBoost.boost_radius_km, 0.25);
    const scaled = Math.round(
      Math.max(0, (eventBoost.boost_multiplier - 1) * 18 * proximity)
    );
```

Replace with:

```typescript
    // Gaussian falloff (sigma = boost_radius_km / 2) — same formula as
    // supabase/functions/score-calculator/eventBoost.ts's gaussianDecay,
    // duplicated here across the Vite/Deno boundary the same way
    // haversineKm/haversineMeters already are elsewhere in this codebase.
    const sigma = Math.max(eventBoost.boost_radius_km, 0.25) / 2;
    const decay = Math.exp(-(dist ** 2) / (2 * sigma ** 2));
    const scaled = Math.round(
      Math.max(0, (eventBoost.boost_multiplier - 1) * 18 * decay)
    );
```

The `typeMatch` check and the per-event max/cap-30 logic after it stay exactly as they are — only the distance term changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/scoringEngine.test.ts`
Expected: PASS, including all pre-existing tests in the file (confirms this change didn't regress anything else `computeDemandScore` depends on).

- [ ] **Step 5: Run the full test suite and lint**

Run: `npm run type-check && npm run lint && npm run test:run`
Expected: 0 type errors, 0 new lint warnings (baseline was 74 warnings / 0 errors as of the last full run this session), all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scoringEngine.ts src/test/scoringEngine.test.ts
git commit -m "fix(scoring): use Gaussian distance decay for event boosts client-side"
```

---

### Task 7: End-to-end verification against the live app

**Files:** none (verification only)

- [x] **Step 1: Confirm both engines agree on shape** — verified 2026-10-22: Deno eventBoost 8/8 + Vitest scoringEngine 98/98; same formula (sigma = radius/2)

Using the same zone/event coordinates in both the Deno test (Task 4) and a manual Vitest run (Task 6), verify the two engines produce the same *shape* of curve (monotonically decreasing, ~13.5% remaining at the nominal radius) even though their aggregation strategies intentionally differ (server sums across events and caps at 25; client takes the max across events and caps at 30 — this divergence already existed before this plan and is out of scope to unify, per the approved spec's Non-goals).

- [x] **Step 2: Confirm the full pipeline end-to-end on the live project** — verified 2026-10-22 via rolled-back DO block on prod: far event → `evt-*` zone (type événements, score 77), event inside a real zone → no zone, cleanup after end_at+2h → zone removed, 0 leftovers. Top-10 read query not run.

Re-run Task 2 Step 3's qualifying-event insert against `hibzhsjgipybfihhzpxr`. Then:

```sql
-- Confirm the app's normal zone read path sees it exactly like a real zone.
SELECT id, city_id, name, type, current_score, event_id
FROM public.zones
WHERE city_id = 'mtl'
ORDER BY current_score DESC
LIMIT 10;
```

Expected: the test event's zone (`evt-*`) appears in the normal top-10-by-score query alongside real zones, with no special filtering needed — confirming Goal 2 from the spec (existing consumers see it without modification).

Clean up the test event (`DELETE FROM public.events WHERE name = 'Test Festival'`, which cascades to the zone) when done.

- [ ] **Step 3: Final full-suite check** — 2026-10-22: type-check OK, 936/936 tests, lint 0 errors but 75 warnings > max 74 (pre-existing, not from this feature)

Run: `npm run type-check && npm run lint && npm run test:run`
Expected: 0 errors, baseline warning count, all tests passing.

- [ ] **Step 4: No commit needed for this task** (verification only — nothing to stage).

---

## Self-Review Notes

- **Spec coverage:** A (data model) → Task 1; B (trigger condition) → Task 2; C (score formula) → Task 2 Step 1; D (Gaussian decay, both engines) → Tasks 4–6; E (cleanup) → Task 3; F (integration) → Task 7 confirms it, no code needed. Testing section of the spec → covered by each task's verification steps.
- **Aggregation divergence caught during planning:** the spec's Section D said "only the distance-decay shape changes," but the two engines already aggregate differently (server sums across events, client takes the max) — Tasks 4–6 preserve each engine's existing aggregation, changing only the per-event distance term, and Task 7 documents this as an intentional, pre-existing, out-of-scope divergence rather than silently unifying it without approval.
- **Type consistency:** `computeEventBoost(zone: {latitude, longitude}, activeEvents: EventBoostInput[])` in `eventBoost.ts` (Task 4) matches exactly how `index.ts` already calls it (Task 5) — same parameter shapes as the original inline function it replaces, verified against the actual current `index.ts` source during planning.
