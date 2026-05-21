import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface ZoneDetected {
  area: string;
  demand: string;
  surge_multiplier: number | null;
  color_intensity: string;
}

interface ExtractedData {
  earnings?: number | null;
  tips?: number | null;
  distance_km?: number | null;
  hours_worked?: number | null;
  trips_count?: number | null;
  date?: string | null;
}

interface AnalysisResult {
  zones_detected?: ZoneDetected[];
  overall_demand?: string;
  time_context?: string | null;
  notes?: string;
  recommended_target?:
    | 'demand'
    | 'shift'
    | 'daily'
    | 'mileage'
    | 'profit'
    | 'unknown';
  extracted_data?: ExtractedData;
  matched_zone_id?: string;
  matched_zone_name?: string;
}

interface RequestBody {
  image_url?: string;
  file_content?: string;
  file_name?: string;
  zone_id?: string;
  zone_name?: string;
  auto_zone?: boolean;
  mode?: string;
}

interface ZoneRow {
  id: string;
  name: string;
  type: string | null;
  city_id: string | null;
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

async function loadZones(client: SupabaseClient | null): Promise<ZoneRow[]> {
  if (!client) return [];
  const { data, error } = await client
    .from('zones')
    .select('id, name, type, city_id')
    .in('city_id', ['mtl', 'lvl', 'lng']);
  if (error || !data) return [];
  return data as ZoneRow[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    return await handleRequest(req);
  } catch (err) {
    console.error('analyze-screenshot error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleRequest(req: Request): Promise<Response> {
  const body: RequestBody = await req.json().catch(() => ({} as RequestBody));
  const env = readEnv();

  if (body.file_content) {
    const analysis = analyzeFileContent(body.file_content, body.file_name);
    return jsonResponse({ analysis });
  }
  if (!body.image_url || !env.geminiKey) {
    return jsonResponse({ analysis: fallbackAnalysis(body.zone_name) });
  }

  const client = getServiceClient(env);
  const zones = await loadZones(client);

  const fetched = await fetchImage(body.image_url);
  if (!fetched) {
    return jsonResponse({ analysis: fallbackAnalysis(body.zone_name) });
  }

  const analysis = await runGemini(env.geminiKey, fetched, body.zone_name, zones);
  if (!analysis) {
    return jsonResponse({ analysis: fallbackAnalysis(body.zone_name) });
  }

  await resolveZoneIfNeeded(analysis, body, client, zones);
  return jsonResponse({ analysis });
}

interface FetchedImage { bytes: Uint8Array; mimeType: string; }

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

async function runGemini(
  apiKey: string,
  image: FetchedImage,
  zoneName: string | undefined,
  zones: ZoneRow[],
): Promise<AnalysisResult | null> {
  const prompt = buildPrompt(zoneName, zones);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: image.mimeType, data: toBase64(image.bytes) } },
            { text: prompt },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 1024,
        },
      }),
    },
  );
  if (!res.ok) {
    console.error('Gemini Vision error:', await res.text());
    return null;
  }
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try {
    return JSON.parse(raw) as AnalysisResult;
  } catch {
    return null;
  }
}

async function resolveZoneIfNeeded(
  analysis: AnalysisResult,
  body: RequestBody,
  client: SupabaseClient | null,
  zones: ZoneRow[],
): Promise<void> {
  if (!body.auto_zone) return;
  // 1. Si Gemini a déjà retourné un matched_zone_id valide, on le vérifie
  if (analysis.matched_zone_id) {
    const known = zones.find((z) => z.id === analysis.matched_zone_id);
    if (known) {
      analysis.matched_zone_name = known.name;
      return;
    }
    // ID inventé par Gemini → on le drop et on tombe en fallback
    analysis.matched_zone_id = undefined;
  }
  // 2. Fallback : ilike sur le premier zones_detected
  if (!client || !analysis.zones_detected?.length) return;
  const detected = analysis.zones_detected[0]?.area;
  if (!detected) return;
  const { data } = await client
    .from('zones')
    .select('id, name')
    .ilike('name', `%${detected}%`)
    .limit(1)
    .maybeSingle();
  if (data) {
    analysis.matched_zone_id = data.id;
    analysis.matched_zone_name = data.name;
  }
}

function buildZonesCatalog(zones: ZoneRow[]): string {
  if (!zones.length) return '';
  const lines = zones.map(
    (z) => `- ${z.id} | ${z.name} | ${z.type ?? 'n/a'} | city=${z.city_id ?? 'n/a'}`,
  );
  return `\nKnown zones catalog (Montreal / Laval / Longueuil — Rive-Sud). Choose ONE id from this list when relevant; otherwise return null:\n${lines.join('\n')}\n`;
}

