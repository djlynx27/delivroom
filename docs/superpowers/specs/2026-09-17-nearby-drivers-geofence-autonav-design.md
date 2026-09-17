# Nearby Drivers — Geofence Capture & Auto-Navigation — Design Spec

Status: approved by Oualid 2026-09-17, pending implementation plan.

## Problem

Three pieces of "Nearby Drivers" tactical positioning already exist but
aren't wired together correctly:

1. **Capture trigger is wrong.** The MacroDroid macro "Lyft 3 Functions"
   fires on a 5-min interval or app-launch (see
   `docs/ingest-lyft-screenshots-macrodroid.md` §7-8) — never on actually
   *arriving* at the recommended zone. Lyft's "Nearby drivers" view is
   hyper-local; capturing it from anywhere but the target zone is noise.
2. **Micro-spot computation is client-only.** `computeMicroSpot()`
   (`src/lib/spotter.ts`) runs in `DriveScreen.tsx`, which is almost never
   the foreground app during a real shift (Lyft Driver is). The computed
   spot only ever reaches the driver if they happen to have Delivroom open.
3. **Maps navigation still needs a tap.** `openMapsNavigation()`
   (`shiftGeoWatcher.ts`) only fires from a notification action tap (the
   15-min-stay "GO →" flow) — there's no path from "vision analysis done"
   to "Maps is already navigating" without the driver touching anything.
