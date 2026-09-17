// Pure, side-effect-free logic for ingest-lyft-screenshots — split out from
// index.ts so it can be unit-tested (deno test) without triggering index.ts's
// module-level serve() call, which binds a listener on import.

import { decode as decodeImage, Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

// Row-major 3x3 density grid over the visible map: [TL, TC, TR, ML, C, MR, BL, BC, BR].
// Used by src/lib/spotter.ts (a separate, client-side module -- this Deno
// function and the Vite app don't share a module graph) to steer the driver
// toward whichever cell has the fewest rival cars.
export type DriverGrid = number[];
export const DRIVER_GRID_SIZE = 9;

export interface LyftSnapshot {
  // Optional: absent in nearby-only captures (Wait Times / Recent Demand
  // are deliberately no longer scraped -- see index.ts's optionalSlots).
  demand_score?: number;
  wait_time_min?: number;
  nearby_drivers_count: number;
  // Optional: only nearby-only captures ask Gemini for spatial distribution
  // (see index.ts's prompt) -- absent if Gemini omits/malforms it, since a
  // missing grid shouldn't fail the whole snapshot.
  nearby_drivers_grid?: DriverGrid;
}

/**
 * Validates a Gemini-extracted grid: must be an array of exactly
 * DRIVER_GRID_SIZE non-negative finite numbers. Returns null (not a
 * best-effort fallback like clampNumber) because a malformed grid has no
 * safe default -- the caller should just treat spatial data as unavailable.
 */
function parseDriverGrid(value: unknown): DriverGrid | null {
  if (!Array.isArray(value) || value.length !== DRIVER_GRID_SIZE) return null;
  const grid = value.map((v) => Number(v));
  if (grid.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return grid;
}

/** Clamps a Gemini-extracted numeric field into a sane, finite range. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validates and clamps the raw Gemini JSON into a safe LyftSnapshot — a
 * hallucinated demand_score of 47 or a negative wait time must never reach
 * platform_signals (demand_level has a DB-level 0-10 CHECK anyway, but
 * failing closer to the source gives a clearer error).
 */
export function parseLyftSnapshot(raw: unknown): LyftSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (
    obj.demand_score === undefined ||
    obj.wait_time_min === undefined ||
    obj.nearby_drivers_count === undefined
  ) {
    return null;
  }
  return {
    demand_score: clampNumber(obj.demand_score, 1, 10, 5),
    wait_time_min: clampNumber(obj.wait_time_min, 0, 120, 5),
    nearby_drivers_count: Math.round(clampNumber(obj.nearby_drivers_count, 0, 200, 0)),
  };
}

/** Same validation as parseLyftSnapshot, minus the demand/wait fields --
 * used when only the Nearby Drivers screenshot was captured. */
export function parseNearbyOnlySnapshot(raw: unknown): LyftSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.nearby_drivers_count === undefined) return null;
  const grid = parseDriverGrid(obj.nearby_drivers_grid);
  return {
    nearby_drivers_count: Math.round(clampNumber(obj.nearby_drivers_count, 0, 200, 0)),
    ...(grid && { nearby_drivers_grid: grid }),
  };
}

export interface DecodedImage {
  bytes: Uint8Array;
  mimeType: string;
}

const DATA_URI_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s;

/**
 * Decodes a raw base64 string or a data:image/...;base64,... URI --
 * MacroDroid's HTTP Request action can attach a file as either.
 */
export function decodeBase64Image(input: string): DecodedImage | null {
  try {
    const match = input.match(DATA_URI_RE);
    const mimeType = match ? match[1] : 'image/jpeg';
    const raw = match ? match[2] : input;
    const binary = atob(raw.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, mimeType };
  } catch {
    return null;
  }
}

// Gemini bills images by 768x768 tile regardless of how much detail is in
// each tile — a full S23 Ultra screenshot (1080x2316+) burns several tiles'
// worth of tokens to count car icons, a task that doesn't need native
// resolution. Downscaling to this cap before sending is a pure cost
// optimization: same signal in, far fewer tokens billed (see cost incident
// 2026-09-04, docs/ingest-lyft-screenshots-macrodroid.md §"Coût Gemini").
export const GEMINI_MAX_DIMENSION = 1024;
const GEMINI_JPEG_QUALITY = 80;

// Bound placed BEFORE the expensive operation (image decode), not after --
// imagescript's decoder allocates a full pixel buffer for whatever
// width x height the file's header claims, so a small, malformed/crafted
// file can still demand an enormous allocation (decompression-bomb style)
// before resize() ever gets a chance to shrink it back down. Checking the
// *compressed* byte size first is a cheap, if imperfect, guard: it can't
// catch a small file with a huge declared resolution, but it stops the
// common case (an oversized/corrupt upload) from reaching the decoder at
// all. A real screenshot is a few hundred KB; this leaves generous room
// above that without inviting worst-case decode cost on every request.
const MAX_INPUT_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Downscales an image so its longer side is at most GEMINI_MAX_DIMENSION,
 * re-encoded as JPEG to shrink bytes further. No-ops (returns the original)
 * if the image is already small enough, oversized, or fails to decode — a
 * corrupt/odd screenshot should still reach Gemini at full size rather than
 * be dropped.
 */