function buildPrompt(zoneName: string | undefined, zones: ZoneRow[]): string {
  const zoneCtx = zoneName
    ? `The driver is currently positioned near "${zoneName}" in Montreal/Laval/Longueuil (Quebec).`
    : 'The driver did NOT pre-select a zone — infer it from the image if possible.';
  const catalog = buildZonesCatalog(zones);
  return `You are analyzing a rideshare/delivery driver screenshot taken in Quebec, Canada (Greater Montreal area: Montréal island, Laval, Longueuil / Rive-Sud).
${zoneCtx}
${catalog}
Extract all useful information from this image and return ONLY a raw JSON object (no markdown fences) matching:
{
  "zones_detected": [{ "area": string, "demand": "low"|"medium"|"high"|"surge", "surge_multiplier": number|null, "color_intensity": "light"|"medium"|"dark" }],
  "overall_demand": "low"|"medium"|"high"|"surge",
  "time_context": "morning"|"afternoon"|"evening"|"night"|null,
  "notes": "brief human-readable summary in French (max 120 chars)",
  "recommended_target": "demand"|"shift"|"daily"|"mileage"|"profit"|"unknown",
  "extracted_data": {
    "earnings": number|null,
    "tips": number|null,
    "distance_km": number|null,
    "hours_worked": number|null,
    "trips_count": number|null,
    "date": "YYYY-MM-DD"|null
  },
  "matched_zone_id": string|null
}

Rules:
- matched_zone_id: read any text/labels visible on the image (street names, borough names, neighbourhoods, landmarks, transit stations, bridges). If you can locate the screenshot inside one of the catalog entries above, return its EXACT id from the catalog. If unsure, return null — DO NOT invent ids.
- zones_detected: list visible demand zones/areas in the image (empty array if none)
- recommended_target: "demand" for heatmaps/zone screenshots, "shift" for earnings/trip summaries, "mileage" for distance/mileage reports, "daily" for daily summaries, "profit" for profit/loss screens
- extracted_data: populate only fields visually present in the image; null otherwise
- All monetary values in CAD
- distance_km: convert miles to km if needed (1 mi = 1.609 km)
- Return ONLY the JSON, no other text`;
}

interface CsvAccumulator {
  totalEarnings: number;
  totalTips: number;
  totalDistance: number;
  tripsCount: number;
  sawEarnings: boolean;
  sawTips: boolean;
  sawDistance: boolean;
  sawTrips: boolean;
}

function newAccumulator(): CsvAccumulator {
  return {
    totalEarnings: 0,
    totalTips: 0,
    totalDistance: 0,
    tripsCount: 0,
    sawEarnings: false,
    sawTips: false,
    sawDistance: false,
    sawTrips: false,
  };
}

function applyCell(acc: CsvAccumulator, header: string, value: number): void {
  if (/earnings|fare|revenue/.test(header)) {
    acc.sawEarnings = true;
    acc.totalEarnings += value;
  }
  if (/tip/.test(header)) {
    acc.sawTips = true;
    acc.totalTips += value;
  }
  if (/distance|km|mileage/.test(header)) {
    acc.sawDistance = true;
    acc.totalDistance += value;
  }
  if (/trip|ride/.test(header) && Number.isInteger(value)) {
    acc.sawTrips = true;
    acc.tripsCount += value;
  }
}

function analyzeFileContent(content: string, fileName?: string): AnalysisResult {
  const lines = content.split('\n');
  const headerLine = lines[0] ?? '';
  const headers = headerLine.toLowerCase();
  const headerCols = headerLine.split(',');

  const isMileage =
    /distance|mileage|km|mi\b/.test(headers) && /earnings|fare|revenue/.test(headers);
  const isShift =
    /lyft|uber|doordash|skip/.test(fileName?.toLowerCase() ?? '') ||
    /trip|fare|earnings/.test(headers);

  const acc = newAccumulator();
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map((c) => c.replace(/["$]/g, '').trim());
    for (let i = 0; i < cols.length; i++) {
      const header = headerCols[i]?.toLowerCase() ?? '';
      const val = parseFloat(cols[i]);
      if (!Number.isNaN(val)) applyCell(acc, header, val);
    }
  }

  if (/\bmi\b|mile/.test(headers) && !/km/.test(headers)) {
    acc.totalDistance = acc.totalDistance * 1.609;
  }

  return {
    overall_demand: 'medium',
    notes: `Fichier CSV analysé : ${isMileage ? 'kilométrage' : isShift ? 'quart de travail' : 'données'} importé`,
    recommended_target: isMileage ? 'mileage' : isShift ? 'shift' : 'daily',
    extracted_data: {
      earnings: acc.sawEarnings ? acc.totalEarnings : null,
      tips: acc.sawTips ? acc.totalTips : null,
      distance_km: acc.sawDistance ? Math.round(acc.totalDistance * 100) / 100 : null,
      trips_count: acc.sawTrips ? acc.tripsCount : null,
    },
  };
}

function fallbackAnalysis(zoneName?: string): AnalysisResult {
  return {
    zones_detected: [],
    overall_demand: 'medium',
    time_context: null,
    notes: zoneName
      ? `Analyse non disponible — zone ${zoneName} sélectionnée`
      : 'Analyse non disponible — sélectionnez une zone',
    recommended_target: 'demand',
    extracted_data: {
      earnings: null,
      tips: null,
      distance_km: null,
      hours_worked: null,
      trips_count: null,
      date: null,
    },
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
