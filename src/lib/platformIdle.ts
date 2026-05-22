// Per-platform "time since last ride" tracker, used to suggest switching
// apps when one goes quiet.
//
// State lives in localStorage rather than Supabase because:
// - It's purely device-local (no value sharing across devices/users)
// - We need synchronous reads on every render of the banner widget
// - Trivial to reset when the driver explicitly logs off
//
// The "online" flag is what the user explicitly toggles. We DON'T try to
// detect whether the Lyft Driver app is actually running — that would
// require platform-specific accessibility hooks and is out of scope.

const KEY = 'delivroom-platform-idle';

export type Platform = 'lyft' | 'uber' | 'hypra' | 'imoove' | 'doordash' | 'ubereats' | 'skip';

export interface PlatformState {
  online: boolean;
  lastRideAt: number | null;  // epoch ms
  onlineSince: number | null; // epoch ms
}

export type IdleMap = Partial<Record<Platform, PlatformState>>;

export function loadIdleMap(): IdleMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as IdleMap) : {};
  } catch {
    return {};
  }
}

export function saveIdleMap(map: IdleMap): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function setPlatformOnline(platform: Platform, online: boolean): IdleMap {
  const map = loadIdleMap();
  const existing = map[platform] ?? { online: false, lastRideAt: null, onlineSince: null };
  map[platform] = {
    online,
    lastRideAt: existing.lastRideAt,
    onlineSince: online ? Date.now() : null,
  };
  saveIdleMap(map);
  return map;
}

export function markRide(platform: Platform): IdleMap {
  const map = loadIdleMap();
  const existing = map[platform] ?? { online: true, lastRideAt: null, onlineSince: Date.now() };
  map[platform] = { ...existing, lastRideAt: Date.now() };
  saveIdleMap(map);
  return map;
}

/**
 * Idle time in MINUTES for a given platform. Uses lastRideAt if available,
 * otherwise the onlineSince timestamp. Returns null when the platform is
 * offline or has no timestamp at all.
 */
export function idleMinutes(state: PlatformState | undefined, now = Date.now()): number | null {
  if (!state?.online) return null;
  const anchor = state.lastRideAt ?? state.onlineSince;
  if (!anchor) return null;
  return Math.floor((now - anchor) / 60_000);
}

/**
 * Idle threshold (minutes) past which the UI banner starts suggesting a
 * switch. 5 min is the practical inflection: shorter is normal between-ride
 * dead time, longer hints something is off (you're in the wrong zone, the
 * platform is dry tonight, the queue ahead of you is long).
 */
export const IDLE_BANNER_THRESHOLD_MIN = 5;
