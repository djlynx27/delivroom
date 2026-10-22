// supabase/functions/gtfs-alerts-sync/index.ts
// ──────────────────────────────────────────────────────────────────────────────
// Edge Function: polls the Chrono SAEIV GTFS-Realtime feeds (Exo TRAINS, RTL,
// CITLA) for service alerts and major trip delays, maps any that hit a
// tracked terminus (see TERMINUS_ALLOWLIST in gtfsAlerts.ts) to the nearest
// Delivroom zone, and upserts them into public.events — the same table
// event-sync feeds, so score-calculator's existing zone-radius boost math
// picks up "gare en panne" the same way it already picks up concerts.
//
// Rate-limit contract (Chrono SAEIV): max 1 request / 5s, and this repo's
// own constraint of >=60s between polls of the same agency. Both are
// satisfied by construction: requests are sequential with a 5s pause
// between them (REQUEST_SPACING_MS below), and the whole 6-request run
// (3 agencies x {alert, TripUpdate}) is triggered by pg_cron no more than
// once every 2 minutes (see the matching migration) — nothing else calls
// this function on a tighter cadence.
//
// VehiclePosition is deliberately not fetched: the business goal (detect
// disruptions, not track live buses) is fully covered by alert +
// TripUpdate, and fetching a feed nothing reads would just burn budget
// against the same rate limit.
//
// Triggered by:
//   - pg_cron every 2 min (see 20260906000002_schedule_gtfs_alerts_sync.sql)
//   - Manual call: supabase.functions.invoke('gtfs-alerts-sync')
//
// Secrets required (set via `supabase secrets set`, NOT read from
// .env.local — Edge Functions don't see Vite's client env):
//   CHRONO_SAEIV_PRIMARY_KEY   — Ocp-Apim-Subscription-Key, tried first
//   CHRONO_SAEIV_SECONDARY_KEY — retried once on 401/403/429 from the primary
// Auto-injected by Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ──────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import GtfsRealtimeBindings from 'npm:gtfs-realtime-bindings@2.2.0';
import { captureEdgeException } from '../_shared/sentry.ts';
import {
  feedToEventRows,
  type Agency,
  type GtfsFeedMessage,
  type ZoneRow,
} from './gtfsAlerts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const BASE_URL = 'https://exo.chrono-saeiv.com/api/opendata/v1';
const AGENCIES: Agency[] = ['TRAINS', 'RTL', 'CITLA'];
const ENDPOINT_TYPES = ['alert', 'TripUpdate'] as const;
const REQUEST_SPACING_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tries the primary key; on an auth/rate-limit status, retries once with
 * the secondary key (Azure APIM's two keys exist exactly for this — rotate
 * or fail over without downtime). */
async function fetchFeedWithFailover(
  agency: Agency,
  type: (typeof ENDPOINT_TYPES)[number],
  primaryKey: string,
  secondaryKey: string | undefined
): Promise<GtfsFeedMessage | null> {
  const res = await fetch(`${BASE_URL}/${agency}/${type}`, {
    headers: { 'Ocp-Apim-Subscription-Key': primaryKey, Accept: 'application/x-protobuf' },
  });
  if (res.ok) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf) as unknown as GtfsFeedMessage;
  }

  console.warn(`[gtfs-alerts-sync] ${agency}/${type} primary key → HTTP ${res.status}`);
  if (!secondaryKey || ![401, 403, 429].includes(res.status)) return null;

  const retry = await fetch(`${BASE_URL}/${agency}/${type}`, {
    headers: { 'Ocp-Apim-Subscription-Key': secondaryKey, Accept: 'application/x-protobuf' },
  });
  if (!retry.ok) {
    console.warn(`[gtfs-alerts-sync] ${agency}/${type} secondary key → HTTP ${retry.status}`);
    return null;
  }
  const buf = new Uint8Array(await retry.arrayBuffer());
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf) as unknown as GtfsFeedMessage;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const primaryKey = Deno.env.get('CHRONO_SAEIV_PRIMARY_KEY');
    if (!primaryKey) {
      return new Response(
        JSON.stringify({ error: 'CHRONO_SAEIV_PRIMARY_KEY not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }
    const secondaryKey = Deno.env.get('CHRONO_SAEIV_SECONDARY_KEY');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: zones, error: zonesErr } = await supabase
      .from('zones')
      .select('id, city_id, latitude, longitude');
    if (zonesErr) throw new Error(`zones fetch failed: ${zonesErr.message}`);

    const nowMs = Date.now();
    const allRows = [];
    let requestCount = 0;

    for (const agency of AGENCIES) {
      for (const type of ENDPOINT_TYPES) {
        if (requestCount > 0) await sleep(REQUEST_SPACING_MS);
        requestCount++;

        // Network-level failures (TLS, DNS, connect) throw from fetch, unlike HTTP
        // error statuses which fetchFeedWithFailover already turns into null.
        // Degrade the same way so one unreachable feed doesn't abort the other
        // five (Sentry 7794668871: a bad upstream cert failed the whole sync).
        let feed: GtfsFeedMessage | null = null;
        try {
          feed = await fetchFeedWithFailover(agency, type, primaryKey, secondaryKey);
        } catch (feedErr) {
          console.warn(`[gtfs-alerts-sync] ${agency}/${type} unreachable:`, feedErr);
        }
        if (!feed) continue;

        allRows.push(...feedToEventRows(feed, agency, nowMs, zones as ZoneRow[]));
      }
    }

    // De-dupe once more across agencies/types (an alert can theoretically
    // repeat verbatim across feeds) before upserting.
    const byExternalId = new Map(allRows.map((r) => [r.external_id, r]));
    const rows = Array.from(byExternalId.values());

    if (rows.length > 0) {
      // boost_multiplier omitted on purpose — its column default (1.0) lets
      // events_set_boost_multiplier auto-tier it from `capacity`, same as
      // event-sync.
      const { error } = await supabase
        .from('events')
        .upsert(rows, { onConflict: 'external_id' });
      if (error) throw new Error(`events upsert failed: ${error.message}`);
    }

    return new Response(
      JSON.stringify({ success: true, synced: rows.length, feedsPolled: requestCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[gtfs-alerts-sync]', message);
    captureEdgeException(err, 'gtfs-alerts-sync', { url: req.url, method: req.method });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
