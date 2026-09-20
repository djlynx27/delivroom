import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import type { Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

interface UserLocation {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  timestamp?: number;
}

export type UserLocationStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UserLocationResult {
  location: UserLocation | null;
  status: UserLocationStatus;
  error: string | null;
  refresh: () => Promise<UserLocation | null>;
}

function getGeolocationErrorMessage(error: unknown) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'Impossible de récupérer la position actuelle';
}

function normalizePosition(pos: Position | GeolocationPosition): UserLocation {
  // Capacitor Position vs Web GeolocationPosition
  const coords = pos.coords;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    heading: typeof coords.heading === 'number' ? coords.heading : null,
    speed: typeof coords.speed === 'number' ? coords.speed : null,
    accuracy: typeof coords.accuracy === 'number' ? coords.accuracy : null,
    timestamp: pos.timestamp,
  };
}

export async function requestCurrentPreciseLocation(
  options?: PositionOptions
): Promise<UserLocation> {
  if (Capacitor.isNativePlatform()) {
    try {
      const permissions = await Geolocation.checkPermissions();
      if (permissions.location !== 'granted') {
        const request = await Geolocation.requestPermissions();
        if (request.location !== 'granted') {
          throw new Error('Permission de localisation refusée');
        }
      }

      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        ...options,
      });
      return normalizePosition(pos);
    } catch (err) {
      throw new Error(getGeolocationErrorMessage(err));
    }
  }

  // Fallback to Web API
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(normalizePosition(pos)),
      (error) => reject(new Error(getGeolocationErrorMessage(error))),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
        ...options,
      }
    );
  });
}

// ── Shared GPS watcher ──────────────────────────────────────────────────
// Every screen used to call useUserLocation() independently, each starting
// its own native watchPosition — up to 4+ concurrent GPS watches running
// at once on a single screen (DriveScreen + NearestHotspot + ModeTaxi...),
// wasting battery and letting each component's `location` drift out of
// sync with the others'. One native watch, shared via useSyncExternalStore,
// refcounted so it stops when the last consumer unmounts.
interface SharedLocationState {
  location: UserLocation | null;
  status: UserLocationStatus;
  error: string | null;
}

let sharedState: SharedLocationState = { location: null, status: 'idle', error: null };
const sharedListeners = new Set<() => void>();
let sharedWatchId: string | number | null = null;
let sharedWatchStarting = false;
let subscriberCount = 0;
let lastUpdateAt = 0;
let latestLocation: UserLocation | null = null;

function notifySharedListeners() {
  for (const listener of sharedListeners) listener();
}

function applySharedLocation(nextLocation: UserLocation) {
  const now = Date.now();

  // Throttle updates to avoid UI flicker, but keep it responsive for driving
  if (now - lastUpdateAt < 1000 && lastUpdateAt !== 0) return;

  // Ensure we don't process stale updates
  if (
    latestLocation?.timestamp != null &&
    nextLocation.timestamp != null &&
    nextLocation.timestamp < latestLocation.timestamp
  ) {
    return;
  }

  lastUpdateAt = now;
  latestLocation = nextLocation;
  sharedState = { location: nextLocation, status: 'success', error: null };
  notifySharedListeners();
}

// Cold start: the very first fix of a session can accept Android's
// last-known FusedLocationProvider position instead of forcing a fresh GPS
// lock, so an approximate Hero Zone/location can render immediately. This
// never affects zone-matching accuracy — useHasPreciseFix's consecutive-
// sample hysteresis still gates the "nearest zone" pick, and the shared
// watchPosition (always enableHighAccuracy, no maximumAge) keeps refining
// right behind it.
const COLD_START_MAX_AGE_MS = 5 * 60 * 1000;

async function refreshSharedLocation(
  allowCached = false
): Promise<UserLocation | null> {
  sharedState = {
    ...sharedState,
    status: sharedState.status === 'success' ? sharedState.status : 'loading',
  };
  notifySharedListeners();

  try {
    const nextLocation = await requestCurrentPreciseLocation(
      allowCached ? { maximumAge: COLD_START_MAX_AGE_MS } : undefined
    );
    applySharedLocation(nextLocation);
    return nextLocation;
  } catch (err) {
    const message = getGeolocationErrorMessage(err);
    sharedState = {
      ...sharedState,
      status: latestLocation ? sharedState.status : 'error',
      error: message,
    };
    notifySharedListeners();
    return null;
  }
}

