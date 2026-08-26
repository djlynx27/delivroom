// The "active shift" session — distinct from the ride tally in shiftTracker.ts.
// This is the session the "Démarrer un shift" button and the GPS auto-shift
// both control, keyed in localStorage. A PWA can't read Lyft/Maxymo's online
// state (sandboxed), so the shift is started from proxy signals: GPS vehicle
// movement (useAutoShift) and in-app activity like analyzing a live ride
// screenshot (ScreenshotAnalyzer).

export const ACTIVE_SHIFT_KEY = 'delivroom_active_shift';
export const AUTO_SHIFT_ENABLED_KEY = 'delivroom_auto_shift_enabled';

// No real taxi/rideshare shift runs this long. If the auto-end suggestion
// was missed (app backgrounded, toast dismissed), a shift can otherwise sit
// "active" in localStorage forever and blow up every $/h and elapsed-time
// estimate that reads it (e.g. "5000h en cours").
const MAX_SHIFT_HOURS = 16;

/**
 * Reads the active shift, clearing it out first if it's older than
 * MAX_SHIFT_HOURS. This is the single choke point every caller (ShiftTracker,
 * useAutoShift, isShiftActive) should go through instead of reading
 * ACTIVE_SHIFT_KEY directly, so a stale shift can't leak into any of them.
 */
export function readActiveShift(): { startedAt: string } | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SHIFT_KEY);
    if (!raw) return null;
    const shift = JSON.parse(raw) as { startedAt: string };
    const startedMs = new Date(shift.startedAt).getTime();
    if (!Number.isFinite(startedMs)) {
      localStorage.removeItem(ACTIVE_SHIFT_KEY);
      return null;
    }
    const hoursElapsed = (Date.now() - startedMs) / 3_600_000;
    if (hoursElapsed > MAX_SHIFT_HOURS) {
      localStorage.removeItem(ACTIVE_SHIFT_KEY);
      return null;
    }
    return shift;
  } catch {
    return null;
  }
}

export function isShiftActive(): boolean {
  return readActiveShift() !== null;
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
