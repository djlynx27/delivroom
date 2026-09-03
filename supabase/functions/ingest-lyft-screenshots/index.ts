// supabase/functions/ingest-lyft-screenshots/index.ts
// ──────────────────────────────────────────────────────────────────────────
// Ingests 3 Lyft Driver screenshots (wait times, recent demand, nearby
// drivers) + the driver's current GPS, extracts a live demand snapshot via
// Gemini Vision, and stores it in platform_signals -- the SAME table
// useDemandScores.ts already reads for the "Lyft platform signal" boost.
// No new table: platform_signals already has demand_level/estimated_wait_min/
// source='screenshot'/platform='lyft'; this migration only added the one
// genuinely new field (nearby_drivers_count).
//
// See docs/ingest-lyft-screenshots-macrodroid.md for the full external
// integration guide (MacroDroid HTTP Request setup, example payload).
//
// Auth: header  Authorization: Bearer <INGEST_LYFT_API_KEY>
//   A dedicated shared secret (not the Supabase anon/service key), same
//   pattern as quick-log-trip. Deploy with:
//     supabase functions deploy ingest-lyft-screenshots --no-verify-jwt
//
// POST body: {
//   // each image as EITHER a pre-uploaded Storage URL OR raw/data-URI base64
//   // -- MacroDroid can't easily authenticate a separate Storage upload
//   // step, so the *_base64 fields let it POST everything in one shot.
//   wait_times_image_url?: string,      wait_times_image_base64?: string,
//   recent_demand_image_url?: string,   recent_demand_image_base64?: string,
//   nearby_drivers_image_url?: string,  nearby_drivers_image_base64?: string,
//   latitude: number,
//   longitude: number,
//   zone_id?: string  -- skips GPS-based zone resolution when provided
// }
// ──────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';
import { isRateLimited } from '../_shared/rateLimit.ts';
import { lenientJsonParse } from '../_shared/jsonParse.ts';
import {
  decodeBase64Image,
  formatGpsAddress,
  hashImages,
  haversineKm,
  parseLyftSnapshot,
  parseNearbyOnlySnapshot,
  shouldFlagEmergingHotspot,
  type LyftSnapshot,
} from './lyftSnapshot.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  wait_times_image_url?: string;
  wait_times_image_base64?: string;
  recent_demand_image_url?: string;
  recent_demand_image_base64?: string;
  nearby_drivers_image_url?: string;
  nearby_drivers_image_base64?: string;
  latitude?: number;
  longitude?: number;
  zone_id?: string;
}

interface ImageSlot {
  url?: string;
  base64?: string;
}

interface ZoneRow {
  id: string;
  latitude: number;
  longitude: number;
}

interface EnvConfig {
  geminiKey: string | null;
  supabaseUrl: string | null;
  supabaseServiceKey: string | null;
  apiKey: string | null;
}

function readEnv(): EnvConfig {
  return {
    geminiKey: Deno.env.get('GEMINI_API_KEY') ?? null,
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? null,
    supabaseServiceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? null,
    apiKey: Deno.env.get('INGEST_LYFT_API_KEY') ?? null,
  };
}

