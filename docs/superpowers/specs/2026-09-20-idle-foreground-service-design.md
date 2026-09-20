# Idle-Mode Foreground Service (Cold-Start Prevention) — Design Spec

Status: approved by Oualid 2026-09-20, proceeding directly to implementation
(user explicitly waived the separate spec-review gate for this one).

## Problem

`shiftGeoWatcher.ts` + `useShiftGeoWatcher.ts` already run a real Android
foreground service (via `@capacitor-community/background-geolocation`) that
survives backgrounding and Recents-swipe — but only while a shift is active
(`startShiftWatcher()`/`stopShiftWatcher()` gated on `serverActive ||
isShiftActive()`). Outside a shift, the app has no foreground service, so
Android One UI is free to kill the JS process whenever it wants, forcing a
full cold start (Supabase reconnect, GPS re-lock, score refetch) the next
time the driver opens Delivroom — even mid-day between two shifts.

Follows the cache-first cold-start work (`df76d3d`, `64e02b5`): those made a
cold start fast and safe, but don't stop cold starts from happening in the
first place while the app is open but idle.

## Goals

1. From app launch (not just shift start) until Android kills the process,
   a foreground service keeps the JS process alive, at a battery cost
   proportionate to being idle (no shift) vs. actively driving (shift).
2. Transition between idle and shift frequency is transparent to the driver
   — no flicker, no duplicate/orphaned notification, no gap where the
   service visibly stops.
3. Zero new native code, zero new AndroidManifest entries, zero new UI.
   Reuse the exact watcher/notification/state-machine code `shiftGeoWatcher`
   already has for the shift case.

## Non-goals

- An explicit "Quitter"/logout action to fully stop the service on demand —
  none exists in the app today (anonymous Supabase auth, no sign-out
  concept) and building one is out of scope here. The service stops only
  when Android kills the process (force-stop from Settings, or OS memory
  pressure) — the practical ceiling of what a JS-driven watcher can
  guarantee anyway.
- Any change to `evaluateZoneStay`/`evaluateCaptureTrigger`'s geofence
  logic, the MacroDroid broadcast, or local-notification content for the
  shift case — all unchanged.
- A second, independent low-power service module — rejected in favor of
  reusing the same watcher with a second config (see Approaches below).

## Approaches considered

| # | Approach | Verdict |
|---|---|---|
| A | One watcher active at a time (`idle` \| `shift`); `removeWatcher` + `addWatcher` on each transition | **Chosen** |
| B | Two concurrent watchers (idle always-added, shift added on top, neither ever removed) | Rejected — the native service has one fixed `NOTIFICATION_ID`; with 2 concurrent watchers, which one's notification text displays is non-deterministic (`HashSet` iteration in `BackgroundGeolocationService.java`). Real risk of the idle notification showing during an active shift. |
| C | Separate watcher/service module for idle mode, independent of `shiftGeoWatcher` | Rejected — duplicates the state machine, notification handling, and Preferences bookkeeping for no benefit over A. |

The plugin has no live-reconfigure API (`addWatcher`/`removeWatcher` only;
interval is hardcoded 1s server-side in `BackgroundGeolocationService.java`,
only `distanceFilter` is tunable from JS) — so a mode switch is necessarily
a `removeWatcher` + `addWatcher` pair. Because `NOTIFICATION_ID` is fixed,
this swaps the visible notification's text in place rather than visibly
tearing down and rebuilding the foreground service.

## Architecture

`shiftGeoWatcher.ts` gains a `WatcherMode = 'idle' | 'shift'` concept
alongside the existing `SHIFT_WATCHER_OPTIONS` (`distanceFilter: 30`,
unchanged):

```ts
const IDLE_WATCHER_OPTIONS: WatcherOptions = {
  distanceFilter: 250, // large enough to skip GPS noise while parked/idle
  backgroundTitle: 'Delivroom',
  backgroundMessage: 'Actif — en veille',
  requestPermissions: true,
};
```

`startShiftWatcher()`/`stopShiftWatcher()` are replaced by a single
`ensureWatcherMode(mode: WatcherMode)`:

- Reads the persisted current mode (`Preferences` key
  `delivroom_geo_watcher_mode`, alongside the existing
  `delivroom_shift_geo_watcher_id`).
- No-ops if the requested mode already matches the persisted mode **and**
  a watcher id is persisted (idempotent — avoids notification flicker on a
  redundant `sync()` call, e.g. two `'delivroom:shift-changed'` events in a
  row).
- Otherwise: if a watcher id is persisted, `removeWatcher({id})` first
  (defensive — also cleans up an orphaned watcher from a prior JS crash
  that never reached its own cleanup); then `addWatcher()` with the target
  mode's options; persist the new id and mode.
- Switching **into** `'idle'` does NOT clear `delivroom_shift_geo_state` /
  `delivroom_shift_geo_captured_zone` — those stay owned by the existing
  shift-active geofence logic and are only cleared when a shift genuinely
  ends (unchanged from today).

`useShiftGeoWatcher.ts`'s `sync()` changes from "start if shift active,
else no-op" to:

```ts
void ensureWatcherMode(serverActive || isShiftActive() ? 'shift' : 'idle');
```

Still invoked on hook mount and on every `'delivroom:shift-changed'` event —
no new trigger needed. `ShiftGeoWatcherMonitor`/`App.tsx` are untouched:
the hook is already mounted at the app root for the whole session
(`App.tsx:256`), so idle mode starts automatically from first launch.

## Data flow

1. App launches → `ShiftGeoWatcherMonitor` mounts → `useShiftGeoWatcher`'s
   `sync()` runs once → no shift active → `ensureWatcherMode('idle')` →
   foreground service starts with the idle notification.
2. Driver starts a shift → `'delivroom:shift-changed'` fires →
   `sync()` → `ensureWatcherMode('shift')` → `removeWatcher(idleId)` +
   `addWatcher(shiftConfig)` → same foreground service, notification text
   swaps, `distanceFilter` drops to 30m.
3. Shift ends → same event → `ensureWatcherMode('idle')` → swaps back.
4. App stays open with no shift for the rest of the day → service keeps
   running in idle mode → next app open (if the process ever did die) is
   the only remaining cold start, everything else is same-process.

## Error handling / edge cases

- Cold boot with a stale persisted id from a crashed previous session:
  `ensureWatcherMode` always attempts `removeWatcher` on any persisted id
  before adding, regardless of whether the mode is "changing" — a
  `removeWatcher` on an id the native side no longer recognizes is a no-op
  on the plugin side (matches today's existing defensive pattern in
  `stopShiftWatcher`).
- `addWatcher` throwing (permission revoked, plugin unavailable): caught,
  logged the same way `startShiftWatcher` already does today — idle mode
  simply doesn't start; app functions normally, just without the
  cold-start protection (same degraded-but-functional behavior as today
  when a shift's watcher fails to start).
- Off-native (web dev server): `ensureWatcherMode` no-ops entirely, same
  guard `shiftGeoWatcher.ts` already has for `Capacitor.isNativePlatform()`.

## Testing

Unit test on the pure mode-decision logic (`serverActive`/`isShiftActive()`
→ `'idle' | 'shift'`) and on `ensureWatcherMode`'s idempotency/reconciliation
branches, using a mocked `BackgroundGeolocation` plugin — same style as
`useNavTrustState.test.ts`. No integration test against the real native
plugin (not runnable in Vitest).

## Diff estimate

2 files modified (`src/lib/shiftGeoWatcher.ts`,
`src/hooks/useShiftGeoWatcher.ts`), 1 new test file. No AndroidManifest
change, no new native code, no `App.tsx` change. ~60-90 lines.
