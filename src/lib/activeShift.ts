// The "active shift" session — distinct from the ride tally in shiftTracker.ts.
// This is the session the "Démarrer un shift" button and the GPS auto-shift
// both control, keyed in localStorage. A PWA can't read Lyft/Maxymo's online
// state (sandboxed), so the shift is started from proxy signals: GPS vehicle
// movement (useAutoShift) and in-app activity like analyzing a live ride
// screenshot (ScreenshotAnalyzer).

export const ACTIVE_SHIFT_KEY = 'delivroom_active_shift';
export const AUTO_SHIFT_ENABLED_KEY = 'delivroom_auto_shift_enabled';

export function isShiftActive(): boolean {
  try {
    return !!localStorage.getItem(ACTIVE_SHIFT_KEY);
  } catch {
    return false;
  }
}

export function readAutoShiftEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_SHIFT_ENABLED_KEY) !== 'false'; // default on
  } catch {
    return true;
  }
}

export function writeAutoShiftEnabled(val: boolean): void {
  try {
    localStorage.setItem(AUTO_SHIFT_ENABLED_KEY, val ? 'true' : 'false');
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Start the active shift if one isn't already running and auto-shift is enabled.
 * Dispatches 'delivroom:shift-changed' so the ShiftTracker UI reloads its state.
 * Returns true when a new shift was actually started.
 */
export function ensureShiftStarted(): boolean {
  if (!readAutoShiftEnabled() || isShiftActive()) return false;
  try {
    localStorage.setItem(
      ACTIVE_SHIFT_KEY,
      JSON.stringify({ startedAt: new Date().toISOString() })
    );
    window.dispatchEvent(new CustomEvent('delivroom:shift-changed'));
    return true;
  } catch {
    return false;
  }
}
