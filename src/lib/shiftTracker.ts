// Local shift tally — counts rides the driver has logged TODAY from the
// quick widget and the screenshot flow, plus a running $/h based ENTIRELY
// on actual fare values (no Lyft theoretical estimate involved).
//
// Stored in localStorage rather than Supabase because:
// - Shift "today" semantics are device-local (you might be using Delivroom
//   on a phone in your pocket, not on multiple devices).
// - We need sub-second reads on every render of the DriveScreen tally.
// - Easy to reset at shift end (or auto-roll at midnight).

const KEY = 'delivroom-shift-tally';

export interface ShiftRide {
  ts: number;          // epoch ms
  fare: number;        // CAD
  rideKm: number | null;
  rideMin: number | null;
  platform: string;    // 'lyft' | 'uber' | etc.
}

export interface ShiftTally {
  startedAt: number;
  rides: ShiftRide[];
}

function todayBucket(): string {
  // 4 AM cutoff so a night shift that crosses midnight stays "today"
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(4, 0, 0, 0);
  const anchor = now < cutoff ? new Date(now.getTime() - 86_400_000) : now;
  return anchor.toISOString().slice(0, 10);
}

export function loadShift(): ShiftTally {
  if (typeof localStorage === 'undefined') return { startedAt: Date.now(), rides: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { startedAt: Date.now(), rides: [] };
    const parsed = JSON.parse(raw) as { date: string; data: ShiftTally };
    if (parsed.date !== todayBucket()) {
      // Roll over a new shift bucket
      return { startedAt: Date.now(), rides: [] };
    }
    return parsed.data;
  } catch {
    return { startedAt: Date.now(), rides: [] };
  }
}

export function saveShift(tally: ShiftTally): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(
    KEY,
    JSON.stringify({ date: todayBucket(), data: tally }),
  );
}

export function recordRide(ride: Omit<ShiftRide, 'ts'>): ShiftTally {
  const tally = loadShift();
  tally.rides.push({ ts: Date.now(), ...ride });
  if (!tally.startedAt) tally.startedAt = tally.rides[0].ts;
  saveShift(tally);
  return tally;
}

export function resetShift(): ShiftTally {
  const fresh = { startedAt: Date.now(), rides: [] };
  saveShift(fresh);
  return fresh;
}

export interface ShiftStats {
  rideCount: number;
  totalFare: number;
  totalKm: number;
  totalMin: number;
  /** Active hours = sum of ride minutes / 60. Excludes dead time. */
  activeHours: number;
  /** Wall hours = shift duration since startedAt. Includes dead time. */
  wallHours: number;
  /** $/h based on ACTUAL fares + wall time (= the true hourly rate). */
  trueHourlyRate: number | null;
  /** $/h based on ACTUAL fares + active time only. */
  activeHourlyRate: number | null;
  /** $/km based on ACTUAL fares + total km driven. */
  dollarsPerKm: number | null;
}

export function computeStats(tally: ShiftTally, now = Date.now()): ShiftStats {
  const rides = tally.rides;
  if (rides.length === 0) {
    return {
      rideCount: 0,
      totalFare: 0,
      totalKm: 0,
      totalMin: 0,
      activeHours: 0,
      wallHours: 0,
      trueHourlyRate: null,
      activeHourlyRate: null,
      dollarsPerKm: null,
    };
  }

  const totalFare = rides.reduce((sum, r) => sum + r.fare, 0);
  const totalKm = rides.reduce((sum, r) => sum + (r.rideKm ?? 0), 0);
  const totalMin = rides.reduce((sum, r) => sum + (r.rideMin ?? 0), 0);
  const activeHours = totalMin / 60;
  const wallHours = (now - tally.startedAt) / 3_600_000;
  return {
    rideCount: rides.length,
    totalFare,
    totalKm,
    totalMin,
    activeHours,
    wallHours,
    trueHourlyRate: wallHours > 0.05 ? totalFare / wallHours : null,
    activeHourlyRate: activeHours > 0.05 ? totalFare / activeHours : null,
    dollarsPerKm: totalKm > 0 ? totalFare / totalKm : null,
  };
}
