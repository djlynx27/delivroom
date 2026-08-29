// Mapbox geocoding wrapper for the zone-discovery promote flow.
//
// Why Mapbox vs Google: Mapbox token is already configured for the heatmap
// (VITE_MAPBOX_TOKEN), no extra signup. Their /forward endpoint handles
// Quebec addresses well enough for our needs (driver pickup pins, never
// life-safety routing).

import { HOTSPOTS } from './hotspots';

function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase();
}

// Read at call time (not module scope) so tests can stub the env var —
// same pattern as services/routing/mapboxDirections.ts.
function getMapboxToken(): string | undefined {
  return import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  matchedAddress: string;
  confidence: number; // Mapbox relevance, 0..1
}

/**
 * Forward-geocode a free-form address. Returns null when Mapbox can't find
 * anything, the token is missing, or the network fails. The caller decides
 * whether to fall back to manual lat/lng entry.
 */
export async function forwardGeocode(
  address: string,
  countryHint = 'CA',
): Promise<GeocodeResult | null> {
  const token = getMapboxToken();
  if (!token) {
    console.warn('[geocoding] VITE_MAPBOX_TOKEN not configured');
    return null;
  }
  const encoded = encodeURIComponent(address);
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json` +
    `?access_token=${token}` +
    `&country=${countryHint}` +
    `&limit=1` +
    `&proximity=-73.5673,45.5017`; // bias toward downtown Montréal
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: {
        center?: [number, number];
        place_name?: string;
        relevance?: number;
      }[];
    };
    const first = data.features?.[0];
    if (!first?.center) return null;
    return {
      longitude: first.center[0],
      latitude: first.center[1],
      matchedAddress: first.place_name ?? address,
      confidence: first.relevance ?? 0,
    };
  } catch (err) {
    console.error('[geocoding] forwardGeocode failed:', err);
    return null;
  }
}

export interface GeocodeSuggestion {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

// Roughly Greater Montréal: Montréal, Laval, Longueuil/Rive-Sud, and the
// North Shore towns Delivroom tracks (Terrebonne, Sainte-Thérèse,
// Blainville, Boisbriand, Rosemère) — keeps autocomplete relevant and fast
// instead of Mapbox searching all of Quebec.
const MONTREAL_AREA_BBOX = '-74.10,45.20,-73.30,45.75';

// Coordinate precision (~10m) used to dedupe a local hub against the Mapbox
// result for the same place, so it isn't listed twice.
function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * Local-first match against Delivroom's curated major hubs (malls, arenas,
 * the airport, casino...). These outrank Mapbox results — a driver typing
 * "carrefour" or "centre bell" wants the venue, not a nearby street match —
 * and resolve instantly with no network round-trip.
 */
function matchLocalHubs(query: string): GeocodeSuggestion[] {
  const q = normalizeForMatch(query);
  if (q.length < 2) return [];
  return HOTSPOTS.filter((h) => normalizeForMatch(h.name).includes(q)).map((h) => ({
    id: `hotspot-${h.id}`,
    name: h.name,
    latitude: h.lat,
    longitude: h.lng,
  }));
}

/**
 * Live address/POI autocomplete for the Drive search box. Unlike
 * forwardGeocode (single best match for the zone-promote flow), this
 * returns up to 5 candidates so the driver picks the right one while typing.
 * Curated major hubs (see matchLocalHubs) are matched locally and always
 * ranked first, ahead of the Mapbox API results.
 */
export async function geocodeSuggestions(
  query: string,
  options: {
    signal?: AbortSignal;
    /** Driver's live GPS position — biases ranking toward nearby results.
     * Falls back to downtown Montréal when unavailable (no GPS fix yet). */
    proximity?: { latitude: number; longitude: number };
  } = {},
): Promise<GeocodeSuggestion[]> {
  const trimmed = query.trim();
  const localMatches = matchLocalHubs(trimmed);
  const token = getMapboxToken();
  if (!token || !trimmed) return localMatches;

  const proximity = options.proximity
    ? `${options.proximity.longitude},${options.proximity.latitude}`
    : '-73.5673,45.5017'; // downtown Montréal fallback

  const encoded = encodeURIComponent(trimmed);
  const params = new URLSearchParams({
    access_token: token,
    country: 'ca',
    // poi first so iconic venues (Centre Bell, Place Bell, YUL) rank ahead
    // of address matches.
    types: 'poi,address',
    autocomplete: 'true',
    limit: '5',
    bbox: MONTREAL_AREA_BBOX,
    proximity,
  });
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?${params}`;
  const redactedUrl = new URL(url);
  redactedUrl.searchParams.set('access_token', '<redacted>');
  console.log('[geocoding] Request URL:', redactedUrl.toString());

  try {
    const res = await fetch(url, { signal: options.signal });
    if (!res.ok) return localMatches;
    const data = (await res.json()) as {
      features?: { id?: string; center?: [number, number]; place_name?: string }[];
    };
    console.log('[geocoding] Mapbox raw response:', data);
    const localKeys = new Set(localMatches.map((h) => coordKey(h.latitude, h.longitude)));
    const mapboxMatches = (data.features ?? [])
      .filter((f): f is { id?: string; center: [number, number]; place_name: string } =>
        !!f.center && !!f.place_name,
      )
      .map((f) => ({
        id: f.id ?? `${f.center[0]},${f.center[1]}`,
        name: f.place_name,
        longitude: f.center[0],
        latitude: f.center[1],
      }))
      .filter((f) => !localKeys.has(coordKey(f.latitude, f.longitude)));
    return [...localMatches, ...mapboxMatches].slice(0, 5);
  } catch (err) {
    if (options.signal?.aborted) return [];
    console.error('[geocoding] geocodeSuggestions failed:', err);
    return localMatches;
  }
}