export async function resizeForGemini(image: DecodedImage): Promise<DecodedImage> {
  if (image.bytes.length > MAX_INPUT_BYTES) return image;
  try {
    const decoded = await decodeImage(image.bytes);
    // decodeImage can return a GIF's FrameCollection; screenshots are never
    // animated, so only a single Image is a shape this function handles.
    if (!(decoded instanceof Image)) return image;
    const longSide = Math.max(decoded.width, decoded.height);
    if (longSide <= GEMINI_MAX_DIMENSION) return image;

    const scale = GEMINI_MAX_DIMENSION / longSide;
    decoded.resize(Math.round(decoded.width * scale), Math.round(decoded.height * scale));
    const bytes = await decoded.encodeJPEG(GEMINI_JPEG_QUALITY);
    return { bytes, mimeType: 'image/jpeg' };
  } catch (err) {
    console.error('resizeForGemini: falling back to original image', err);
    return image;
  }
}

/**
 * SHA-256 hash of the 3 screenshots' combined bytes — lets the caller detect
 * a MacroDroid retry re-sending byte-identical images and skip the Gemini
 * call instead of re-billing it for the same content.
 */
export async function hashImages(images: DecodedImage[]): Promise<string> {
  const totalLength = images.reduce((sum, img) => sum + img.bytes.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const img of images) {
    combined.set(img.bytes, offset);
    offset += img.bytes.length;
  }
  const digest = await crypto.subtle.digest('SHA-256', combined);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ── Emerging hotspot detection ────────────────────────────────────────────
// A screenshot's demand heatmap has no GPS/zoom reference baked in, so we
// can't geocode individual purple dots. What we DO have is the driver's own
// GPS at capture time plus the vision-extracted demand score: if the driver
// is meaningfully far from every known zone AND demand there reads high,
// that position itself is worth surfacing as a candidate new zone — logged
// into the existing zone_discoveries table (same one analyze-screenshot
// already feeds for pickup/dropoff addresses) rather than a new table.
export const EMERGING_HOTSPOT_DISTANCE_KM = 1.5;
export const EMERGING_HOTSPOT_MIN_DEMAND = 7;

export function shouldFlagEmergingHotspot(
  distanceToNearestZoneKm: number | null,
  demandScore: number
): boolean {
  if (distanceToNearestZoneKm === null) return false;
  return (
    distanceToNearestZoneKm >= EMERGING_HOTSPOT_DISTANCE_KM &&
    demandScore >= EMERGING_HOTSPOT_MIN_DEMAND
  );
}

/** Stable, dedup-friendly label for a GPS position with no matched address —
 * 4 decimal places (~11 m) so repeat detections at the same spot collapse
 * into the same zone_discoveries row via its (lower(address), context) index. */
export function formatGpsAddress(lat: number, lng: number): string {
  return `GPS ${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// ── Micro-spot / saturation fallback ────────────────────────────────────
// Duplicated from src/lib/spotter.ts, not imported -- this Deno function
// and the Vite app don't share a module graph (see the DriverGrid comment
// above). Computed server-side so the recommendation reaches the driver
// without Delivroom ever being foregrounded -- see
// docs/superpowers/specs/2026-09-17-nearby-drivers-geofence-autonav-design.md.

export type Quadrant =
  | 'top_left' | 'top_center' | 'top_right'
  | 'middle_left' | 'center' | 'middle_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right';

const QUADRANT_LABELS: Quadrant[] = [
  'top_left', 'top_center', 'top_right',
  'middle_left', 'center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
];

const QUADRANT_BEARING_DEG: Record<Quadrant, number | null> = {
  top_left: 315,
  top_center: 0,
  top_right: 45,
  middle_left: 270,
  center: null,
  middle_right: 90,
  bottom_left: 225,
  bottom_center: 180,
  bottom_right: 135,
};

export const MIN_SPOT_OFFSET_METERS = 50;
export const MAX_SPOT_OFFSET_METERS = 150;
const DEFAULT_SPOT_OFFSET_METERS = 100;
const EARTH_RADIUS_METERS = 6_371_000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Row-major (matches the Gemini prompt in index.ts): the least-dense grid
 * cell, ties resolved to the first cell in row-major order. */
export function findQuietestQuadrant(grid: DriverGrid): { quadrant: Quadrant } {
  let bestIndex = 0;
  for (let i = 1; i < grid.length; i++) {
    if (grid[i] < grid[bestIndex]) bestIndex = i;
  }
  return { quadrant: QUADRANT_LABELS[bestIndex] };
}

function clampOffsetMeters(distanceMeters: number): number {
  return Math.min(MAX_SPOT_OFFSET_METERS, Math.max(MIN_SPOT_OFFSET_METERS, distanceMeters));
}

/** Equirectangular destination-point approximation -- accurate enough at the
 * tens-to-low-hundreds-of-meters distances this deals with. */
export function offsetCoordinate(
  origin: GeoPoint,
  bearingDeg: number,
  distanceMeters: number
): GeoPoint {
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const latRad = (origin.latitude * Math.PI) / 180;
  const dLat = (distanceMeters * Math.cos(bearingRad)) / EARTH_RADIUS_METERS;
  const dLng =
    (distanceMeters * Math.sin(bearingRad)) / (EARTH_RADIUS_METERS * Math.cos(latRad));
  return {
    latitude: origin.latitude + (dLat * 180) / Math.PI,
    longitude: origin.longitude + (dLng * 180) / Math.PI,
  };
}

/** 50-150m tactical offset toward the sparsest grid cell -- zero offset
 * (zone centroid unchanged) when the center cell is already quietest. */
export function computeMicroSpot(
  zoneCentroid: GeoPoint,
  grid: DriverGrid,
  offsetMeters: number = DEFAULT_SPOT_OFFSET_METERS
): GeoPoint & { quadrant: Quadrant; offsetMeters: number } {
  const { quadrant } = findQuietestQuadrant(grid);
  const bearingDeg = QUADRANT_BEARING_DEG[quadrant];
  if (bearingDeg === null) {
    return { ...zoneCentroid, quadrant, offsetMeters: 0 };
  }
  const distance = clampOffsetMeters(offsetMeters);
  const point = offsetCoordinate(zoneCentroid, bearingDeg, distance);
  return { ...point, quadrant, offsetMeters: distance };
}

// ponytail: fixed threshold, calibrate with real shift data once a few
// real captures land -- add a per-cell density check instead if a flat
// total ever proves too coarse.
export const SATURATION_THRESHOLD = 15;

export function isZoneSaturated(nearbyDriversCount: number): boolean {
  return nearbyDriversCount >= SATURATION_THRESHOLD;
}

export interface ZoneScoreRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  current_score: number | null;
}

// Distance-weighted, not raw score -- mirrors src/lib/zoneMatch.ts's
// rankByProximityPenalizedScore (duplicated, not imported -- Deno and Vite
// don't share a module graph, see this file's header). Without this, a
// saturation fallback could pick the globally highest-scoring zone
// anywhere in the territory and auto-launch navigation to it with no
// tap -- the exact bug rankByProximityPenalizedScore was built to fix
// client-side (see zoneMatch.ts's own comment about Station Montmorency/
// Terminus Longueuil winning on raw score from Saint-Léonard).
export const MAX_FALLBACK_ZONE_DISTANCE_KM = 7;
export const FALLBACK_DISTANCE_PENALTY_PER_KM = 3;

/** Highest-ranking zone other than `currentZoneId` within
 * MAX_FALLBACK_ZONE_DISTANCE_KM of the origin, ranked by
 * `score - distKm * penalty`, excluding unscored zones. */
export function findBestNeighboringZone(
  currentZoneId: string,
  zones: ZoneScoreRow[],
  originLat: number,
  originLng: number
): ZoneScoreRow | null {
  const candidates = zones
    .filter((z) => z.id !== currentZoneId && z.current_score != null)
    .map((z) => ({ ...z, distKm: haversineKm(originLat, originLng, z.latitude, z.longitude) }))
    .filter((z) => z.distKm <= MAX_FALLBACK_ZONE_DISTANCE_KM);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, z) => {
    const rankZ = (z.current_score ?? 0) - z.distKm * FALLBACK_DISTANCE_PENALTY_PER_KM;
    const rankBest = (best.current_score ?? 0) - best.distKm * FALLBACK_DISTANCE_PENALTY_PER_KM;
    return rankZ > rankBest ? z : best;
  });
}

export interface NavigationTarget extends GeoPoint {
  mode: 'micro_spot' | 'fallback_zone';
  zone_name?: string;
}

/** The single entry point index.ts calls: saturated zone -> best
 * neighboring zone (or the micro-spot nudge, if no neighbor is scored);
 * otherwise the micro-spot nudge (or the bare zone centroid, if no grid). */
export function computeNavigationTarget(
  currentZone: GeoPoint,
  nearbyDriversCount: number,
  grid: DriverGrid | undefined,
  neighboringZones: ZoneScoreRow[],
  currentZoneId: string
): NavigationTarget {
  if (isZoneSaturated(nearbyDriversCount)) {
    const fallback = findBestNeighboringZone(
      currentZoneId,
      neighboringZones,
      currentZone.latitude,
      currentZone.longitude
    );
    if (fallback) {
      return {
        latitude: fallback.latitude,
        longitude: fallback.longitude,
        mode: 'fallback_zone',
        zone_name: fallback.name,
      };
    }
    // No scored neighbor -- fall through to the micro-spot nudge below
    // rather than fail the response (see spec's Error handling section).
  }
  if (!grid) {
    return { ...currentZone, mode: 'micro_spot' };
  }
  const spot = computeMicroSpot(currentZone, grid);
  return { latitude: spot.latitude, longitude: spot.longitude, mode: 'micro_spot' };
}