function getServiceClient(env: EnvConfig): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseServiceKey) return null;
  return createClient(env.supabaseUrl, env.supabaseServiceKey);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    return await handleRequest(req);
  } catch (err) {
    console.error('ingest-lyft-screenshots error:', err);
    captureEdgeException(err, 'ingest-lyft-screenshots', {
      url: req.url,
      method: req.method,
    });
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST requis' }, 405);

  const env = readEnv();
  if (!env.apiKey) {
    return json({ error: 'Serveur mal configuré (clé API manquante)' }, 500);
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  const providedKey = authHeader.replace(/^Bearer\s+/i, '');
  if (providedKey !== env.apiKey) {
    return json({ error: 'Non autorisé' }, 401);
  }

  // Raw-body mode: MacroDroid's HTTP Request action has no base64-encode
  // function, but its Content Body has a native "File" mode that posts the
  // screenshot's raw bytes directly -- simpler than base64 anyway. Detected
  // by Content-Type; lat/lng/zone_id ride in the URL query string since the
  // body is the image itself. Always nearby-only (one raw image = one slot).
  const contentType = req.headers.get('content-type') ?? '';
  const isRawImage = contentType.startsWith('image/');

  let body: RequestBody;
  let rawImage: FetchedImage | null = null;
  if (isRawImage) {
    const url = new URL(req.url);
    // URLSearchParams.get() returns '' (not null) for a present-but-empty
    // key -- e.g. a MacroDroid GPS variable that hasn't resolved yet sends
    // `?latitude=&longitude=`. `!lat` catches both missing and empty so
    // Number('') === 0 never slips past the Number.isFinite guard below as
    // a fake valid coordinate.
    const lat = url.searchParams.get('latitude');
    const lng = url.searchParams.get('longitude');
    body = {
      latitude: lat ? Number(lat) : undefined,
      longitude: lng ? Number(lng) : undefined,
      zone_id: url.searchParams.get('zone_id') ?? undefined,
    };
    // Mirror fetchImage's normalization below -- Gemini's inlineData.mimeType
    // only accepts a bare media type, not a Content-Type with parameters
    // (e.g. "image/jpeg; charset=binary").
    const mimeType = contentType.split(';')[0]?.trim() || 'image/jpeg';
    rawImage = { bytes: new Uint8Array(await req.arrayBuffer()), mimeType };
  } else {
    body = await req.json().catch(() => ({}) as RequestBody);
  }

  // Wait Times / Recent Demand are deliberately no longer captured (Lyft's
  // own gamified/delayed metrics -- see docs/ingest-lyft-screenshots-macrodroid.md
  // §3B): both slots are optional now, Nearby Drivers is the only one required.
  const optionalSlots: ImageSlot[] = isRawImage
    ? []
    : [
        { url: body.wait_times_image_url, base64: body.wait_times_image_base64 },
        { url: body.recent_demand_image_url, base64: body.recent_demand_image_base64 },
      ].filter((s) => s.url || s.base64);
  const nearbySlot: ImageSlot = {
    url: body.nearby_drivers_image_url,
    base64: body.nearby_drivers_image_base64,
  };
  if (!isRawImage && !nearbySlot.url && !nearbySlot.base64) {
    return json(
      { error: 'nearby_drivers_image (_url ou _base64) est requise' },
      400
    );
  }
  const slots: ImageSlot[] = [...optionalSlots, nearbySlot];
  if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) {
    return json({ error: 'Coordonnées GPS requises' }, 400);
  }
  if (!env.geminiKey) {
    return json({ error: 'Serveur mal configuré (clé Gemini manquante)' }, 500);
  }
  if (!env.supabaseUrl) {
    return json({ error: 'Serveur mal configuré (URL Supabase manquante)' }, 500);
  }

  // SSRF guard: a URL-based slot may only ever point at this project's own
  // Storage bucket. base64 slots skip this entirely -- there's no fetch.
  for (const slot of slots) {
    if (slot.url && !slot.url.startsWith(`${env.supabaseUrl}/storage/v1/object/`)) {
      return json({ error: 'URL image refusée (hors du stockage de l\'app)' }, 400);
    }
  }

  const client = getServiceClient(env);
  if (client && (await isRateLimited(client, 'ingest-lyft-screenshots', 20))) {
    return json({ error: 'Trop de requêtes, réessaie dans une minute' }, 429);
  }

  const fetched = isRawImage
    ? [rawImage]
    : await Promise.all(slots.map(resolveImage));
  if (fetched.some((f) => f === null)) {
    return json({ error: 'Impossible de lire une des captures (URL expirée ou base64 invalide?)' }, 400);
  }
  const images = fetched as FetchedImage[];

  // Idempotency: a MacroDroid retry on a flaky connection re-POSTs the same
  // 3 screenshots byte-for-byte, AND a driver re-scanning the whole /Lyft
  // folder by hand (no working background auto-scan yet) re-uploads
  // screenshots already ingested days ago. Both cases must skip the Gemini
  // call and replay the signal already recorded for this exact content —
  // unconditionally, not just within a short retry window, otherwise a
  // manual re-scan re-bills Gemini and inserts duplicate platform_signals
  // rows for every already-processed file.
  const contentHash = await hashImages(images);
  if (client) {
    const { data: recent } = await client
      .from('platform_signals')
      .select('zone_id, demand_level, estimated_wait_min, nearby_drivers_count')
      .eq('content_hash', contentHash)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) {
      return json({
        ok: true,
        zone_id: recent.zone_id,
        snapshot: {
          demand_score: recent.demand_level,
          wait_time_min: recent.estimated_wait_min,
          nearby_drivers_count: recent.nearby_drivers_count,
        },
        replayed: true,
      });
    }
  }

  const nearbyOnly = optionalSlots.length === 0;
  const snapshot = await runGeminiVision(env.geminiKey, images, nearbyOnly);
  if (!snapshot) {
    return json({ error: 'Gemini n\'a pas pu extraire un snapshot valide de ces captures' }, 502);
  }

  let zoneId = body.zone_id ?? null;
  let nearestDistanceKm: number | null = null;
  if (!zoneId && client) {
    const nearest = await resolveNearestZone(client, body.latitude!, body.longitude!);
    zoneId = nearest?.id ?? null;
    nearestDistanceKm = nearest?.distanceKm ?? null;
  }

  if (client && zoneId) {
    const { error } = await client.from('platform_signals').insert({
      zone_id: zoneId,
      platform: 'lyft',
      // demand_level defaults to 0 / estimated_wait_min stays null when a
      // nearby-only capture has no demand/wait signal to report.
      ...(snapshot.demand_score != null && { demand_level: snapshot.demand_score }),
      estimated_wait_min:
        snapshot.wait_time_min != null ? Math.round(snapshot.wait_time_min) : null,
      nearby_drivers_count: snapshot.nearby_drivers_count,
      source: 'screenshot',
      captured_at: new Date().toISOString(),
      content_hash: contentHash,
    });
    if (error) console.error('ingest-lyft-screenshots: platform_signals insert failed', error);
  }

  // Driver is meaningfully far from every known zone AND demand there reads
  // high -- worth surfacing as an "emerging hotspot" candidate even though
  // we don't have a matched zone for it. Best-effort: never blocks the
  // response the driver actually cares about (the snapshot itself).
  // Needs a demand_score to judge "high" -- skipped for nearby-only captures.
  let emergingHotspot = false;
  if (
    client &&
    snapshot.demand_score != null &&
    shouldFlagEmergingHotspot(nearestDistanceKm, snapshot.demand_score)
  ) {
    emergingHotspot = await logEmergingHotspot(client, body.latitude!, body.longitude!, snapshot);
  }

  return json({ ok: true, zone_id: zoneId, snapshot, emerging_hotspot: emergingHotspot });
}

