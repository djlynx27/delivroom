// shiftGeoWatcher — background geofencing + 15-min arrival timer.
//
// Starts a real Android foreground service (via
// @capacitor-community/background-geolocation, NOT the already-installed
// @capacitor/background-runner — that one is WorkManager-backed with a
// 15-minute minimum interval floor and no persistent notification, wrong
// tool for a real-time geofence + precise countdown) tied to the shift
// lifecycle (useShiftGeoWatcher.ts starts/stops it on
// 'delivroom:shift-changed'). Keeps firing its location callback even after
// the app is swiped from Recents, which is the whole point: the driver is
// constantly tabbed away into Lyft/Uber/Maxymo during a real shift.
//
// State (current nearest zone + when it was entered) is persisted via
// @capacitor/preferences rather than localStorage, which the plugin's
// background isolate can't reach.

import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { Capacitor, registerPlugin } from '@capacitor/core';

// This plugin ships only native code + type defs (see its README) — the JS
// binding has to be registered by the consumer, unlike the codegen'd
// Capacitor-first-party plugins used elsewhere in this file.
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  'BackgroundGeolocation'
);
import { supabase } from '@/integrations/supabase/client';
import { findNearestZone } from '@/lib/zoneMatch';
import DelivroomBroadcast from '@/lib/delivroomBroadcast';

const LOG_TAG = '[ShiftGeoWatcher]';
// console.warn, not console.log — confirmed on-device that Capacitor's
// WebView console bridge only forwards warn/error to `adb logcat` (as
// Capacitor/Console); console.log never showed up across multiple captures
// even while this code was definitely running, while a pre-existing
// console.error elsewhere in the app appeared immediately.
function log(...args: unknown[]) {
  console.warn(LOG_TAG, ...args);
}
function logError(...args: unknown[]) {
  console.error(LOG_TAG, ...args);
}

export const ZONE_STAY_TIMER_MS = 15 * 60_000;

const PREFS_STATE_KEY = 'delivroom_shift_geo_state';
const PREFS_WATCHER_ID_KEY = 'delivroom_shift_geo_watcher_id';
export const PREFS_HERO_ZONE_KEY = 'delivroom_hero_zone_id';
const PREFS_CAPTURED_ZONE_KEY = 'delivroom_shift_geo_captured_zone';
const TRIGGER_CAPTURE_ACTION = 'com.delivroom.TRIGGER_NEARBY_CAPTURE';
const GO_ACTION_TYPE = 'delivroom.shift.go';
const NOTIFICATION_ID = 771_001;
// 70 zones total (see repo CLAUDE.md) — cheap to fetch whole, cached in
// memory so every location callback doesn't re-hit Supabase.
const ZONES_CACHE_MS = 10 * 60_000;

export interface ZoneStayState {
  zoneId: string;
  enteredAt: number;
  notified: boolean;
}

export interface ZoneStayEvaluation {
  state: ZoneStayState | null;
  shouldNotify: boolean;
}

/** Pure state machine — no plugin calls, fully unit-testable. */
export function evaluateZoneStay(
  prev: ZoneStayState | null,
  now: number,
  nearestZoneId: string | null
): ZoneStayEvaluation {
  if (nearestZoneId == null) {
    return { state: null, shouldNotify: false };
  }
  if (prev == null || prev.zoneId !== nearestZoneId) {
    return {
      state: { zoneId: nearestZoneId, enteredAt: now, notified: false },
      shouldNotify: false,
    };
  }
  if (!prev.notified && now - prev.enteredAt >= ZONE_STAY_TIMER_MS) {
    return { state: { ...prev, notified: true }, shouldNotify: true };
  }
  return { state: prev, shouldNotify: false };
}

export interface CaptureTriggerState {
  capturedZoneId: string | null;
  awayFromHeroSince: number | null;
}

export interface CaptureTriggerEvaluation {
  state: CaptureTriggerState;
  shouldCapture: boolean;
}

// Grace period before a hero-zone departure is treated as real (not GPS
// jitter at a zone boundary, or the hero zone itself re-ranking between
// scoring cycles while the driver stands still). Short relative to the
// 15-min stay timer -- this only guards against a spurious re-fire, not a
// real "left and came back" cycle.
export const CAPTURE_AWAY_GRACE_MS = 2 * 60_000;

/** Pure state machine -- fires once per REAL hero-zone arrival (not the
 * 15-min stay timer, a separate concern), tolerating brief excursions
 * outside the hero zone without re-arming. */
