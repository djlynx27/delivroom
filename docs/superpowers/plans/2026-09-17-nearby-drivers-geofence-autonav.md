# Nearby Drivers — Geofence Capture & Auto-Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trigger the Lyft "Nearby Drivers" screenshot capture only on arrival
at Delivroom's recommended (hero) zone, compute the micro-spot/saturation
fallback server-side, and auto-launch Google Maps navigation to it — no tap
required.

**Architecture:** A new native Capacitor plugin lets the background geofence
watcher (`shiftGeoWatcher.ts`) send an Android broadcast on hero-zone arrival,
which MacroDroid listens for to fire the existing capture macro. The Edge
Function `ingest-lyft-screenshots` computes a `navigation_target` (micro-spot
nudge, or a fallback zone if saturated) and returns it in the response, which
MacroDroid parses to fire a tap-free `Send Intent` to Google Maps.

**Tech Stack:** TypeScript (Vite/React, strict), Kotlin (Capacitor Android
plugin), Deno (Supabase Edge Function), Vitest, `deno test`.

**Spec:** `docs/superpowers/specs/2026-09-17-nearby-drivers-geofence-autonav-design.md`

## Global Constraints

- TypeScript strict: zero `any`/`as any`, named exports only (no default
  export) except where noted below.
- `as const` over enums.
- Commits: Conventional Commits, English (`feat(scope):`, `test(scope):`, etc).
- No `git push --no-verify`.
- Server-side micro-spot logic in `lyftSnapshot.ts` is a **duplicate**, not an
  import, of `src/lib/spotter.ts` — Deno and Vite don't share a module graph
  in this repo (established pattern, see `haversineKm`).
- `SATURATION_THRESHOLD` is a fixed constant marked with a `// ponytail:`
  comment noting it needs calibration against real shift data.
