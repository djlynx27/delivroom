// Pure logic for shift-tracker, split out of index.ts so it's testable with
// `deno test` without touching Supabase. Same split as event-sync/
// gtfs-alerts-sync's eventSync.ts/gtfsAlerts.ts.

// Haversine nearest-zone matching — duplicated rather than imported across
// the Node/Deno boundary, same rationale as gtfs-alerts-sync/gtfsAlerts.ts.
export type ZoneRow = { id: string; city_id: string; latitude: number; longitude: number };

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const MAX_ZONE_DISTANCE_M = 3000;

export function nearestZoneId(lat: number, lng: number, zones: readonly ZoneRow[]): string | null {
  let best: { id: string; distanceM: number } | null = null;
  for (const zone of zones) {
    const distanceM = haversineMeters(lat, lng, zone.latitude, zone.longitude);
    if (!best || distanceM < best.distanceM) best = { id: zone.id, distanceM };
  }
  return best && best.distanceM <= MAX_ZONE_DISTANCE_M ? best.id : null;
}

export const ACTIONS = ['START', 'STOP', 'HEARTBEAT', 'ADD_EARNINGS', 'STATUS'] as const;
export type ShiftAction = (typeof ACTIONS)[number];

export function isShiftAction(value: unknown): value is ShiftAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export function elapsedSeconds(startedAt: string, nowMs: number): number {
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) return 0;
  return Math.max(0, Math.round((nowMs - startedMs) / 1000));
}

/** Decides whether a heartbeat's resolved zone should open a new
 * session_zones entry (and close the previous one). Pure so the "only
 * transition on an actual zone change" rule is testable without a DB. */
export function resolveZoneTransition(
  currentZoneId: string | null,
  resolvedZoneId: string | null
): { changed: boolean; newZoneId: string | null } {
  if (resolvedZoneId === currentZoneId) return { changed: false, newZoneId: currentZoneId };
  return { changed: true, newZoneId: resolvedZoneId };
}

export interface HeartbeatPayload {
  lat?: number;
  lng?: number;
}

export function parseCoordinates(body: {
  lat?: unknown;
  lng?: unknown;
}): { lat: number; lng: number } | null {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function parseAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

// ── MacroDroid notification-text → action ────────────────────────────────────
// MacroDroid's natural trigger on Android is "Notification Received" on
// com.lyft.android.driver, and what it can forward is the notification's own
// text — not a normalized verb. Requiring the macro to send
// action: 'START' means hand-authoring one HTTP action per trigger and keeping
// the mapping in the macro (where it is invisible to this repo, untestable,
// and silently breaks when Lyft rewords a string). Accepting the raw text here
// instead keeps a single MacroDroid HTTP action —
//   { "event": "{notification_text}", "timestamp": "{system_time_iso}" }
// — and puts the wording-to-verb mapping under test in this file.
//
// Lyft Driver ships both locales on a QC device depending on the app language,
// so each pattern carries its FR wording too.

/** Why a shift ended, when the caller told us. Recorded on the session so a
 * 12h-limit cutoff is distinguishable from the driver simply going offline. */
export const STOP_REASONS = ['OFFLINE', 'HOURS_LIMIT'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface ResolvedAction {
  action: ShiftAction;
  /** Only meaningful for STOP. */
  stopReason?: StopReason;
}

// Order matters: the first match wins, and the 12h-limit wording is checked
// before the generic offline patterns because Lyft's own cutoff notification
// ("You've reached the 12-hour limit — you're now offline") contains both.
const EVENT_PATTERNS: readonly { pattern: RegExp; resolved: ResolvedAction }[] = [
  // "12-hour limit", "12 hour driving limit", "limite de 12 h", "limite de 12h"
  {
    pattern: /\b12\s*[-\s]?\s*(hour|heures?|h)\b|limite\s+de\s+12/i,
    resolved: { action: 'STOP', stopReason: 'HOURS_LIMIT' },
  },
  // Checked before /online/ so "You're offline" can't be read as online —
  // substring-wise it cannot, but "hors ligne" vs "en ligne" both contain
  // "ligne", so the FR pair genuinely needs the ordering.
  {
    pattern: /\boffline\b|hors\s+ligne|\bstopped\s+driving\b/i,
    resolved: { action: 'STOP', stopReason: 'OFFLINE' },
  },
  {
    pattern: /\bonline\b|en\s+ligne|\bstart(ed)?\s+driving\b/i,
    resolved: { action: 'START' },
  },
  // Lyft has no "heartbeat" notification; this covers a macro wired to a
  // periodic timer trigger posting its own keyword instead of a notification.
  { pattern: /\bheartbeat\b|\bping\b/i, resolved: { action: 'HEARTBEAT' } },
];

/**
 * Resolves the action for a request body that may carry either an explicit
 * `action` (the PWA, or a macro authored the verbose way) or a raw `event`
 * string lifted from an Android notification. An explicit action always wins
 * — never second-guess a caller that already said what it wants.
 *
 * Returns null when neither yields a known action, so the caller can answer
 * 400 rather than guessing (a silent default of START on an unrecognized
 * notification would open phantom shifts every time Lyft pushes a promo).
 */
export function resolveShiftAction(body: {
  action?: unknown;
  event?: unknown;
}): ResolvedAction | null {
  if (isShiftAction(body.action)) return { action: body.action };

  const text = typeof body.event === 'string' ? body.event : '';
  if (!text.trim()) return null;

  // A macro may also be wired to send the verb through `event` directly.
  const upper = text.trim().toUpperCase();
  if (isShiftAction(upper)) return { action: upper };

  for (const { pattern, resolved } of EVENT_PATTERNS) {
    if (pattern.test(text)) return resolved;
  }
  return null;
}
