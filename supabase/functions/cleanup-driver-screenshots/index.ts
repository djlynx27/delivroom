// supabase/functions/cleanup-driver-screenshots/index.ts
// ──────────────────────────────────────────────────────────────────────────
// Deletes driver-screenshots Storage objects for screenshot_uploads rows
// analyzed >48h ago -- the structured Gemini output already lives in
// analysis_result, so the raw image is redundant once processed. Runs via
// pg_cron (see 20260911170000_cleanup_driver_screenshots.sql), same
// net.http_post pattern as event-sync/surge-detector.
//
// Storage objects can't be deleted with a plain SQL DELETE on this project
// (storage.protect_delete() trigger raises 42501 -- "Use the Storage API
// instead"), hence a dedicated function instead of a plpgsql cleanup like
// cleanup_old_platform_signals/cleanup_expired_event_zones.
//
// Auto-injected by Supabase runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ──────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// Storage API remove() call stays well under the Edge Function's 20s budget.
const BATCH_SIZE = 500;

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
    return await handleRequest();
  } catch (err) {
    console.error('cleanup-driver-screenshots error:', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function handleRequest(): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Serveur mal configuré (Supabase env manquant)' }, 500);
  }
  const client = createClient(supabaseUrl, serviceKey);

  const { data: rows, error: selectError } = await client
    .from('screenshot_uploads')
    .select('id, file_path')
    .not('analyzed_at', 'is', null)
    .is('storage_purged_at', null)
    .lt('analyzed_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    .order('analyzed_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (selectError) {
    return json({ error: selectError.message }, 500);
  }
  const candidates = (rows ?? []).filter(
    (r): r is { id: string; file_path: string } =>
      typeof r.file_path === 'string' && r.file_path.length > 0
  );

  if (candidates.length === 0) {
    return json({ ok: true, deleted: 0 });
  }
  const paths = candidates.map((r) => r.file_path);
  const ids = candidates.map((r) => r.id);

  const { data: removed, error: removeError } = await client.storage
    .from('driver-screenshots')
    .remove(paths);

  if (removeError) {
    return json({ error: removeError.message }, 500);
  }

  // Mark these rows purged so a re-run (cron tomorrow, or a retried call
  // today) advances to the next batch instead of re-selecting the same
  // ones — the screenshot_uploads row itself stays as the audit record.
  const { error: markError } = await client
    .from('screenshot_uploads')
    .update({ storage_purged_at: new Date().toISOString() })
    .in('id', ids);
  if (markError) console.error('cleanup-driver-screenshots: storage_purged_at update failed', markError);

  return json({ ok: true, deleted: removed?.length ?? 0, candidates: paths.length });
}