- Auto-commit + push after each task passes type-check/lint/tests (per
  `CLAUDE.md`'s standing rule) — stage only the files that task touched.

---

### Task 1: Server-side micro-spot + saturation fallback logic

**Files:**
- Modify: `supabase/functions/ingest-lyft-screenshots/lyftSnapshot.ts`
- Test: `supabase/functions/ingest-lyft-screenshots/index.test.ts`

**Interfaces:**
- Consumes: existing `DriverGrid` type (already exported from this file).
- Produces: `GeoPoint`, `NavigationTarget`, `ZoneScoreRow` types;
  `SATURATION_THRESHOLD` constant; `findQuietestQuadrant(grid: DriverGrid):
  { quadrant: Quadrant }`; `offsetCoordinate(origin: GeoPoint, bearingDeg:
  number, distanceMeters: number): GeoPoint`; `computeMicroSpot(zoneCentroid:
  GeoPoint, grid: DriverGrid, offsetMeters?: number): GeoPoint & { quadrant:
  Quadrant; offsetMeters: number }`; `isZoneSaturated(nearbyDriversCount:
  number): boolean`; `findBestNeighboringZone(currentZoneId: string, zones:
  ZoneScoreRow[]): ZoneScoreRow | null`; `computeNavigationTarget(currentZone:
  GeoPoint, nearbyDriversCount: number, grid: DriverGrid | undefined,
  neighboringZones: ZoneScoreRow[], currentZoneId: string):
  NavigationTarget` — Task 2 imports all of these.

- [ ] **Step 1: Write the failing tests**

Add to `supabase/functions/ingest-lyft-screenshots/index.test.ts`:

```ts
import {
  computeMicroSpot,
  computeNavigationTarget,
  findBestNeighboringZone,
  findQuietestQuadrant,
  isZoneSaturated,
  offsetCoordinate,
  SATURATION_THRESHOLD,
  type ZoneScoreRow,
} from './lyftSnapshot.ts';

const CHOMEDEY = { latitude: 45.544154, longitude: -73.739052 };

Deno.test('findQuietestQuadrant: picks the cell with the fewest drivers', () => {
  const grid = [5, 4, 0, 3, 6, 2, 1, 4, 3];
  assertEquals(findQuietestQuadrant(grid), { quadrant: 'top_right' });
});

Deno.test('findQuietestQuadrant: breaks ties by row-major order', () => {
  const grid = [0, 0, 1, 1, 1, 1, 1, 1, 1];
  assertEquals(findQuietestQuadrant(grid).quadrant, 'top_left');
});

Deno.test('offsetCoordinate: moves due north by roughly the requested distance', () => {
  const point = offsetCoordinate(CHOMEDEY, 0, 100);
  assertEquals(point.latitude > CHOMEDEY.latitude, true);
});

Deno.test('computeMicroSpot: leaves the centroid unmodified when center is quietest', () => {
  const grid = [5, 5, 5, 5, 0, 5, 5, 5, 5];
  const spot = computeMicroSpot(CHOMEDEY, grid);
  assertEquals(spot.latitude, CHOMEDEY.latitude);
  assertEquals(spot.longitude, CHOMEDEY.longitude);
  assertEquals(spot.quadrant, 'center');
  assertEquals(spot.offsetMeters, 0);
});

Deno.test('computeMicroSpot: offsets toward the sparsest quadrant', () => {
  const grid = [3, 3, 0, 3, 3, 3, 9, 3, 3];
  const spot = computeMicroSpot(CHOMEDEY, grid);
  assertEquals(spot.quadrant, 'top_right');
  assertEquals(spot.latitude > CHOMEDEY.latitude, true);
  assertEquals(spot.longitude > CHOMEDEY.longitude, true);
});

Deno.test('isZoneSaturated: true at or above the threshold', () => {
  assertEquals(isZoneSaturated(SATURATION_THRESHOLD), true);
  assertEquals(isZoneSaturated(SATURATION_THRESHOLD - 1), false);
});

const ZONES: ZoneScoreRow[] = [
  { id: 'a', name: 'Zone A', latitude: 45.5, longitude: -73.6, current_score: 40 },
  { id: 'b', name: 'Zone B', latitude: 45.6, longitude: -73.7, current_score: 80 },
  { id: 'c', name: 'Zone C', latitude: 45.7, longitude: -73.8, current_score: null },
];

Deno.test('findBestNeighboringZone: picks the highest-scoring zone, excluding self and nulls', () => {
  const best = findBestNeighboringZone('a', ZONES);
  assertEquals(best?.id, 'b');
});

Deno.test('findBestNeighboringZone: returns null when no scored neighbor exists', () => {
  const best = findBestNeighboringZone('a', [ZONES[0], ZONES[2]]);
  assertEquals(best, null);
});

Deno.test('computeNavigationTarget: falls back to the best neighbor when saturated', () => {
  const target = computeNavigationTarget(
    { latitude: 45.5, longitude: -73.6 },
    SATURATION_THRESHOLD,
    undefined,
    ZONES,
    'a'
  );
  assertEquals(target, { latitude: 45.6, longitude: -73.7, mode: 'fallback_zone', zone_name: 'Zone B' });
});

Deno.test('computeNavigationTarget: falls back to micro-spot when saturated but no neighbor scored', () => {
  const grid = [3, 3, 0, 3, 3, 3, 9, 3, 3];
  const target = computeNavigationTarget(
    CHOMEDEY,
    SATURATION_THRESHOLD,
    grid,
    [ZONES[2]],
    'a'
  );
  assertEquals(target.mode, 'micro_spot');
});

Deno.test('computeNavigationTarget: micro-spot nudge when not saturated', () => {
  const grid = [3, 3, 0, 3, 3, 3, 9, 3, 3];
  const target = computeNavigationTarget(CHOMEDEY, 2, grid, ZONES, 'a');
  assertEquals(target.mode, 'micro_spot');
  assertEquals(target.latitude > CHOMEDEY.latitude, true);
});

Deno.test('computeNavigationTarget: zone centroid (no offset) when not saturated and no grid', () => {
  const target = computeNavigationTarget(CHOMEDEY, 2, undefined, ZONES, 'a');
  assertEquals(target, { latitude: CHOMEDEY.latitude, longitude: CHOMEDEY.longitude, mode: 'micro_spot' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ingest-lyft-screenshots/`
Expected: FAIL — `computeMicroSpot`, `computeNavigationTarget`, etc. are not exported yet.

- [ ] **Step 3: Implement**

Append to `supabase/functions/ingest-lyft-screenshots/lyftSnapshot.ts` (after
the existing `formatGpsAddress` function, end of file):

```ts
// ── Micro-spot / saturation fallback ────────────────────────────────────
// Duplicated from src/lib/spotter.ts, not imported -- this Deno function
// and the Vite app don't share a module graph (see the DriverGrid comment
// above). Computed server-side so the recommendation reaches the driver
// without Delivroom ever being foregrounded -- see
// docs/superpowers/specs/2026-09-17-nearby-drivers-geofence-autonav-design.md.

export type Quadrant =
  | 'top_left' | 'top_center' | 'top_right'
  | 'middle_left' | 'center' | 'middle_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right';

const QUADRANT_LABELS: Quadrant[] = [
  'top_left', 'top_center', 'top_right',
  'middle_left', 'center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
];

const QUADRANT_BEARING_DEG: Record<Quadrant, number | null> = {
  top_left: 315,
  top_center: 0,
  top_right: 45,
  middle_left: 270,
  center: null,
  middle_right: 90,
  bottom_left: 225,
  bottom_center: 180,
  bottom_right: 135,
};

export const MIN_SPOT_OFFSET_METERS = 50;
export const MAX_SPOT_OFFSET_METERS = 150;
const DEFAULT_SPOT_OFFSET_METERS = 100;
const EARTH_RADIUS_METERS = 6_371_000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Row-major (matches the Gemini prompt in index.ts): the least-dense grid
 * cell, ties resolved to the first cell in row-major order. */
export function findQuietestQuadrant(grid: DriverGrid): { quadrant: Quadrant } {
  let bestIndex = 0;
  for (let i = 1; i < grid.length; i++) {
    if (grid[i] < grid[bestIndex]) bestIndex = i;
  }
  return { quadrant: QUADRANT_LABELS[bestIndex] };
}

function clampOffsetMeters(distanceMeters: number): number {
  return Math.min(MAX_SPOT_OFFSET_METERS, Math.max(MIN_SPOT_OFFSET_METERS, distanceMeters));
}

/** Equirectangular destination-point approximation -- accurate enough at the
 * tens-to-low-hundreds-of-meters distances this deals with. */
export function offsetCoordinate(
  origin: GeoPoint,
  bearingDeg: number,
  distanceMeters: number
): GeoPoint {
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const latRad = (origin.latitude * Math.PI) / 180;
  const dLat = (distanceMeters * Math.cos(bearingRad)) / EARTH_RADIUS_METERS;
  const dLng =
    (distanceMeters * Math.sin(bearingRad)) / (EARTH_RADIUS_METERS * Math.cos(latRad));
  return {
    latitude: origin.latitude + (dLat * 180) / Math.PI,
    longitude: origin.longitude + (dLng * 180) / Math.PI,
  };
}

/** 50-150m tactical offset toward the sparsest grid cell -- zero offset
 * (zone centroid unchanged) when the center cell is already quietest. */
export function computeMicroSpot(
  zoneCentroid: GeoPoint,
  grid: DriverGrid,
  offsetMeters: number = DEFAULT_SPOT_OFFSET_METERS
): GeoPoint & { quadrant: Quadrant; offsetMeters: number } {
  const { quadrant } = findQuietestQuadrant(grid);
  const bearingDeg = QUADRANT_BEARING_DEG[quadrant];
  if (bearingDeg === null) {
    return { ...zoneCentroid, quadrant, offsetMeters: 0 };
  }
  const distance = clampOffsetMeters(offsetMeters);
  const point = offsetCoordinate(zoneCentroid, bearingDeg, distance);
  return { ...point, quadrant, offsetMeters: distance };
}

// ponytail: fixed threshold, calibrate with real shift data once a few
// real captures land -- add a per-cell density check instead if a flat
// total ever proves too coarse.
export const SATURATION_THRESHOLD = 15;

export function isZoneSaturated(nearbyDriversCount: number): boolean {
  return nearbyDriversCount >= SATURATION_THRESHOLD;
}

export interface ZoneScoreRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  current_score: number | null;
}

/** Highest-scoring zone other than `currentZoneId`, excluding unscored
 * zones -- mirrors shiftGeoWatcher.ts's notifyBestAlternate. */
export function findBestNeighboringZone(
  currentZoneId: string,
  zones: ZoneScoreRow[]
): ZoneScoreRow | null {
  const candidates = zones.filter((z) => z.id !== currentZoneId && z.current_score != null);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, z) =>
    (z.current_score ?? 0) > (best.current_score ?? 0) ? z : best
  );
}

export interface NavigationTarget extends GeoPoint {
  mode: 'micro_spot' | 'fallback_zone';
  zone_name?: string;
}

/** The single entry point index.ts calls: saturated zone -> best
 * neighboring zone (or the micro-spot nudge, if no neighbor is scored);
 * otherwise the micro-spot nudge (or the bare zone centroid, if no grid). */
export function computeNavigationTarget(
  currentZone: GeoPoint,
  nearbyDriversCount: number,
  grid: DriverGrid | undefined,
  neighboringZones: ZoneScoreRow[],
  currentZoneId: string
): NavigationTarget {
  if (isZoneSaturated(nearbyDriversCount)) {
    const fallback = findBestNeighboringZone(currentZoneId, neighboringZones);
    if (fallback) {
      return {
        latitude: fallback.latitude,
        longitude: fallback.longitude,
        mode: 'fallback_zone',
        zone_name: fallback.name,
      };
    }
    // No scored neighbor -- fall through to the micro-spot nudge below
    // rather than fail the response (see spec's Error handling section).
  }
  if (!grid) {
    return { ...currentZone, mode: 'micro_spot' };
  }
  const spot = computeMicroSpot(currentZone, grid);
  return { latitude: spot.latitude, longitude: spot.longitude, mode: 'micro_spot' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ingest-lyft-screenshots/`
Expected: PASS, all new tests + existing ones green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ingest-lyft-screenshots/lyftSnapshot.ts supabase/functions/ingest-lyft-screenshots/index.test.ts
git commit -m "feat(drive): add server-side micro-spot and saturation fallback logic

Claude-Session: https://claude.ai/code/session_0136Ye9rM8de1ia1osvHvrmv"
```

---

### Task 2: Wire `navigation_target` into the ingest-lyft-screenshots response

**Files:**
- Modify: `supabase/functions/ingest-lyft-screenshots/index.ts`

**Interfaces:**
- Consumes: `computeNavigationTarget`, `NavigationTarget` from Task 1
  (`./lyftSnapshot.ts`).
- Produces: response body gains `navigation_target?: NavigationTarget` —
  Task 6 (MacroDroid docs) documents parsing this field.

- [ ] **Step 1: Extend the `ZoneRow` interface and import Task 1's exports**

In `supabase/functions/ingest-lyft-screenshots/index.ts`, replace the
existing `ZoneRow` interface (lines 72-76):

```ts
interface ZoneRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  current_score: number | null;
}
```

And extend the import block (lines 37-47) to add:

```ts
import {
  computeNavigationTarget,
  decodeBase64Image,
  formatGpsAddress,
  hashImages,
  haversineKm,
  parseLyftSnapshot,
  parseNearbyOnlySnapshot,
  resizeForGemini,
  shouldFlagEmergingHotspot,
  type LyftSnapshot,
  type NavigationTarget,
} from './lyftSnapshot.ts';
```

- [ ] **Step 2: Replace the single-purpose zone fetch with one shared fetch**

Replace `resolveNearestZone` (lines 423-443) with a pure version plus a new
fetch helper:

```ts
async function fetchAllZones(client: SupabaseClient): Promise<ZoneRow[]> {
  const { data, error } = await client
    .from('zones')
    .select('id, name, latitude, longitude, current_score');
  if (error || !data) return [];
  return data as ZoneRow[];
}