// Compact city keyword map (mirrors the edge function's guessCityId) so the
// promote dialog can auto-fill city_id from the address or Mapbox place_name
// when the discovery's city_hint is null — one less field the driver must know.
const CITY_KEYWORDS: Record<string, string[]> = {
  mtl: [
    'montreal', 'montréal', 'mtl', 'saint-laurent', 'st-laurent',
    'saint-léonard', 'st-léonard', 'verdun', 'lasalle', 'lachine', 'anjou',
    'westmount', 'outremont', 'ndg', 'côte-des-neiges', 'cote-des-neiges',
    'rivière-des-prairies', 'pointe-aux-trembles', 'hochelaga', 'rosemont',
    'villeray', 'plateau', 'ahuntsic', 'mercier', 'dorval', 'pierrefonds',
    'griffintown', 'sud-ouest',
  ],
  lvl: [
    'laval', 'chomedey', 'sainte-rose', 'ste-rose', 'sainte-dorothée',
    'duvernay', 'fabreville', 'auteuil', 'pont-viau', 'vimont',
  ],
  lng: [
    'longueuil', 'brossard', 'saint-hubert', 'st-hubert', 'saint-lambert',
    'st-lambert', 'greenfield park', 'boucherville', 'saint-bruno', 'st-bruno',
  ],
  trb: ['terrebonne', 'lachenaie', 'mascouche', 'la plaine'],
  sth: ['sainte-thérèse', 'ste-thérèse', 'ste therese', 'ste-therese'],
  blv: ['blainville'],
  bsb: ['boisbriand'],
  // Bois-des-Filion n'a plus de zones (aucun générateur de courses) : on
  // rattache son texte à Rosemère, la ville catalogue la plus proche.
  rsm: ['rosemère', 'rosemere', 'bois-des-filion', 'bois des filion'],
};

/**
 * Best-effort city_id guess from free-form address / place text. Returns the
 * catalog city id whose longest keyword appears, or null.
 */
export function guessCityIdFromText(text: string): string | null {
  const lower = text.toLowerCase();
  let bestCity: string | null = null;
  let bestLen = 0;
  for (const [cityId, keywords] of Object.entries(CITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (kw.length > bestLen && lower.includes(kw)) {
        bestCity = cityId;
        bestLen = kw.length;
      }
    }
  }
  return bestCity;
}

/**
 * Derives a short kebab-case slug suitable for use as the zone ID suffix.
 * "Boulevard Pitfield & Rue Valiquette, St-Laurent" -> "pitfield-valiquette"
 * Picks the two longest tokens that aren't generic prefixes.
 */
export function suggestZoneSlug(address: string): string {
  const stripped = address
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ');
  const STOP = new Set([
    'rue', 'boulevard', 'boul', 'bd', 'avenue', 'av', 'chemin',
    'ch', 'place', 'pl', 'st', 'saint', 'sainte', 'ste',
    'de', 'la', 'le', 'les', 'du', 'des', 'and',
    'laval', 'longueuil', 'montreal', 'mtl', 'quebec', 'qc', 'canada',
  ]);
  const tokens = stripped
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  return tokens.join('-') || 'zone';
}

/**
 * Suggest a readable zone name from the raw address (first segment before
 * the comma, title-cased).
 */
export function suggestZoneName(address: string): string {
  const head = address.split(',')[0]?.trim() ?? address;
  return head
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}