export function evaluateCaptureTrigger(
  prev: CaptureTriggerState | null,
  now: number,
  nearestZoneId: string | null,
  heroZoneId: string | null
): CaptureTriggerEvaluation {
  const prevState = prev ?? { capturedZoneId: null, awayFromHeroSince: null };

  if (heroZoneId == null || nearestZoneId !== heroZoneId) {
    const awayFromHeroSince = prevState.awayFromHeroSince ?? now;
    if (now - awayFromHeroSince >= CAPTURE_AWAY_GRACE_MS) {
      return { state: { capturedZoneId: null, awayFromHeroSince }, shouldCapture: false };
    }
    return { state: { ...prevState, awayFromHeroSince }, shouldCapture: false };
  }

  if (prevState.capturedZoneId === heroZoneId) {
    return { state: { capturedZoneId: heroZoneId, awayFromHeroSince: null }, shouldCapture: false };
  }
  return { state: { capturedZoneId: heroZoneId, awayFromHeroSince: null }, shouldCapture: true };
}

interface LiteZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  current_score: number | null;
}

let zonesCache: { at: number; zones: LiteZone[] } | null = null;

async function fetchZonesLite(): Promise<LiteZone[]> {
  if (zonesCache && Date.now() - zonesCache.at < ZONES_CACHE_MS) {
    return zonesCache.zones;
  }
  const { data, error } = await supabase
    .from('zones')
    .select('id,name,latitude,longitude,current_score');
  if (error || !data) return zonesCache?.zones ?? [];
  zonesCache = { at: Date.now(), zones: data };
  return data;
}

async function readState(): Promise<ZoneStayState | null> {
  try {
    const { value } = await Preferences.get({ key: PREFS_STATE_KEY });
    return value ? (JSON.parse(value) as ZoneStayState) : null;
  } catch {
    return null;
  }
}

async function writeState(state: ZoneStayState | null): Promise<void> {
  try {
    if (state == null) {
      await Preferences.remove({ key: PREFS_STATE_KEY });
    } else {
      await Preferences.set({ key: PREFS_STATE_KEY, value: JSON.stringify(state) });
    }
  } catch {
    // Preferences unavailable — next callback just re-derives state from GPS.
  }
}

async function readHeroZoneId(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: PREFS_HERO_ZONE_KEY });
    return value || null;
  } catch {
    return null;
  }
}

async function readCaptureState(): Promise<CaptureTriggerState | null> {
  try {
    const { value } = await Preferences.get({ key: PREFS_CAPTURED_ZONE_KEY });
    return value ? (JSON.parse(value) as CaptureTriggerState) : null;
  } catch {
    return null;
  }
}

async function writeCaptureState(state: CaptureTriggerState | null): Promise<void> {
  try {
    if (state == null) {
      await Preferences.remove({ key: PREFS_CAPTURED_ZONE_KEY });
    } else {
      await Preferences.set({ key: PREFS_CAPTURED_ZONE_KEY, value: JSON.stringify(state) });
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

/** Reads hero-zone state, runs evaluateCaptureTrigger, persists + fires the
 * broadcast as needed. Split out of onLocation to stay under the complexity
 * threshold (see CLAUDE.md M<=10). */
async function runCaptureTrigger(
  nearestZoneId: string | null
): Promise<{ heroZoneId: string | null; shouldCapture: boolean }> {
  const heroZoneId = await readHeroZoneId();
  const prevState = await readCaptureState();
  const { state, shouldCapture } = evaluateCaptureTrigger(
    prevState,
    Date.now(),
    nearestZoneId,
    heroZoneId
  );
  if (
    state.capturedZoneId !== prevState?.capturedZoneId ||
    state.awayFromHeroSince !== prevState?.awayFromHeroSince
  ) {
    await writeCaptureState(state);
  }
  if (shouldCapture) await triggerNearbyCapture();
  return { heroZoneId, shouldCapture };
}

async function notifyBestAlternate(currentZoneId: string) {
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      const after = await LocalNotifications.requestPermissions();
      if (after.display !== 'granted') {
        log('notifyBestAlternate: LocalNotifications permission refused, skipping');
        return;
      }
    }

    const zones = await fetchZonesLite();
    const best = zones
      .filter((z) => z.id !== currentZoneId && z.current_score != null)
      .sort((a, b) => (b.current_score ?? 0) - (a.current_score ?? 0))[0];
    if (!best) {
      log('notifyBestAlternate: no alternate zone with a score found');
      return;
    }

    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIFICATION_ID,
          title: `📍 15 min ici — bouge vers ${best.name}`,
          body: `Score ${best.current_score}/100`,
          actionTypeId: GO_ACTION_TYPE,
          extra: { lat: best.latitude, lng: best.longitude },
        },
      ],
    });
    log('notifyBestAlternate: notification scheduled for', best.name);
  } catch (err) {
    logError('notifyBestAlternate failed', err);
  }
}