interface NearestZoneResult {
  id: string;
  distanceKm: number;
}

function resolveNearestZone(zones: ZoneRow[], lat: number, lng: number): NearestZoneResult | null {
  let best: ZoneRow | null = null;
  let bestDist = Infinity;
  for (const zone of zones) {
    const dist = haversineKm(lat, lng, zone.latitude, zone.longitude);
    if (dist < bestDist) {
      bestDist = dist;
      best = zone;
    }
  }
  return best ? { id: best.id, distanceKm: bestDist } : null;
}
```

Delete the old `interface NearestZoneResult` block that currently sits just
above the old `resolveNearestZone` (lines 418-422) — replaced by the version
above.

- [ ] **Step 3: Fetch zones once and reuse for nearest-zone + navigation target**

In `handleRequest`, replace the zone-resolution block (lines 262-268):

```ts
  let zoneId = body.zone_id ?? null;
  let nearestDistanceKm: number | null = null;
  if (!zoneId && client) {
    const nearest = await resolveNearestZone(client, body.latitude!, body.longitude!);
    zoneId = nearest?.id ?? null;
    nearestDistanceKm = nearest?.distanceKm ?? null;
  }
```

with:

```ts
  let zoneId = body.zone_id ?? null;
  let nearestDistanceKm: number | null = null;
  const zones = client ? await fetchAllZones(client) : [];
  if (!zoneId) {
    const nearest = resolveNearestZone(zones, body.latitude!, body.longitude!);
    zoneId = nearest?.id ?? null;
    nearestDistanceKm = nearest?.distanceKm ?? null;
  }
