# Shift Tracker Background & Auto-Navigation — Design Spec

Status: approved by Oualid 2026-09-16, pending implementation plan.

## Problem

The zone-drift/repositioning logic (`useNotifications.ts`, "immobile 12 min"
effect, lines ~440-512) and the geolocation watcher (`useUserLocation.ts`)
both run as plain React `useEffect`/`setInterval` in the WebView. They stop
the instant the app isn't the foreground tab — which is most of a real
shift, since the driver constantly switches to Lyft, Uber, and Maxymo. There
is no persistent geofencing, no 15-minute arrival timer, and no way to
auto-surface a "move to X" suggestion while another app is on screen.

`@capacitor/background-runner` is already installed (used for the Maxymo
screenshot scanner) but is backed by Android WorkManager, which enforces a
15-minute minimum interval and offers no persistent foreground-service
notification — it cannot deliver a real-time ~100m geofence check or a
precise countdown.

## Goals

1. A 15-minute countdown starts the moment GPS shows the driver has entered
   a scored zone (nearest-zone match, same `MAX_GPS_ZONE_KM` sanity radius
   already used elsewhere), and survives the app being backgrounded or
   swiped from Recents.
2. If the driver is still in that same zone when the countdown hits zero,
   a persistent Android notification suggests the best nearby alternate
   zone, with a "GO →" action.
3. Tapping "GO →" opens Google Maps turn-by-turn navigation via the native
   `google.navigation:q=lat,lng` intent — not the web-URL maps link used
   elsewhere in the app.
4. The watcher starts/stops with the existing shift lifecycle
   (`useShift.ts` / `activeShift.ts`), not a new standalone toggle.
5. No duplicate/divergent logic: the existing foreground-only "immobile 12
   min" drift alert in `useNotifications.ts` is removed once this replaces
   it.

## Non-goals

- Fully silent/automatic Maps launch without a tap — rejected: Android 10+
  restricts background activity starts without recent user interaction,
  behavior would be unreliable across OEMs (confirmed decision, see
  conversation).
- iOS background behavior (Delivroom's native target is Android/Capacitor
  only per this repo's `android/` setup).
- Changing the existing web-URL-based notifications elsewhere in
  `useNotifications.ts` (demand spike, event, surge, weather) — those stay
  foreground-only as-is.

## Architecture

**Plugin: `@capacitor-community/background-geolocation`.** Rejected
`@capacitor/background-runner` (WorkManager 15-min floor, no persistent
foreground notification — wrong tool). This plugin runs a real Android
foreground service with a persistent notification ("Delivroom Shift
Tracker Actif") and keeps invoking its location callback even after the
app is removed from Recents.

## Components

1. **`src/lib/shiftGeoWatcher.ts`** (new)
   - `startShiftWatcher()` / `stopShiftWatcher()`, called when
     `useShift`/`activeShift.ts` transitions active/inactive.
   - On each location callback:
     - Nearest-zone match via a shared pure function extracted from the
       existing `findNearestZone` duplication in `useNotifications.ts`
       (moved to a non-React module so both foreground and the background
       isolate can import it without pulling in hooks).
     - `currentZoneId` + `zoneEnteredAt` persisted via
       `@capacitor/preferences` (already-installed-class primitive;
       `localStorage` isn't reachable from the plugin's background
       isolate). Zone change → reset timer.
     - At 15 minutes in the same zone (once per zone-stay): fetch a
       lightweight zone-scores snapshot via direct Supabase REST (not the
       heavy `useDemandScores` hook — too much weather/traffic/Realtime
       weight for a background isolate), pick the best nearby alternate,
       fire a `LocalNotifications.schedule` with a "GO →" action carrying
       `{ lat, lng }`.

2. **Notification tap handler** — app-level `localNotificationActionPerformed`
   listener (mounted once, e.g. in `App.tsx`) that opens
   `google.navigation:q=<lat>,<lng>` via `window.location.href` (native
   intent resolution on Android).

3. **Manifest**: add `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
   `FOREGROUND_SERVICE_LOCATION` (Android 14+ typed requirement) to
   `android/app/src/main/AndroidManifest.xml`, plus whatever the plugin's
   own manifest merge requires.

4. **Cleanup**: delete the "immobile 12 min" `useEffect` block in
   `useNotifications.ts` (~lines 440-512) and its now-unused state fields
   in `NotifState` (`stationarySince`, `stationaryLat`, `stationaryLng`,
   `lastDriftNotif`).

## Data flow

```
shift active (useShift/activeShift)
  → startShiftWatcher()
    → BackgroundGeolocation location callback (native foreground service)
      → nearest-zone match (shared pure fn)
      → Preferences: read/write { zoneId, zoneEnteredAt, notifiedForStay }
      → if 15min elapsed && !notifiedForStay:
          → Supabase REST: lightweight zone scores
          → pick best alternate zone
          → LocalNotifications.schedule (action: GO, extra: {lat,lng})
shift ends → stopShiftWatcher()

user taps "GO →" → app-level listener → google.navigation:q=lat,lng intent
```

## Error handling

- Background location permission denied → watcher no-ops silently;
  existing foreground-only notifications remain a fallback.
- Supabase REST fetch failure at the 15-min trigger → skip that cycle, no
  crash, timer state untouched (won't retry until next zone entry or a
  future callback re-checks — acceptable, matches existing best-effort
  patterns like `registerPushSubscription`).
- Preferences read failures → default to "no state", same defensive
  pattern already used for `localStorage` elsewhere in this codebase.

## Testing

- `tsc --noEmit`, `npm run lint`.
- Vitest unit test for the extracted pure nearest-zone/timer-state module
  (precedent: `shiftTracker.test.ts`).
- On-device only (ADB): build APK, install on S23 Ultra, start a shift,
  swipe Delivroom from Recents, verify the foreground notification
  persists and the 15-min/GO flow still fires with the app fully closed.
