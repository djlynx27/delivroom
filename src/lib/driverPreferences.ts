export const DRIVER_MODE_KEY = 'geohustle_driver_mode';
export const CONSERVATIVE_PRESENCE_KEY = 'delivroom_conservative_presence';
export const DRIVER_FINGERPRINT_KEY = 'delivroom_driver_fingerprint';

function safeGetItem(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable; keep ephemeral state in memory only.
  }
}

export function getStoredDriverMode() {
  const saved = safeGetItem(DRIVER_MODE_KEY);
  return saved === 'rideshare' || saved === 'delivery' || saved === 'all'
    ? saved
    : 'all';
}

export function setStoredDriverMode(mode: 'rideshare' | 'delivery' | 'all') {
  safeSetItem(DRIVER_MODE_KEY, mode);
}

export function getConservativePresencePreference() {
  const saved = safeGetItem(CONSERVATIVE_PRESENCE_KEY);
  if (saved == null) return true;
  return saved !== 'false';
}

export function setConservativePresencePreference(value: boolean) {
  safeSetItem(CONSERVATIVE_PRESENCE_KEY, value ? 'true' : 'false');
}

export function getDriverFingerprint() {
  const existing = safeGetItem(DRIVER_FINGERPRINT_KEY);
  if (existing) return existing;

  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `driver-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

  safeSetItem(DRIVER_FINGERPRINT_KEY, generated);
  return generated;
}

// ── Family schedule constraints ───────────────────────────────────────────────

export const HOME_CONSTRAINTS_KEY = 'delivroom_home_constraints';

export interface HomeConstraintsSettings {
  enabled: boolean;
  homeLat: number;
  homeLng: number;
  homeAddress: string;
  momWorkLat: number;
  momWorkLng: number;
  momWorkAddress: string;
  momWorkName: string;
  /** HH:MM — earliest the driver must be home (e.g. "10:00") */
  returnHomeWindowStart: string;
  /** HH:MM — latest the driver must be home (e.g. "10:30") */
  returnHomeWindowEnd: string;
  /** HH:MM — when mom needs to be picked up (e.g. "17:00") */
  pickupTime: string;
}

const DEFAULT_HOME_CONSTRAINTS: HomeConstraintsSettings = {
  enabled: false,
  homeLat: 45.5543,
  homeLng: -73.7665,
  homeAddress: '555 rue Saint-Louis, Laval, H7V 0C5',
  momWorkLat: 45.5723,
  momWorkLng: -73.6591,
  momWorkAddress: '10495 Av. Georges-Baril, Montréal, QC H2C 2N1',
  momWorkName: 'École Saint-Paul-de-la-Croix',
  returnHomeWindowStart: '10:00',
  returnHomeWindowEnd: '10:30',
  pickupTime: '17:00',
};

export function getHomeConstraintsSettings(): HomeConstraintsSettings {
  try {
    const saved = safeGetItem(HOME_CONSTRAINTS_KEY);
    if (!saved) return { ...DEFAULT_HOME_CONSTRAINTS };
    return {
      ...DEFAULT_HOME_CONSTRAINTS,
      ...JSON.parse(saved),
    } as HomeConstraintsSettings;
  } catch {
    return { ...DEFAULT_HOME_CONSTRAINTS };
  }
}

export function setHomeConstraintsSettings(
  settings: HomeConstraintsSettings
): void {
  safeSetItem(HOME_CONSTRAINTS_KEY, JSON.stringify(settings));
}