```

- [ ] **Step 4: Compute the navigation target and include it in the response**

Replace the final response line (line 302):

```ts
  return json({ ok: true, zone_id: zoneId, snapshot, emerging_hotspot: emergingHotspot });
```

with:

```ts
  let navigationTarget: NavigationTarget | null = null;
  if (zoneId) {
    const currentZone = zones.find((z) => z.id === zoneId);
    if (currentZone) {
      navigationTarget = computeNavigationTarget(
        { latitude: currentZone.latitude, longitude: currentZone.longitude },
        snapshot.nearby_drivers_count,
        snapshot.nearby_drivers_grid,
        zones,
        zoneId
      );
    }
  }

  return json({
    ok: true,
    zone_id: zoneId,
    snapshot,
    emerging_hotspot: emergingHotspot,
    ...(navigationTarget && { navigation_target: navigationTarget }),
  });
```

- [ ] **Step 5: Type-check and run the existing Deno test suite**

Run: `deno check supabase/functions/ingest-lyft-screenshots/index.ts`
Expected: no errors.

Run: `deno test supabase/functions/ingest-lyft-screenshots/`
Expected: PASS (unchanged — index.ts itself isn't imported by the test file,
per the file's own header comment, so this only re-confirms Task 1's tests
still pass against the now-consumed exports).

- [ ] **Step 6: Manual verification against a real deploy**

This function's request-handling flow has no automated HTTP-level test in
this repo (confirmed: `index.test.ts` only imports `lyftSnapshot.ts`, never
`index.ts`, since `index.ts` calls `serve()` at module load). Verify by hand
after deploying:

```bash
supabase functions deploy ingest-lyft-screenshots --no-verify-jwt
curl -X POST https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/ingest-lyft-screenshots \
  -H "Authorization: Bearer <INGEST_LYFT_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"nearby_drivers_image_base64":"<a real base64 nearby-drivers screenshot>","latitude":45.5017,"longitude":-73.5673}'