4. **No saturation fallback.** If the recommended zone is itself flooded
   with rival drivers, today's logic only ever nudges 50-150m within the
   same zone (`computeMicroSpot`'s offset cap) — there's no "give up on
   this zone, go to the next one" path.

## Goals

1. Capture "Nearby Drivers" **only** on arrival at the app's recommended
   (hero) zone, or on manual trigger via the existing floating overlay
   button — not on a timer.
2. Compute the micro-spot (or a fallback zone, if saturated) **server-side**,
   so the recommendation exists without Delivroom ever being foregrounded.
3. Auto-launch Google Maps turn-by-turn navigation to that target
   **immediately after capture**, no tap required.
4. If the zone reads as saturated (rival driver count over threshold),
   fall back to the best-scoring neighboring zone instead of a micro-nudge.

## Non-goals

- Changing the existing 15-min-stay "GO →" flow in `shiftGeoWatcher.ts` —
  stays as-is, separate feature, separate trigger.
- iOS. Android/Capacitor only, per this repo's `android/` setup.
- Per-cell saturation threshold (grid-cell-level) — deferred; using total
  `nearby_drivers_count` only (see Decisions).

**Clarification vs. the prior "Shift Tracker Background" spec's
non-goal** (`2026-09-16-shift-tracker-background-design.md`): that spec
rejected a *tap-free* Maps launch from **Delivroom's own WebView**,
because Android 10+ blocks background activity starts from an app with no
recent user interaction. This spec doesn't hit that restriction — the
`Send Intent` action here is fired by **MacroDroid**, which already does
exactly this (no-tap `ACTION_VIEW` → Google Maps) in the working
`Lyft_GPS_Google_Maps.macro`. Different actor, different Android rules;
not a contradiction.

## Decisions (confirmed 2026-09-17)

| Question | Decision |
|---|---|
| How does the background geofence watcher tell MacroDroid to capture? | New native Capacitor plugin sends an Android broadcast intent — works with the PC/bridge off. |
| Where is the micro-spot/fallback computed? | Server-side, in `ingest-lyft-screenshots`, ported (duplicated, not imported) from `spotter.ts` — same "Deno and Vite don't share a module graph" pattern already used for `haversineKm`. |
| Which zone triggers the capture? | The app's recommended **hero zone**, not just nearest-zone — requires syncing the hero zone id to the background watcher. |
| Saturation threshold? | Total `nearby_drivers_count` (already extracted by Gemini), not per-cell density. |

## Architecture

```
DriveScreen computes heroZone (existing)
  → NEW: writes heroZone.id to Preferences (delivroom_hero_zone_id)

shiftGeoWatcher (existing background foreground-service)
  → onLocation(): nearest zone === heroZoneId (from Preferences) AND not yet captured for this zone-stay
    → NEW: DelivroomBroadcast.sendBroadcast('com.delivroom.TRIGGER_NEARBY_CAPTURE')
    → marks capturedZoneId (persisted, same pattern as ZoneStayState.notified)

MacroDroid "Lyft 3 Functions" macro
  → trigger: Intent Received (com.delivroom.TRIGGER_NEARBY_CAPTURE) OR manual (floating button)
  → existing: tap Nearby Drivers sheet → screenshot → GPS → POST ingest-lyft-screenshots
  → NEW: parse JSON response → navigation_target.{latitude,longitude}
  → NEW: Send Intent google.navigation:q=<lat>,<lng> (no tap, same pattern as Lyft_GPS_Google_Maps.macro)

ingest-lyft-screenshots (Edge Function)
  → existing: Gemini vision → LyftSnapshot { nearby_drivers_count, nearby_drivers_grid }
  → NEW: if nearby_drivers_count >= SATURATION_THRESHOLD:
           navigation_target = best-scoring neighboring zone (mode: 'fallback_zone')
         else:
           navigation_target = computeMicroSpot-equivalent 50-150m nudge (mode: 'micro_spot')
  → response includes navigation_target
```

## Components

1. **`android/app/src/main/java/com/delivroom/app/DelivroomBroadcastPlugin.kt`** (new)
   - First custom Capacitor plugin in this repo (no prior precedent in
     `android/app/src/main/java/`).
   - Single method: `sendBroadcast({ action: string })` →
     `context.sendBroadcast(Intent(action))`.
   - Registered in `MainActivity.java`.
   - `src/lib/delivroomBroadcast.ts` — thin `registerPlugin` wrapper
     (same shape as the existing `BackgroundGeolocation` registration in
     `shiftGeoWatcher.ts`).

2. **`src/lib/shiftGeoWatcher.ts`** (edit)
   - `onLocation()` reads `delivroom_hero_zone_id` from `Preferences`
     (new key, written by `DriveScreen.tsx`) instead of only computing
     nearest-zone-by-score for the existing 15-min flow.
   - New persisted field `capturedZoneId` alongside the existing
     `ZoneStayState` — fires the broadcast once per zone-entry (reset
     when the zone changes), independent of the 15-min timer.

3. **`src/pages/DriveScreen.tsx`** (edit)
   - New `useEffect` (next to the existing hero-zone-change vibrate
     effect, ~line 434) writing `heroZone.id` to `Preferences` whenever
     it changes.

4. **`supabase/functions/ingest-lyft-screenshots/lyftSnapshot.ts`** (edit)
   - Ports `findQuietestQuadrant`, `offsetCoordinate`, and a
     `computeMicroSpot`-equivalent from `src/lib/spotter.ts` (duplicated
     per the existing cross-runtime pattern, not imported).
   - New `SATURATION_THRESHOLD = 15` constant, marked
     `// ponytail: fixed threshold, calibrate with real shift data once
     a few real captures land`.
   - New function resolving the best-scoring neighboring zone when
     saturated (mirrors `notifyBestAlternate`'s "best alternate" query,
     duplicated server-side — `ZoneRow` already fetched for GPS
     resolution just needs `current_score` added to the select).

5. **`supabase/functions/ingest-lyft-screenshots/index.ts`** (edit)
   - Response body gains `navigation_target: { latitude, longitude, mode:
     'micro_spot' | 'fallback_zone', zone_name?: string }`.

6. **MacroDroid — device-side edits** (not code in this repo, but tracked
   in `docs/ingest-lyft-screenshots-macrodroid.md`)
   - "Lyft 3 Functions": swap interval trigger for `Intent Received` on
     `com.delivroom.TRIGGER_NEARBY_CAPTURE`; keep existing manual trigger
     as a second OR condition.
   - Add response-parsing + `Send Intent` action after the existing HTTP
     Request action, gated on `response.ok == true` (avoid an empty
     Intent on a 502/error response).
   - Live device edits only — the documented `m_GUID` re-import pitfall
     applies (`docs/ingest-lyft-screenshots-macrodroid.md` §"Deuxième bug
     corrigé").

## Data flow

```
shift active + DriveScreen mounted at least once
  → heroZone changes → Preferences[delivroom_hero_zone_id] = heroZone.id

driver physically enters heroZone (GPS, background service running)
  → shiftGeoWatcher.onLocation(): nearestZone.id === heroZoneId && capturedZoneId !== heroZoneId
    → DelivroomBroadcast.sendBroadcast('com.delivroom.TRIGGER_NEARBY_CAPTURE')
    → capturedZoneId = heroZoneId (persisted)

MacroDroid receives broadcast (or manual floating-button trigger)
  → tap Nearby Drivers sheet, screenshot, GPS, POST ingest-lyft-screenshots
  → Edge Function: Gemini vision → snapshot + grid
      → nearby_drivers_count >= 15? fallback zone : micro-spot nudge
      → response.navigation_target = { lat, lng, mode }
  → MacroDroid parses response → Send Intent google.navigation:q=lat,lng

driver's phone auto-switches to Google Maps navigation, no tap
```

## Error handling

- Broadcast plugin call fails (permission/plugin unavailable) → logged via
  existing `logError` pattern in `shiftGeoWatcher.ts`, no crash — capture
  simply doesn't fire; manual floating-button trigger remains a fallback.
- `heroZoneId` missing from Preferences (DriveScreen never opened this
  session) → `onLocation()` skips the arrival-capture check entirely
  (existing 15-min-stay logic is unaffected, it doesn't depend on this
  key).
- Edge Function: Gemini/vision failure → existing 502 behavior unchanged;
  MacroDroid's new `Send Intent` action is gated on `response.ok`, so no
  Intent fires on error — no behavior change from today's failure mode.
- No neighboring zone with a score found during saturation fallback →
  same "no alternate found" no-op already used in `notifyBestAlternate`;
  falls back to the micro-spot nudge instead of failing the response.

## Testing

- `tsc --noEmit`, `npm run lint`, `npm run test:run`.
- Vitest: mirror `spotter.test.ts` for the ported Deno functions in
  `lyftSnapshot.ts` (same fixtures, same edge cases: no grid, tied
  quadrants, center-quietest).
- Vitest: extend `shiftGeoWatcher.test.ts` for the new `capturedZoneId`
  state transitions (new zone entry fires once, no re-fire on repeated
  callbacks in the same zone, resets on zone change).
- `deno test` for the Edge Function (existing pattern —
  `ingest-lyft-screenshots/index.test.ts`), covering the saturation
  threshold branch and the fallback-zone query.
- Native plugin + MacroDroid changes: **on-device only**, no CI coverage
  possible. Document the manual verification steps (build APK, install,
  drive/simulate GPS into hero zone, confirm broadcast → capture → Maps
  auto-launch) in `docs/ingest-lyft-screenshots-macrodroid.md` §10 once
  implemented.