function startSharedWatch() {
  if (sharedWatchId !== null || sharedWatchStarting) return;
  sharedWatchStarting = true;

  void (async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        sharedWatchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true },
          (pos, err) => {
            if (err) {
              sharedState = { ...sharedState, error: getGeolocationErrorMessage(err) };
              notifySharedListeners();
            } else if (pos) {
              applySharedLocation(normalizePosition(pos));
            }
          }
        );
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        sharedWatchId = navigator.geolocation.watchPosition(
          (pos) => applySharedLocation(normalizePosition(pos)),
          (watchError) => {
            sharedState = { ...sharedState, error: getGeolocationErrorMessage(watchError) };
            notifySharedListeners();
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
      }
    } catch (err) {
      sharedState = { ...sharedState, error: getGeolocationErrorMessage(err) };
      notifySharedListeners();
    } finally {
      sharedWatchStarting = false;
      // Every subscriber unmounted while the native watch was still
      // resolving — stop it immediately instead of leaking GPS forever.
      if (subscriberCount === 0 && sharedWatchId !== null) {
        stopSharedWatch();
      }
    }
  })();
}

function stopSharedWatch() {
  if (sharedWatchId === null) return;
  if (Capacitor.isNativePlatform()) {
    void Geolocation.clearWatch({ id: sharedWatchId as string });
  } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(sharedWatchId as number);
  }
  sharedWatchId = null;
}

function subscribeToSharedLocation(listener: () => void): () => void {
  sharedListeners.add(listener);
  subscriberCount += 1;
  if (subscriberCount === 1) {
    void refreshSharedLocation(true);
    startSharedWatch();
  }
  return () => {
    sharedListeners.delete(listener);
    subscriberCount -= 1;
    if (subscriberCount === 0) {
      stopSharedWatch();
    }
  };
}

function getSharedLocationSnapshot(): SharedLocationState {
  return sharedState;
}

/** `intervalMs` is kept for call-site compatibility but no longer used — the
 * shared native watchPosition (see above) already pushes updates as the fix
 * changes, so a per-consumer polling interval on top of it was redundant. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useUserLocation(intervalMs = 10000): UserLocationResult {
  const state = useSyncExternalStore(subscribeToSharedLocation, getSharedLocationSnapshot);
  return {
    location: state.location,
    status: state.status,
    error: state.error,
    refresh: refreshSharedLocation,
  };
}

// Nearest-zone matching on a low-accuracy fix (a cold GPS lock, or a coarse
// network-based fallback before the chip acquires satellites) has picked the
// wrong zone across a city boundary — e.g. Station Longueuil instead of
// Montmorency while actually in Chomedey. 50m is tight enough to rule that
// out without stalling forever indoors, where accuracy may never improve.
export const MAX_ZONE_MATCH_ACCURACY_M = 50;

// A single precise-enough sample can still be a stale-but-accurate cached
// fix or a first GPS lock that's still refining (e.g. 45m, then 8m a moment
// later) — close enough to flip the "nearest zone" pick between two real
// neighbouring zones right after cold boot. Requiring 2 in a row before
// latching absorbs that refinement without stalling the UI meaningfully.
export const REQUIRED_CONSECUTIVE_PRECISE_SAMPLES = 2;

/** Whether a fix is trustworthy enough to drive a "nearest zone" match.
 * `accuracy` is the GPS API's 1-sigma radius in metres — null/undefined
 * (unsupported/unknown) is treated as imprecise, not as "trust it". */
export function isLocationPrecise(
  location: Pick<UserLocation, 'accuracy'> | null,
  maxAccuracyM = MAX_ZONE_MATCH_ACCURACY_M
): boolean {
  return location?.accuracy != null && location.accuracy <= maxAccuracyM;
}

/** Latches `true` once `location` has cleared the accuracy bar on
 * `REQUIRED_CONSECUTIVE_PRECISE_SAMPLES` consecutive samples, and stays
 * there — a single noisy or still-refining sample must not yank an
 * already-good "nearest zone" match away again. Callers that gate
 * zone-matching on GPS should hold off until this flips true. */
export function useHasPreciseFix(
  location: Pick<UserLocation, 'accuracy'> | null,
  maxAccuracyM = MAX_ZONE_MATCH_ACCURACY_M
): boolean {
  const [hasPreciseFix, setHasPreciseFix] = useState(false);
  const consecutivePreciseRef = useRef(0);

  useEffect(() => {
    if (hasPreciseFix) return;

    if (isLocationPrecise(location, maxAccuracyM)) {
      consecutivePreciseRef.current += 1;
      if (consecutivePreciseRef.current >= REQUIRED_CONSECUTIVE_PRECISE_SAMPLES) {
        setHasPreciseFix(true);
      }
    } else {
      consecutivePreciseRef.current = 0;
    }
  }, [location, maxAccuracyM, hasPreciseFix]);

  return hasPreciseFix;
}

/** Haversine distance in km */
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