```

Expected: response JSON includes a `navigation_target` object with
`latitude`/`longitude`/`mode`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ingest-lyft-screenshots/index.ts
git commit -m "feat(drive): return computed navigation_target from ingest-lyft-screenshots

Claude-Session: https://claude.ai/code/session_0136Ye9rM8de1ia1osvHvrmv"
```

---

### Task 3: Native Capacitor plugin — `DelivroomBroadcast`

**Files:**
- Create: `android/app/src/main/java/com/delivroom/app/DelivroomBroadcastPlugin.kt`
- Modify: `android/app/src/main/java/com/delivroom/app/MainActivity.java`
- Create: `src/lib/delivroomBroadcast.ts`

**Interfaces:**
- Produces: `DelivroomBroadcast.sendBroadcast(options: { action: string }):
  Promise<void>` (default export from `src/lib/delivroomBroadcast.ts`) —
  Task 4 (`shiftGeoWatcher.ts`) calls this.

This is the repo's first custom native Capacitor plugin — no automated test
is possible (native Android, no CI device). Verified manually in Step 4.

- [ ] **Step 1: Write the native plugin**

Create `android/app/src/main/java/com/delivroom/app/DelivroomBroadcastPlugin.kt`:

```kotlin
package com.delivroom.app

import android.content.Intent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// Sends a plain Android broadcast intent -- used by shiftGeoWatcher.ts to
// notify MacroDroid (which registers its own receiver at runtime via its
// "Intent Received" trigger, same mechanism already used for
// com.delivroom.SHOW_OVERLAY, sent today from the PC bridge via ADB) that
// the driver has arrived in the recommended zone and the Nearby Drivers
// capture macro should fire. No app-level permission needed: this mirrors
// the already-working ADB broadcast, just sent from on-device instead of a
// PC, so it works even when the PC/Tailscale bridge is off.
@CapacitorPlugin(name = "DelivroomBroadcast")
class DelivroomBroadcastPlugin : Plugin() {
    @PluginMethod
    fun sendBroadcast(call: PluginCall) {
        val action = call.getString("action")
        if (action == null) {
            call.reject("action is required")
            return
        }
        context.sendBroadcast(Intent(action))
        call.resolve()
    }
}
```

- [ ] **Step 2: Register the plugin in MainActivity**

Replace `android/app/src/main/java/com/delivroom/app/MainActivity.java`:

```java
package com.delivroom.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DelivroomBroadcastPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

- [ ] **Step 3: Write the TS wrapper**

Create `src/lib/delivroomBroadcast.ts`:

```ts
// Thin registerPlugin wrapper for the native DelivroomBroadcastPlugin
// (android/app/src/main/java/com/delivroom/app/DelivroomBroadcastPlugin.kt).
// Same shape as the BackgroundGeolocation registration in
// shiftGeoWatcher.ts -- this plugin has no JS-side implementation, native
// Android only.

import { registerPlugin } from '@capacitor/core';

export interface DelivroomBroadcastPlugin {
  sendBroadcast(options: { action: string }): Promise<void>;
}

const DelivroomBroadcast = registerPlugin<DelivroomBroadcastPlugin>('DelivroomBroadcast');

export default DelivroomBroadcast;
```

- [ ] **Step 4: Build, install, and manually verify the broadcast fires**

```bash
npm run build:apk
npm run install:apk
adb logcat -c
adb shell am start -n com.delivroom.app/.MainActivity
```

With the app open on-device, open the remote DevTools console (via
`chrome://inspect` on the PC, Tailscale-forwarded or USB) and run:

```js
window.Capacitor.Plugins.DelivroomBroadcast.sendBroadcast({ action: 'com.delivroom.TRIGGER_NEARBY_CAPTURE' })
```

