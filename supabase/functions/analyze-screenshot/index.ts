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
  pickup_address?: string | null;
  dropoff_address?: string | null;
  pickup_zone_id?: string | null;
  pickup_zone_name?: string | null;
  dropoff_zone_id?: string | null;
  dropoff_zone_name?: string | null;
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
  is_fallback?: boolean;
  fallback_reason?: 'missing_image_url' | 'missing_api_key' | 'image_fetch_failed' | 'gemini_call_failed' | 'gemini_invalid_json';
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
  if (!body.image_url) {
    return jsonResponse({ analysis: fallbackAnalysis(body.zone_name, 'missing_image_url') });
  }
  if (!env.geminiKey) {
    console.error('analyze-screenshot: GEMINI_API_KEY not set in Edge Function secrets');
    return jsonResponse({ analysis: fallbackAnalysis(body.zone_name, 'missing_api_key') });
  }

  const client = getServiceClient(env);
  const zones = await loadZones(client);

  const fetched = await fetchImage(body.image_url);
  if (!fetched) {
    console.error('analyze-screenshot: failed to fetch image from', body.image_url);
    return jsonResponse({ analysis: fallbackAnalysis(body.zone_name, 'image_fetch_failed') });
  }

  const geminiResult = await runGemini(env.geminiKey, fetched, body.zone_name, zones);
  if (!geminiResult.analysis) {
    return jsonResponse({ analysis: fallbackAnalysis(body.zone_name, geminiResult.reason) });
  }

  await resolveZoneIfNeeded(geminiResult.analysis, body, client, zones);
  return jsonResponse({ analysis: geminiResult.analysis });
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

interface GeminiResult {
  analysis: AnalysisResult | null;
  reason: 'gemini_call_failed' | 'gemini_invalid_json';
}

async function runGemini(
  apiKey: string,
  image: FetchedImage,
  zoneName: string | undefined,
  zones: ZoneRow[],
): Promise<GeminiResult> {
  const prompt = buildPrompt(zoneName, zones);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
          maxOutputTokens: 2048,
        },
      }),
    },
  );
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`Gemini Vision error (status ${res.status}):`, errBody);
    return { analysis: null, reason: 'gemini_call_failed' };
  }
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const parsed = lenientJsonParse(raw);
  if (parsed === null) {
    console.error('Gemini returned unparseable response. Raw text:\n', raw);
    return { analysis: null, reason: 'gemini_invalid_json' };
  }
  return { analysis: parsed as AnalysisResult, reason: 'gemini_call_failed' };
}

