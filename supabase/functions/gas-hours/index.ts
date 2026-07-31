// supabase/functions/gas-hours/index.ts
// ──────────────────────────────────────────────────────────────────────────────
// Edge Function: horaires d'ouverture des stations-service.
//
// La Régie de l'énergie (essencequebec.com) publie les prix mais aucun horaire.
// Vérifié le 2026-07-31 : OpenStreetMap ne couvre que ~5% des stations du Grand
// Montréal et TomTom 0%. Mapbox Search Box (`metadata.open_hours`) couvre ~80%,
// et le projet a déjà un token Mapbox — c'est la source retenue.
//
// Le client envoie les stations candidates (bornées : ~40 max, celles qui
// peuvent réellement occuper un slot), pas les 2400 stations du Québec.
//
// Body:  { stations: [{ lat, lng, address?, brand?, city? }] }
// Réponse: { hours: { [station_key]: { periods, source, resolved_at } | null },
//            resolved: number, cached: number }
// ──────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

/** Au-delà, on retente une résolution : les horaires réguliers bougent peu. */
const CACHE_TTL_DAYS = 30;
/** Garde-fou : une requête ne peut pas déclencher plus d'appels Mapbox que ça. */
const MAX_LOOKUPS_PER_REQUEST = 12;
/** Un POI Mapbox plus loin que ça n'est pas la même station. */
const MAX_MATCH_DISTANCE_M = 250;
/** Rayon d'un groupe de stations couvert par un seul appel `category`. */
const CLUSTER_RADIUS_M = 3_000;
/** `category` renvoie au plus 25 POI par appel. */
const CATEGORY_LIMIT = 25;

interface StationInput {
  lat: number;
  lng: number;
  address?: string;
  brand?: string;
  city?: string;
}

interface HoursPoint {
  day: number;
  time: string;
}

interface HoursPeriod {
  open: HoursPoint;
  close?: HoursPoint | null;
}

interface CacheRow {
  station_key: string;
  lat: number;
  lng: number;
  address: string | null;
  brand: string | null;
  city: string | null;
  periods: { periods: HoursPeriod[] } | null;
  matched_name: string | null;
  match_distance_m: number | null;
  source: string;
  resolved_at: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function stationKey(s: { lat: number; lng: number }): string {
  return `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidPeriod(p: unknown): p is HoursPeriod {
  if (typeof p !== 'object' || p === null) return false;
  const open = (p as { open?: unknown }).open;
  if (typeof open !== 'object' || open === null) return false;
  const { day, time } = open as { day?: unknown; time?: unknown };
  return (
    typeof day === 'number' && day >= 0 && day <= 6 &&
    typeof time === 'string' && /^\d{3,4}$/.test(time)
  );
}

interface MapboxPoi {
  name: string | null;
  lat: number;
  lng: number;
  periods: HoursPeriod[] | null;
}

interface Resolution {
  periods: HoursPeriod[] | null;
  matchedName: string | null;
  distanceM: number | null;
}

/**
 * Recherche par catégorie autour d'un point : renvoie les stations-service
 * voisines avec leurs horaires.
 *
 * On utilise `category/gas_station` et non `forward` : mesuré le 2026-07-31,
 * le forward search ne retrouve quasiment jamais la station à partir de son
 * enseigne + adresse EQC (0 résultat sur 9 stations testées), alors que la
 * recherche par catégorie retourne le bon POI avec `open_hours` dans ~80% des
 * cas. Bonus : un appel couvre tout un quartier au lieu d'une seule station.
 */
async function fetchNearbyFuelPois(
  lat: number,
  lng: number,
  token: string
): Promise<MapboxPoi[]> {
  const params = new URLSearchParams({
    access_token: token,
    proximity: `${lng},${lat}`,
    limit: String(CATEGORY_LIMIT),
    language: 'fr',
  });

  const res = await fetch(
    `https://api.mapbox.com/search/searchbox/v1/category/gas_station?${params.toString()}`
  );
  if (!res.ok) throw new Error(`mapbox ${res.status}`);

  const body = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: {
        name?: string;
        metadata?: { open_hours?: { periods?: unknown[] } };
      };
    }>;
  };

  const pois: MapboxPoi[] = [];
  for (const feature of body.features ?? []) {
    const coords = feature.geometry?.coordinates;
    if (!coords) continue;
    const raw = feature.properties?.metadata?.open_hours?.periods;
    const periods = Array.isArray(raw) ? raw.filter(isValidPeriod) : [];
    pois.push({
      name: feature.properties?.name ?? null,
      lat: coords[1],
      lng: coords[0],
      periods: periods.length > 0 ? periods : null,
    });
  }
  return pois;
}