Expected: no JS error (the call resolves). Confirm the broadcast actually
left the app via `adb logcat | grep -i delivroom` (Capacitor logs plugin
calls at `Capacitor/Console`) — full end-to-end confirmation (MacroDroid
receiving it) happens after Task 6 wires the "Lyft 3 Functions" macro to
this action.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/delivroom/app/DelivroomBroadcastPlugin.kt android/app/src/main/java/com/delivroom/app/MainActivity.java src/lib/delivroomBroadcast.ts
git commit -m "feat(android): add DelivroomBroadcast native plugin for MacroDroid triggers

Claude-Session: https://claude.ai/code/session_0136Ye9rM8de1ia1osvHvrmv"
```

---

### Task 4: `shiftGeoWatcher.ts` — arrival-triggered capture

**Files:**
- Modify: `src/lib/shiftGeoWatcher.ts`
- Test: `src/test/shiftGeoWatcher.test.ts`

**Interfaces:**
- Consumes: `DelivroomBroadcast` default export from Task 3
  (`@/lib/delivroomBroadcast`).
- Produces: exported `PREFS_HERO_ZONE_KEY` constant — Task 5
  (`DriveScreen.tsx`) writes to this exact Preferences key; exported
  `evaluateCaptureTrigger(prevCapturedZoneId: string | null, nearestZoneId:
  string | null, heroZoneId: string | null): { capturedZoneId: string | null;
  shouldCapture: boolean }` (pure, unit-tested here).

- [ ] **Step 1: Write the failing tests**

Add to `src/test/shiftGeoWatcher.test.ts`:

```ts
import { evaluateCaptureTrigger } from '@/lib/shiftGeoWatcher';

describe('evaluateCaptureTrigger', () => {
  it('does nothing when there is no hero zone set yet', () => {
    expect(evaluateCaptureTrigger(null, 'z1', null)).toEqual({
      capturedZoneId: null,
      shouldCapture: false,
    });
  });

  it('does nothing when the driver is not in the hero zone', () => {
    expect(evaluateCaptureTrigger(null, 'z1', 'z2')).toEqual({
      capturedZoneId: null,
      shouldCapture: false,
    });
  });

  it('fires once on arrival in the hero zone', () => {
    expect(evaluateCaptureTrigger(null, 'z1', 'z1')).toEqual({
      capturedZoneId: 'z1',
      shouldCapture: true,
    });
  });

  it('does not re-fire on later callbacks in the same hero-zone stay', () => {
    expect(evaluateCaptureTrigger('z1', 'z1', 'z1')).toEqual({
      capturedZoneId: 'z1',
      shouldCapture: false,
    });
  });

  it('clears the captured mark once the driver leaves the hero zone', () => {
    expect(evaluateCaptureTrigger('z1', 'z2', 'z1')).toEqual({
      capturedZoneId: null,
      shouldCapture: false,
    });
  });

  it('re-fires on a later re-entry into the hero zone', () => {
    const left = evaluateCaptureTrigger('z1', 'z2', 'z1');
    const reentered = evaluateCaptureTrigger(left.capturedZoneId, 'z1', 'z1');
    expect(reentered).toEqual({ capturedZoneId: 'z1', shouldCapture: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/test/shiftGeoWatcher.test.ts`
Expected: FAIL — `evaluateCaptureTrigger` is not exported yet.

- [ ] **Step 3: Implement**

In `src/lib/shiftGeoWatcher.ts`, add the import (near the top, with the
other `@/lib` imports):

```ts
import DelivroomBroadcast from '@/lib/delivroomBroadcast';
```

Add new constants next to the existing ones (after `PREFS_WATCHER_ID_KEY`,
line 47):

```ts
export const PREFS_HERO_ZONE_KEY = 'delivroom_hero_zone_id';
const PREFS_CAPTURED_ZONE_KEY = 'delivroom_shift_geo_captured_zone';
const TRIGGER_CAPTURE_ACTION = 'com.delivroom.TRIGGER_NEARBY_CAPTURE';
```

Add the pure function next to `evaluateZoneStay` (after line 84):

```ts
export interface CaptureTriggerEvaluation {
  capturedZoneId: string | null;
  shouldCapture: boolean;
}

/** Pure state machine, mirrors evaluateZoneStay's shape -- fires once per
 * hero-zone arrival (not the 15-min stay timer, a separate concern). */
export function evaluateCaptureTrigger(
  prevCapturedZoneId: string | null,
  nearestZoneId: string | null,
  heroZoneId: string | null
): CaptureTriggerEvaluation {
  if (nearestZoneId == null || heroZoneId == null || nearestZoneId !== heroZoneId) {
    // Not standing in the hero zone (or it isn't known yet) -- clear any
    // stale "already captured" mark so a later re-entry fires again.
    return { capturedZoneId: null, shouldCapture: false };
  }
  if (prevCapturedZoneId === heroZoneId) {
    return { capturedZoneId: prevCapturedZoneId, shouldCapture: false };
  }
  return { capturedZoneId: heroZoneId, shouldCapture: true };
}
```

Add helpers next to `readState`/`writeState` (after line 127):

```ts
async function readHeroZoneId(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: PREFS_HERO_ZONE_KEY });
    return value || null;
  } catch {
    return null;
  }
}

async function readCapturedZoneId(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: PREFS_CAPTURED_ZONE_KEY });
    return value || null;
  } catch {
    return null;
  }
}

