// Pure, side-effect-free logic for ingest-lyft-screenshots — split out from
// index.ts so it can be unit-tested (deno test) without triggering index.ts's
// module-level serve() call, which binds a listener on import.

export interface LyftSnapshot {
  demand_score: number;
  wait_time_min: number;
  nearby_drivers_count: number;
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