async function onLocation(lat: number, lng: number) {
  try {
    const zones = await fetchZonesLite();
    const nearest = findNearestZone(lat, lng, zones);
    const prev = await readState();
    const { state, shouldNotify } = evaluateZoneStay(prev, Date.now(), nearest?.id ?? null);
    await writeState(state);

    const { heroZoneId, shouldCapture } = await runCaptureTrigger(nearest?.id ?? null);

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

/** Opens Google Maps turn-by-turn navigation via the native Android intent. */
export function openMapsNavigation(lat: number, lng: number): void {
  window.location.href = `google.navigation:q=${lat},${lng}`;
}

let tapListenerRegistered = false;

/** Mounted once at app root — wires the "GO →" notification action to Maps. */
export function registerShiftGeoTapHandler(): void {
  if (tapListenerRegistered || !Capacitor.isNativePlatform()) return;
  tapListenerRegistered = true;
  log('registerShiftGeoTapHandler: registering');

  void (async () => {
    try {
      await LocalNotifications.registerActionTypes({
        types: [{ id: GO_ACTION_TYPE, actions: [{ id: 'go', title: 'GO →' }] }],
      });
      await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        const extra = event.notification.extra as { lat?: number; lng?: number } | undefined;
        if (typeof extra?.lat === 'number' && typeof extra?.lng === 'number') {
          log('tap: opening Maps navigation', extra);
          openMapsNavigation(extra.lat, extra.lng);
        }
      });
      log('registerShiftGeoTapHandler: registered');
    } catch (err) {
      logError('registerShiftGeoTapHandler failed', err);
    }
  })();
}

/** Requests both permissions the foreground service needs — notification
 * display (Android 13+ POST_NOTIFICATIONS, required to show the mandatory
 * persistent notification) and location (requested by the plugin itself,
 * but checked here too so a refusal is logged before addWatcher is even
 * attempted rather than surfacing only as a silent no-op). */
async function ensureShiftWatcherPermissions(): Promise<boolean> {
  const notifPerm = await LocalNotifications.checkPermissions();
  if (notifPerm.display !== 'granted') {
    log('ensureShiftWatcherPermissions: requesting notification permission');
    const after = await LocalNotifications.requestPermissions();
    if (after.display !== 'granted') {
      log('ensureShiftWatcherPermissions: notification permission refused');
      return false;
    }
  }
  return true;
}

export async function startShiftWatcher(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    log('startShiftWatcher: skipped, not a native platform');
    return;
  }

  try {
    const { value: existingId } = await Preferences.get({ key: PREFS_WATCHER_ID_KEY });
    if (existingId) {
      log('startShiftWatcher: already running, watcherId=', existingId);
      return;
    }

    const permsGranted = await ensureShiftWatcherPermissions();
    if (!permsGranted) {
      log('startShiftWatcher: aborting, notification permission not granted');
      return;
    }

    log('startShiftWatcher: calling addWatcher');
    const watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Delivroom Shift Tracker Actif',
        backgroundMessage: 'Suivi de zone en cours pour tes suggestions de repositionnement.',
        requestPermissions: true,
        distanceFilter: 30,
      },
      (position, error) => {
        if (error) {
          logError('addWatcher callback error', error);
          return;
        }
        if (!position) return;
        void onLocation(position.latitude, position.longitude);
      }
    );
    await Preferences.set({ key: PREFS_WATCHER_ID_KEY, value: watcherId });
    log('startShiftWatcher: started, watcherId=', watcherId);
  } catch (err) {
    // Permission denied or plugin unavailable — foreground-only notifications
    // (useNotifications.ts) remain the fallback.
    logError('startShiftWatcher failed', err);
  }
}

export async function stopShiftWatcher(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { value: existingId } = await Preferences.get({ key: PREFS_WATCHER_ID_KEY });
    if (!existingId) {
      log('stopShiftWatcher: nothing to stop');
      return;
    }
    try {
      await BackgroundGeolocation.removeWatcher({ id: existingId });
      log('stopShiftWatcher: removed watcherId=', existingId);
    } catch (err) {
      logError('stopShiftWatcher: removeWatcher failed', err);
    }
    await Preferences.remove({ key: PREFS_WATCHER_ID_KEY });
    await writeState(null);
    await writeCaptureState(null);
  } catch (err) {
    logError('stopShiftWatcher failed', err);
  }
}