function lenientJsonParse(raw: string): unknown {
  // 1. Strict JSON first
  try {
    return JSON.parse(raw);
  } catch { /* fall through */ }

  // 2. Strip markdown fences (```json ... ``` or ``` ... ```)
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch { /* fall through */ }
  }

  // 3. Find first balanced { ... } block via brace counting
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function resolveZoneIfNeeded(
  analysis: AnalysisResult,
  body: RequestBody,
  client: SupabaseClient | null,
  zones: ZoneRow[],
): Promise<void> {
  if (!body.auto_zone) return;

  // Validate + fuzzy-match pickup/dropoff zone ids against the catalog
  await resolvePickupDropoffZones(analysis, client, zones);

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

async function resolvePickupDropoffZones(
  analysis: AnalysisResult,
  client: SupabaseClient | null,
  zones: ZoneRow[],
): Promise<void> {
  const data = analysis.extracted_data;
  if (!data) return;

  // Pickup
  const pickup = await resolveOneAddress(
    data.pickup_zone_id ?? null,
    data.pickup_address ?? null,
    'pickup',
    client,
    zones,
  );
  if (pickup) {
    data.pickup_zone_id = pickup.id;
    data.pickup_zone_name = pickup.name;
  } else {
    data.pickup_zone_id = null;
  }

  // Dropoff
  const dropoff = await resolveOneAddress(
    data.dropoff_zone_id ?? null,
    data.dropoff_address ?? null,
    'dropoff',
    client,
    zones,
  );
  if (dropoff) {
    data.dropoff_zone_id = dropoff.id;
    data.dropoff_zone_name = dropoff.name;
  } else {
    data.dropoff_zone_id = null;
  }
}

async function resolveOneAddress(
  geminiZoneId: string | null,
  address: string | null,
  context: 'pickup' | 'dropoff',
  client: SupabaseClient | null,
  zones: ZoneRow[],
): Promise<ZoneRow | null> {
  // 1. Trust Gemini if id is in the catalog
  if (geminiZoneId) {
    const known = zones.find((z) => z.id === geminiZoneId);
    if (known) return known;
  }
  // 2. Fuzzy match server-side
  if (!address) return null;
  const matched = fuzzyMatchAddress(address, zones);
  if (matched) return matched;
  // 3. No match anywhere — log to zone_discoveries for future promotion
  if (client) {
    await logDiscovery(client, address, context, guessCityId(address));
  }
  return null;
}

const CITY_KEYWORDS: Record<string, string[]> = {
  mtl: [
    'montreal', 'montréal', 'mtl',
    'saint-laurent', 'st-laurent', 'st laurent', 'saint laurent',
    'saint-léonard', 'st-léonard', 'saint leonard', 'st leonard',
    'verdun', 'outremont', 'westmount', 'lasalle', 'anjou',
    'rivière-des-prairies', 'riviere-des-prairies', 'rdp',
    'pointe-aux-trembles', 'pat',
    'plateau', 'rosemont', 'villeray', 'parc-extension', 'parc ex',
    'mile end', 'mile-end', 'côte-des-neiges', 'cote-des-neiges', 'cdn',
    'notre-dame-de-grâce', 'ndg',
    'hochelaga', 'maisonneuve', 'mercier', 'ahuntsic', 'cartierville',
    'lachine', 'dorval', 'pierrefonds', 'roxboro', 'kirkland',
    'pointe-claire', 'baie-d\'urfé', 'beaconsfield', 'sainte-anne-de-bellevue',
    'griffintown', 'sud-ouest', 'sud ouest',
  ],
  lvl: ['laval', 'chomedey', 'sainte-rose', 'ste-rose', 'sainte-dorothée',
    'duvernay', 'fabreville', 'auteuil', 'pont-viau', 'vimont', 'laval-ouest',
    'laval-des-rapides', 'saint-vincent-de-paul', 'saint-françois'],
  lng: ['longueuil', 'brossard', 'saint-hubert', 'st-hubert', 'saint-lambert',
    'st-lambert', 'greenfield park', 'lemoyne', 'boucherville',
    'saint-bruno', 'st-bruno', 'rive-sud', 'rive sud', 'south shore'],
  trb: ['terrebonne', 'lachenaie', 'mascouche', 'la plaine'],
  sth: ['sainte-thérèse', 'ste-thérèse', 'ste therese'],
  blv: ['blainville'],
  bsb: ['boisbriand'],
  rsm: ['rosemère', 'rosemere'],
  bdf: ['bois-des-filion', 'bois des filion'],
};

function guessCityId(address: string): string | null {
  const lower = address.toLowerCase();
  // Score each city by counting keyword hits; pick the highest
  let bestCity: string | null = null;
  let bestScore = 0;
  for (const [cityId, keywords] of Object.entries(CITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw) && kw.length > bestScore) {
        bestCity = cityId;
        bestScore = kw.length;
      }
    }
  }
  return bestCity;
}

function fuzzyMatchAddress(address: string, zones: ZoneRow[]): ZoneRow | null {
  const cityId = guessCityId(address);
  const candidates = cityId ? zones.filter((z) => z.city_id === cityId) : zones;
  if (!candidates.length) return null;

  // Strip the trailing city tag so "Boulevard X, Laval" doesn't make every Laval
  // zone match on the word "laval"
  const street = stripCityTag(address).toLowerCase();

  // Score each candidate zone by how many of its name tokens appear in the address.
  // Longer matched tokens score higher.
  let best: ZoneRow | null = null;
  let bestScore = 0;
  for (const zone of candidates) {
    const score = scoreZoneAgainstAddress(zone.name, street);
    if (score > bestScore) {
      best = zone;
      bestScore = score;
    }
  }
  // Require a meaningful match (at least one ≥4-char token hit) to avoid false positives
  return bestScore >= 4 ? best : null;
}

const CITY_TAG_RE = /,\s*(?:laval|longueuil|montréal|montreal|mtl|terrebonne|blainville|boisbriand|rosemère|rosemere|bois-des-filion|sainte-thérèse|ste-thérèse|ste thérèse|qc|québec|quebec|canada)[\s,]*$/iu;

function stripCityTag(address: string): string {
  return address.replace(CITY_TAG_RE, '').trim();
}

