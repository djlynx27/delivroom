// Mapbox geocoding wrapper for the zone-discovery promote flow.
//
// Why Mapbox vs Google: Mapbox token is already configured for the heatmap
// (VITE_MAPBOX_TOKEN), no extra signup. Their /forward endpoint handles
// Quebec addresses well enough for our needs (driver pickup pins, never
// life-safety routing).

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

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
  if (!MAPBOX_TOKEN) {
    console.warn('[geocoding] VITE_MAPBOX_TOKEN not configured');
    return null;
  }
  const encoded = encodeURIComponent(address);
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json` +
    `?access_token=${MAPBOX_TOKEN}` +
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
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}