async function writeCapturedZoneId(zoneId: string | null): Promise<void> {
  try {
    if (zoneId == null) {
      await Preferences.remove({ key: PREFS_CAPTURED_ZONE_KEY });
    } else {
      await Preferences.set({ key: PREFS_CAPTURED_ZONE_KEY, value: zoneId });
    }
  } catch {
    // Preferences unavailable -- next callback just re-evaluates from GPS.
  }
}

async function triggerNearbyCapture(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await DelivroomBroadcast.sendBroadcast({ action: TRIGGER_CAPTURE_ACTION });
    log('triggerNearbyCapture: broadcast sent');
  } catch (err) {
    logError('triggerNearbyCapture failed', err);
  }
}
```

Replace `onLocation` (lines 166-181) with:

```ts
async function onLocation(lat: number, lng: number) {
  try {
    const zones = await fetchZonesLite();
    const nearest = findNearestZone(lat, lng, zones);
    const prev = await readState();
    const { state, shouldNotify } = evaluateZoneStay(prev, Date.now(), nearest?.id ?? null);
    await writeState(state);

    const heroZoneId = await readHeroZoneId();
    const prevCaptured = await readCapturedZoneId();
    const { capturedZoneId, shouldCapture } = evaluateCaptureTrigger(
      prevCaptured,
      nearest?.id ?? null,
      heroZoneId
    );
    if (capturedZoneId !== prevCaptured) await writeCapturedZoneId(capturedZoneId);
    if (shouldCapture) await triggerNearbyCapture();

    log('onLocation', {
      lat,
      lng,
      nearestZone: nearest?.id ?? null,
      shouldNotify,
      heroZoneId,
      shouldCapture,
    });

    if (shouldNotify && nearest) {
      await notifyBestAlternate(nearest.id);
    }
  } catch (err) {
    logError('onLocation failed', err);
  }
}
```

In `stopShiftWatcher` (line 293), add the captured-zone cleanup right after
`await writeState(null);`:

```ts
    await writeState(null);
    await writeCapturedZoneId(null);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/test/shiftGeoWatcher.test.ts`
Expected: PASS, all tests including the pre-existing `evaluateZoneStay` ones.

- [ ] **Step 5: Type-check and lint**

Run: `npm run type-check && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shiftGeoWatcher.ts src/test/shiftGeoWatcher.test.ts
git commit -m "feat(drive): trigger Nearby Drivers capture broadcast on hero-zone arrival

Claude-Session: https://claude.ai/code/session_0136Ye9rM8de1ia1osvHvrmv"
```

---

### Task 5: `DriveScreen.tsx` — persist hero zone id for the background watcher

**Files:**
- Modify: `src/pages/DriveScreen.tsx`

**Interfaces:**
- Consumes: `PREFS_HERO_ZONE_KEY` from Task 4 (`@/lib/shiftGeoWatcher`).

Trivial one-line-effect addition — no dedicated test (per this repo's
`ponytail` convention: trivial one-liners don't need a test); covered by
`type-check`/`lint` plus the existing DriveScreen test suite staying green.

- [ ] **Step 1: Add the Preferences import**

In `src/pages/DriveScreen.tsx`, add near the top import block (alongside the
other `@/lib`/`@capacitor` imports, e.g. next to the `computeMicroSpot`
import at line 53):

```ts
import { Preferences } from '@capacitor/preferences';
import { PREFS_HERO_ZONE_KEY } from '@/lib/shiftGeoWatcher';
```

- [ ] **Step 2: Add the persistence effect**

Right after the existing hero-zone-change vibrate effect (after line 440,
`}, [heroZone?.id, isLyftSyncing, vibrate]);`), add:

```ts
  // Persist the recommended zone so the background geofence watcher
  // (shiftGeoWatcher.ts, running even when this screen isn't mounted) knows
  // which zone counts as "arrival" for the Nearby Drivers capture trigger.
  useEffect(() => {
    if (!heroZone) return;
    void Preferences.set({ key: PREFS_HERO_ZONE_KEY, value: heroZone.id });
  }, [heroZone?.id]);