function scoreZoneAgainstAddress(zoneName: string, lowerAddress: string): number {
  const tokens = zoneName
    .toLowerCase()
    .split(/[\s\-']+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  let score = 0;
  for (const token of tokens) {
    if (lowerAddress.includes(token)) {
      score += token.length;
    }
  }
  return score;
}

const STOPWORDS = new Set([
  'rue', 'boul', 'boulevard', 'bd', 'avenue', 'av', 'place', 'gare',
  'station', 'centre', 'ville', 'sainte', 'saint', 'ste', 'st', 'de',
  'la', 'le', 'les', 'du', 'des', 'cégep', 'cegep', 'parc',
]);

async function logDiscovery(
  client: SupabaseClient,
  address: string,
  context: 'pickup' | 'dropoff',
  cityHint: string | null,
): Promise<void> {
  try {
    // Upsert: if (address, context) already exists, increment count + bump last_seen_at.
    // Otherwise insert a fresh row.
    const trimmed = address.trim().slice(0, 500);
    const { error } = await client.rpc('zone_discoveries_upsert', {
      p_address: trimmed,
      p_context: context,
      p_city_hint: cityHint,
    });
    // If the RPC doesn't exist yet, fall back to a manual upsert.
    if (error?.code === 'PGRST202' || error?.message?.includes('not exist')) {
      await manualDiscoveryUpsert(client, trimmed, context, cityHint);
    } else if (error) {
      console.error('zone_discoveries_upsert error:', error);
    }
  } catch (err) {
    console.error('zone_discoveries log failed:', err);
  }
}

async function manualDiscoveryUpsert(
  client: SupabaseClient,
  address: string,
  context: 'pickup' | 'dropoff',
  cityHint: string | null,
): Promise<void> {
  const { data: existing } = await client
    .from('zone_discoveries')
    .select('id, count')
    .eq('context', context)
    .ilike('address', address)
    .maybeSingle();
  if (existing) {
    await client
      .from('zone_discoveries')
      .update({
        count: (existing.count ?? 0) + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await client.from('zone_discoveries').insert({
      address,
      context,
      city_hint: cityHint,
    });
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
  const today = new Date().toISOString().slice(0, 10);
  return `You are analyzing a rideshare/delivery driver screenshot taken in Quebec, Canada (Greater Montreal area: Montréal island, Laval, Longueuil / Rive-Sud).
${zoneCtx}
${catalog}
Today's date is ${today}. If the image does not display a specific date, use today.
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
    "date": "YYYY-MM-DD"|null,
    "pickup_address": string|null,
    "dropoff_address": string|null,
    "pickup_zone_id": string|null,
    "dropoff_zone_id": string|null
  },
  "matched_zone_id": string|null
}

Rules:
- matched_zone_id: read any text/labels visible on the image (street names, borough names, neighbourhoods, landmarks, transit stations, bridges). If you can locate the screenshot inside one of the catalog entries above, return its EXACT id from the catalog. If unsure, return null — DO NOT invent ids.
- pickup_address / dropoff_address: copy the addresses verbatim from the image if present (Lyft/Uber/DoorDash trip cards usually show origin near the green/pickup pin and destination near the red/drop pin). Otherwise null.
- pickup_zone_id / dropoff_zone_id: match each address to the closest entry in the catalog above. Return its EXACT id. If you cannot confidently match, return null — DO NOT invent ids.
- zones_detected: list visible demand zones/areas in the image (empty array if none)
- recommended_target: "demand" for heatmaps/zone screenshots, "shift" for earnings/trip summaries, "mileage" for distance/mileage reports, "daily" for daily summaries, "profit" for profit/loss screens
- extracted_data: populate only fields visually present in the image; null otherwise
- date: NEVER use a year prior to 2025 unless the image explicitly shows an older year. If only a month/day is visible without year, use ${today.slice(0, 4)}.
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

const FALLBACK_NOTES: Record<NonNullable<AnalysisResult['fallback_reason']>, string> = {
  missing_image_url: 'Aucune image reçue par le serveur.',
  missing_api_key: 'Clé API Gemini manquante côté serveur — contacte le support.',
  image_fetch_failed: 'Le serveur n\'a pas pu télécharger le screenshot (URL expirée).',
  gemini_call_failed: 'L\'API Gemini a refusé la requête (clé invalide, quota, ou modèle indisponible).',
  gemini_invalid_json: 'Gemini a répondu mais dans un format inattendu.',
};

function fallbackAnalysis(
  zoneName: string | undefined,
  reason: NonNullable<AnalysisResult['fallback_reason']>,
): AnalysisResult {
  return {
    zones_detected: [],
    overall_demand: 'low',
    time_context: null,
    notes: FALLBACK_NOTES[reason],
    recommended_target: 'unknown',
    extracted_data: {
      earnings: null,
      tips: null,
      distance_km: null,
      hours_worked: null,
      trips_count: null,
      date: null,
    },
    is_fallback: true,
    fallback_reason: reason,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