/**
 * Regroupe les stations à résoudre en paquets couverts par un seul appel
 * Mapbox — une dizaine de stations d'un même secteur tiennent dans une seule
 * recherche de proximité.
 */
function clusterStations(stations: StationInput[]): StationInput[][] {
  const clusters: StationInput[][] = [];
  for (const station of stations) {
    const hit = clusters.find(
      (c) => haversineM(c[0].lat, c[0].lng, station.lat, station.lng) <= CLUSTER_RADIUS_M
    );
    if (hit) hit.push(station);
    else clusters.push([station]);
  }
  return clusters;
}

/** Associe une station EQC au POI Mapbox le plus proche, s'il est assez près. */
function matchStation(station: StationInput, pois: MapboxPoi[]): Resolution {
  let best: { poi: MapboxPoi; distanceM: number } | null = null;
  for (const poi of pois) {
    const distanceM = haversineM(station.lat, station.lng, poi.lat, poi.lng);
    if (distanceM > MAX_MATCH_DISTANCE_M) continue;
    if (!best || distanceM < best.distanceM) best = { poi, distanceM };
  }
  if (!best) return { periods: null, matchedName: null, distanceM: null };
  return {
    periods: best.poi.periods,
    matchedName: best.poi.name,
    distanceM: best.distanceM,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const mapboxToken = Deno.env.get('MAPBOX_TOKEN');
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Serveur mal configuré (clés Supabase manquantes)' }, 500);
    }

    const body = (await req.json().catch(() => ({}))) as { stations?: StationInput[] };
    const stations = (body.stations ?? []).filter(
      (s) => typeof s?.lat === 'number' && typeof s?.lng === 'number'
    );
    if (stations.length === 0) {
      return json({ hours: {}, resolved: 0, cached: 0 });
    }

    const byKey = new Map<string, StationInput>();
    for (const s of stations) byKey.set(stationKey(s), s);
    const keys = [...byKey.keys()];

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: rows, error } = await supabase
      .from('gas_station_hours')
      .select('*')
      .in('station_key', keys);
    if (error) throw error;

    const cache = new Map<string, CacheRow>();
    for (const row of (rows ?? []) as CacheRow[]) cache.set(row.station_key, row);

    const staleBefore = Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    const staleStations = keys
      .filter((k) => {
        const row = cache.get(k);
        return !row || new Date(row.resolved_at).getTime() < staleBefore;
      })
      .map((k) => byKey.get(k))
      .filter((s): s is StationInput => Boolean(s));

    const upserts: Array<Record<string, unknown>> = [];
    if (mapboxToken) {
      const clusters = clusterStations(staleStations).slice(0, MAX_LOOKUPS_PER_REQUEST);
      for (const cluster of clusters) {
        try {
          const pois = await fetchNearbyFuelPois(cluster[0].lat, cluster[0].lng, mapboxToken);
          for (const station of cluster) {
            const key = stationKey(station);
            const resolved = matchStation(station, pois);
            const row = {
              station_key: key,
              lat: station.lat,
              lng: station.lng,
              address: station.address ?? null,
              brand: station.brand ?? null,
              city: station.city ?? null,
              periods: resolved.periods ? { periods: resolved.periods } : null,
              matched_name: resolved.matchedName,
              match_distance_m: resolved.distanceM,
              source: 'mapbox',
              resolved_at: new Date().toISOString(),
            };
            upserts.push(row);
            cache.set(key, row as unknown as CacheRow);
          }
        } catch (err) {
          // Un échec ponctuel ne doit pas priver le client des horaires en cache.
          captureEdgeException(err, 'gas-hours:resolve');
        }
      }
      if (upserts.length > 0) {
        const { error: upsertError } = await supabase
          .from('gas_station_hours')
          .upsert(upserts, { onConflict: 'station_key' });
        if (upsertError) captureEdgeException(upsertError, 'gas-hours:upsert');
      }
    }

    const hours: Record<string, { periods: HoursPeriod[] } | null> = {};
    for (const key of keys) {
      const row = cache.get(key);
      hours[key] = row?.periods ?? null;
    }

    return new Response(
      JSON.stringify({
        hours,
        resolved: upserts.length,
        cached: keys.length - upserts.length,
        mapbox_configured: Boolean(mapboxToken),
      }),
      {
        headers: {
          ...corsHeaders,
          'content-type': 'application/json',
          'cache-control': 'private, max-age=300',
        },
      }
    );
  } catch (err) {
    captureEdgeException(err, 'gas-hours');
    const msg = err instanceof Error ? err.message : 'unknown';
    return json({ error: msg }, 502);
  }
});
