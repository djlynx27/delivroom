// supabase/functions/gas-prices/index.ts
// ──────────────────────────────────────────────────────────────────────────────
// Edge Function: proxy + normalize Régie de l'énergie gas prices.
//
// Source: https://map.essencequebec.com — the public EQC map fetches station
// data from /regie/stations after grabbing a per-session token from a <meta>
// tag on the homepage. We replicate that flow server-side because:
//   1. The endpoint requires an x-requested-with header (browser CORS would
//      send it but the cookie+token pairing is awkward to obtain client-side)
//   2. Prices update roughly hourly — caching the payload keeps response time
//      sub-second on the PWA and avoids hammering EQC.
//
// Response shape:
//   { stations: GasStation[], updated_at: string, source: 'essencequebec.com' }
// ──────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { captureEdgeException } from '../_shared/sentry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const HOME_URL = 'https://map.essencequebec.com/';
const DATA_URL = 'https://map.essencequebec.com/regie/stations';

interface RawStation {
  '1': string; // name
  '2': string; // brand
  '3': string; // address
  '4': number; // lat
  '5': number; // lng
  regulier?: number;
  super?: number;
  diesel?: number;
}

interface GasStation {
  name: string;
  brand: string;
  address: string;
  lat: number;
  lng: number;
  /** prices in CAD/L (e.g. 1.629), null when not posted */
  regular: number | null;
  super: number | null;
  diesel: number | null;
}

interface CacheEntry {
  payload: { stations: GasStation[]; updated_at: string; source: string };
  expires: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — EQC publishes hourly
let cache: CacheEntry | null = null;

async function fetchToken(): Promise<{ token: string; cookie: string }> {
  const res = await fetch(HOME_URL, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`home ${res.status}`);
  const html = await res.text();
  const m = html.match(/meta name="token" content="([^"]+)"/);
  if (!m) throw new Error('token meta not found');
  const setCookie = res.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(/,(?=\s*[A-Za-z_])/).map((c) => c.split(';')[0].trim()).join('; ');
  return { token: m[1], cookie };
}

async function fetchStations(): Promise<GasStation[]> {
  const { token, cookie } = await fetchToken();
  const res = await fetch(DATA_URL, {
    headers: {
      'User-Agent': UA,
      'x-requested-with': 'XMLHttpRequest',
      Token: token,
      Cookie: cookie,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`stations ${res.status}`);
  const json = (await res.json()) as { data?: RawStation[] };
  const rows = json.data ?? [];
  // Prices come in cents (e.g. 162.9 = $1.629/L). Convert to dollars.
  const toDollars = (cents: number | undefined): number | null =>
    typeof cents === 'number' && cents > 0
      ? Math.round(cents) / 100
      : null;
  return rows
    .filter((r) => typeof r['4'] === 'number' && typeof r['5'] === 'number')
    .map<GasStation>((r) => ({
      name: r['1'] ?? '',
      brand: (r['2'] ?? '').trim() || 'Inconnu',
      address: r['3'] ?? '',
      lat: r['4'],
      lng: r['5'],
      regular: toDollars(r.regulier),
      super: toDollars(r.super),
      diesel: toDollars(r.diesel),
    }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const now = Date.now();
    if (!cache || cache.expires < now) {
      const stations = await fetchStations();
      cache = {
        payload: {
          stations,
          updated_at: new Date().toISOString(),
          source: 'essencequebec.com',
        },
        expires: now + CACHE_TTL_MS,
      };
    }
    return new Response(JSON.stringify(cache.payload), {
      headers: {
        ...corsHeaders,
        'content-type': 'application/json',
        'cache-control': 'public, max-age=900',
      },
    });
  } catch (err) {
    captureEdgeException(err, 'gas-prices');
    const msg = err instanceof Error ? err.message : 'unknown';
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