interface FetchedImage {
  bytes: Uint8Array;
  mimeType: string;
}

async function fetchImage(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    const mimeType = contentType.startsWith('image/')
      ? contentType.split(';')[0].trim()
      : 'image/jpeg';
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType };
  } catch {
    return null;
  }
}

async function resolveImage(slot: ImageSlot): Promise<FetchedImage | null> {
  if (slot.base64) return decodeBase64Image(slot.base64);
  if (slot.url) return fetchImage(slot.url);
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function runGeminiVision(
  apiKey: string,
  images: FetchedImage[],
  nearbyOnly: boolean
): Promise<LyftSnapshot | null> {
  const prompt = nearbyOnly
    ? `You are analyzing 1 screenshot from the Lyft Driver app: the "Nearby drivers" screen (map showing rival driver car icons near the current position).

Extract and return ONLY a raw JSON object (no markdown fences) matching:
{
  "nearby_drivers_count": number // count of visually distinct rival driver car icons on the map
}

Rules:
- If the count isn't clearly visible, make your best visual estimate rather than returning null.
- Return ONLY the JSON, no other text.`
    : `You are analyzing 3 screenshots from the Lyft Driver app, in this exact order:
1. Wait times screen
2. Recent demand screen (heatmap/graph of ride requests)
3. Nearby drivers screen (map showing rival driver car icons near the current position)

Extract and return ONLY a raw JSON object (no markdown fences) matching:
{
  "demand_score": number,        // 1-10, based on image 2 (Recent Demand) — 1 = very quiet, 10 = extremely high demand
  "wait_time_min": number,       // estimated wait time in minutes, read from image 1
  "nearby_drivers_count": number // count of visually distinct rival driver car icons on image 3
}

Rules:
- If a value isn't clearly visible, make your best visual estimate rather than returning null.
- demand_score and wait_time_min must be plain numbers, not strings or ranges.
- Return ONLY the JSON, no other text.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              ...images.map((img) => ({
                inlineData: { mimeType: img.mimeType, data: toBase64(img.bytes) },
              })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 512,
        },
      }),
    }
  );

  if (!res.ok) {
    console.error(`Gemini Vision error (status ${res.status}):`, await res.text());
    return null;
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const parsed = lenientJsonParse(raw);
  if (parsed === null) {
    console.error('Gemini returned unparseable response. Raw text:\n', raw);
    return null;
  }
  return nearbyOnly ? parseNearbyOnlySnapshot(parsed) : parseLyftSnapshot(parsed);
}

interface NearestZoneResult {
  id: string;
  distanceKm: number;
}

async function resolveNearestZone(
  client: SupabaseClient,
  lat: number,
  lng: number
): Promise<NearestZoneResult | null> {
  const { data, error } = await client
    .from('zones')
    .select('id, latitude, longitude');
  if (error || !data?.length) return null;

  let best: ZoneRow | null = null;
  let bestDist = Infinity;
  for (const zone of data as ZoneRow[]) {
    const dist = haversineKm(lat, lng, zone.latitude, zone.longitude);
    if (dist < bestDist) {
      bestDist = dist;
      best = zone;
    }
  }
  return best ? { id: best.id, distanceKm: bestDist } : null;
}

/** Upserts into zone_discoveries (context='other') -- same table/pattern
 * analyze-screenshot already uses for unmatched pickup/dropoff addresses,
 * just keyed by a GPS label instead of a street address, and with lat/lng
 * kept (columns added specifically for this) so a promoted zone doesn't
 * need a separate geocoding step. Returns whether the flag succeeded. */
async function logEmergingHotspot(
  client: SupabaseClient,
  lat: number,
  lng: number,
  snapshot: LyftSnapshot
): Promise<boolean> {
  const address = formatGpsAddress(lat, lng);
  const waitLabel =
    snapshot.wait_time_min != null ? `~${Math.round(snapshot.wait_time_min)}min` : 'inconnue';
  const notes = `Détecté via ingest-lyft-screenshots — demande ${snapshot.demand_score}/10, attente ${waitLabel}`;
  try {
    const { data: existing } = await client
      .from('zone_discoveries')
      .select('id, count')
      .eq('context', 'other')
      .ilike('address', address)
      .maybeSingle();

    if (existing) {
      const { error } = await client
        .from('zone_discoveries')
        .update({
          count: (existing.count ?? 0) + 1,
          last_seen_at: new Date().toISOString(),
          notes,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await client.from('zone_discoveries').insert({
        address,
        context: 'other',
        latitude: lat,
        longitude: lng,
        notes,
      });
      if (error) throw error;
    }
    return true;
  } catch (err) {
    console.error('ingest-lyft-screenshots: emerging hotspot log failed', err);
    return false;
  }
}
