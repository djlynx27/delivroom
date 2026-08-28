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
// POST body: {
//   wait_times_image_url: string,
//   recent_demand_image_url: string,
//   nearby_drivers_image_url: string,
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
import { haversineKm, parseLyftSnapshot, type LyftSnapshot } from './lyftSnapshot.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  wait_times_image_url?: string;
  recent_demand_image_url?: string;
  nearby_drivers_image_url?: string;
  latitude?: number;
  longitude?: number;
  zone_id?: string;
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
}

function readEnv(): EnvConfig {
  return {
    geminiKey: Deno.env.get('GEMINI_API_KEY') ?? null,
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? null,
    supabaseServiceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? null,
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

  const body: RequestBody = await req.json().catch(() => ({}) as RequestBody);
  const env = readEnv();

  const imageUrls = [
    body.wait_times_image_url,
    body.recent_demand_image_url,
    body.nearby_drivers_image_url,
  ];
  if (imageUrls.some((u) => !u)) {
    return json({ error: 'Les 3 images (wait_times, recent_demand, nearby_drivers) sont requises' }, 400);
  }
  if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) {
    return json({ error: 'Coordonnées GPS requises' }, 400);
  }
  if (!env.geminiKey) {
    return json({ error: 'Serveur mal configuré (clé Gemini manquante)' }, 500);
  }
  if (!env.supabaseUrl) {
    return json({ error: 'Serveur mal configuré (URL Supabase manquante)' }, 500);
  }

  // SSRF guard: only ever fetch from this project's own Storage bucket.
  for (const url of imageUrls) {
    if (!url!.startsWith(`${env.supabaseUrl}/storage/v1/object/`)) {
      return json({ error: 'URL image refusée (hors du stockage de l\'app)' }, 400);
    }
  }

  const client = getServiceClient(env);
  if (client && (await isRateLimited(client, 'ingest-lyft-screenshots', 20))) {
    return json({ error: 'Trop de requêtes, réessaie dans une minute' }, 429);
  }

  const fetched = await Promise.all(imageUrls.map((u) => fetchImage(u!)));
  if (fetched.some((f) => f === null)) {
    return json({ error: 'Impossible de télécharger une des captures (URL expirée?)' }, 400);
  }

  const snapshot = await runGeminiVision(
    env.geminiKey,
    fetched as FetchedImage[]
  );
  if (!snapshot) {
    return json({ error: 'Gemini n\'a pas pu extraire un snapshot valide de ces captures' }, 502);
  }

  let zoneId = body.zone_id ?? null;
  if (!zoneId && client) {
    zoneId = await resolveNearestZoneId(client, body.latitude!, body.longitude!);
  }

  if (client && zoneId) {
    const { error } = await client.from('platform_signals').insert({
      zone_id: zoneId,
      platform: 'lyft',
      demand_level: snapshot.demand_score,
      estimated_wait_min: Math.round(snapshot.wait_time_min),
      nearby_drivers_count: snapshot.nearby_drivers_count,
      source: 'screenshot',
      captured_at: new Date().toISOString(),
    });
    if (error) console.error('ingest-lyft-screenshots: platform_signals insert failed', error);
  }

  return json({ ok: true, zone_id: zoneId, snapshot });
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

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function runGeminiVision(
  apiKey: string,
  images: FetchedImage[]
): Promise<LyftSnapshot | null> {
  const prompt = `You are analyzing 3 screenshots from the Lyft Driver app, in this exact order:
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
  return parseLyftSnapshot(parsed);
}

async function resolveNearestZoneId(
  client: SupabaseClient,
  lat: number,
  lng: number
): Promise<string | null> {
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
  return best?.id ?? null;
}
