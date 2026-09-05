// supabase/functions/event-sync/index.ts
// ──────────────────────────────────────────────────────────────────────────────
// Edge Function: pulls upcoming shows for a fixed allowlist of Montréal/Laval/
// Rive-Sud venues from the Ticketmaster Discovery API and upserts them into
// public.events, so the existing "sortie prévue" badge (EventBoostBadge.tsx,
// via zoneEventBadge in useDemandScores.ts) and score-calculator's
// computeEventBoost both pick them up automatically — neither needs to change,
// they already read straight from this table.
//
// Ticketmaster (like every public venue calendar) publishes start times, not
// end times, so end_at is estimated from the event's classification (hockey
// games run longer than a comedy set) — see eventSync.ts.
//
// Triggered by:
//   - pg_cron every 6h (see 20260906000000_events_external_id_and_sync_cron.sql)
//   - Manual call: supabase.functions.invoke('event-sync')
//
// Secrets required (set via `supabase secrets set`):
//   TICKETMASTER_KEY — Discovery API key (same value as VITE_TICKETMASTER_KEY,
//                       just also declared server-side; Edge Functions don't
//                       read Vite's client env)
// Auto-injected by Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ──────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';
import {
  dedupeEventRows,
  SEARCH_MARKETS,
  type TmApiEvent,
  type TmApiResponse,
} from './eventSync.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

async function fetchMarketEvents(
  apiKey: string,
  lat: number,
  lon: number
): Promise<TmApiEvent[]> {
  const url =
    `https://app.ticketmaster.com/discovery/v2/events.json` +
    `?apikey=${apiKey}&latlong=${lat},${lon}&radius=30&unit=km&size=100&sort=date,asc`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`Ticketmaster fetch failed for ${lat},${lon}: ${res.status}`);
    return [];
  }
  const data = (await res.json()) as TmApiResponse;
  return data?._embedded?.events ?? [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('TICKETMASTER_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'TICKETMASTER_KEY not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const eventLists = await Promise.all(
      Object.values(SEARCH_MARKETS).map((m) => fetchMarketEvents(apiKey, m.lat, m.lon))
    );
    const rows = dedupeEventRows(eventLists);

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, synced: 0, message: 'No tracked-venue events found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // boost_multiplier is deliberately omitted — its column default (1.0) lets
    // the existing events_set_boost_multiplier trigger auto-tier it from
    // capacity on insert, and leaving it out of the UPDATE SET on a repeat
    // sync preserves any value a curator hand-tuned since.
    const { error } = await supabase
      .from('events')
      .upsert(rows, { onConflict: 'external_id' });

    if (error) throw new Error(`Events upsert failed: ${error.message}`);

    return new Response(
      JSON.stringify({ success: true, synced: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('event-sync error:', message);
    captureEdgeException(err, 'event-sync', { url: req.url, method: req.method });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