```

- [ ] **Step 3: Type-check, lint, run the full test suite**

Run: `npm run type-check && npm run lint && npm run test:run`
Expected: no errors, all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DriveScreen.tsx
git commit -m "feat(drive): persist hero zone id for the background geofence watcher

Claude-Session: https://claude.ai/code/session_0136Ye9rM8de1ia1osvHvrmv"
```

---

### Task 6: MacroDroid device edits + docs

**Files:**
- Modify: `docs/ingest-lyft-screenshots-macrodroid.md`

Not application code — MacroDroid macros live on the physical device and
must be edited live in its UI (the repo's own docs already establish that a
`.macro` file re-import doesn't replace an existing macro, matched by
`m_GUID`). This task documents the exact device-side steps as a checklist
Oualid runs by hand, and updates the doc so the next session has the
context.

- [ ] **Step 1: Add a new section to the docs**

Append to `docs/ingest-lyft-screenshots-macrodroid.md`:

```markdown
## 10. Déclenchement par géofence + auto-navigation Maps (2026-09-17)

Voir `docs/superpowers/specs/2026-09-17-nearby-drivers-geofence-autonav-design.md`
pour le design complet. Changement de comportement : la capture "Nearby
Drivers" ne se déclenche plus sur intervalle (§8) mais uniquement à
l'arrivée dans la zone recommandée (hero zone) ou sur clic manuel.

### 10.1 Édition de la macro "Lyft 3 Functions"

1. Ouvrir la macro dans l'éditeur MacroDroid (édition live sur le device,
   pas d'import de fichier — voir le piège `m_GUID` documenté plus haut
   dans ce fichier).
2. **Retirer** le trigger intervalle existant (§8.1).
3. **Ajouter** un trigger `Intent Received` (catégorie *MacroDroid
   Specific* ou recherche texte dans le picker) :
   - Action de l'intent : `com.delivroom.TRIGGER_NEARBY_CAPTURE`
   - Combiné en OR avec le trigger manuel déjà en place (raccourci/bouton).
4. Après l'action `HTTP Request` existante (POST vers
   `ingest-lyft-screenshots`), ajouter :
   - Une action **"Obtenir la valeur JSON"** (ou équivalent MacroDroid pour
     parser la réponse HTTP) sur les champs
     `navigation_target.latitude` / `navigation_target.longitude` →
     variables locales `%nav_lat%` / `%nav_lng%`.
   - Une **contrainte** sur les actions suivantes : `%nav_lat%` non vide
     (dédup/kill-switch, même pattern que `Lyft_GPS_Google_Maps.macro` —
     voir §"Fix boucle infinie" plus haut) — évite un Intent vide si la
     réponse n'a pas de `navigation_target` (cas replay dédupliqué, ou
     erreur amont).
   - Une action `Send Intent` : target `Activity`, action
     `android.intent.action.VIEW`, package `com.google.android.apps.maps`,
     data `google.navigation:q={lv=nav_lat},{lv=nav_lng}` — même schéma
     que `scripts/Lyft_GPS_Google_Maps.macro`.
5. Ré-exporter la macro, vérifier `m_isDisabled` sur chaque action/trigger
   (piège déjà documenté §9.2) avant de considérer le fix terminé.

### 10.2 Vérification bout-en-bout

1. Confirmer que le plugin natif envoie bien le broadcast (Task 3 de
   `docs/superpowers/plans/2026-09-17-nearby-drivers-geofence-autonav.md`,
   Step 4).
2. Démarrer un shift, se rendre physiquement (ou simuler via une app de
   mock GPS) dans la hero zone affichée par Delivroom.
3. Confirmer dans les logs MacroDroid (icône ⋮ → Logs, ou
   `adb logcat | grep -i macrodroid`) que le trigger `Intent Received`
   s'est déclenché et que la macro a couru.
4. Confirmer que Google Maps s'ouvre automatiquement en navigation, sans
   tap, avec la bonne destination (micro-spot dans la zone ou zone de
   repli si saturée — comparer avec le `navigation_target.mode` retourné
   par la fonction, visible dans les `function_logs` Supabase).
```

- [ ] **Step 2: Commit**

```bash
git add docs/ingest-lyft-screenshots-macrodroid.md
git commit -m "docs(drive): document geofence-triggered capture and auto-nav macro edits

Claude-Session: https://claude.ai/code/session_0136Ye9rM8de1ia1osvHvrmv"
```

- [ ] **Step 3: Perform the device-side MacroDroid edits from §10.1 and run
  the §10.2 verification checklist by hand.** (Not automatable — this is
  the terminal step of the plan.)
