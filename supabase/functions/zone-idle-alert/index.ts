// supabase/functions/zone-idle-alert/index.ts
// ──────────────────────────────────────────────────────────────────────────
// Thin authenticated proxy in front of push-notifier for the "15 min dead
// time" alert. push-notifier itself only accepts a service_role bearer (by
// design -- see its own header comment: the anon key ships in the PWA bundle
// so it can't be enough to trigger a push to every driver), and CLAUDE.md
// forbids service_role client-side. This function runs with verify_jwt:true
// (the Supabase gateway rejects an unauthenticated call before this handler
// ever runs) and relays to push-notifier server-to-server, same pattern
// surge-detector already uses.
//
// Called from DeadTimeTimer.tsx once per dead-time streak, when elapsed
// idle time in a zone with no strong demand signal crosses 15 minutes.
//
// Auto-injected by Supabase runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ──────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';
import { isRateLimited } from '../_shared/rateLimit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  zoneName?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildAlertMessage(zoneName: string | null): { title: string; body: string } {
  return {
    title: 'Temps mort — 15 min',
    body: zoneName
      ? `Aucun signal fort à ${zoneName} depuis 15 min — repositionne-toi.`
      : 'Aucun signal fort depuis 15 min — repositionne-toi.',
  };
}

async function relayToPushNotifier(
  supabaseUrl: string,
  serviceKey: string,
  zoneName: string | null
): Promise<number> {
  const { title, body } = buildAlertMessage(zoneName);
  const pushResponse = await fetch(`${supabaseUrl}/functions/v1/push-notifier`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify({ title, body, url: '/', tag: 'zone-idle' }),
  });
  if (!pushResponse.ok) {
    throw new Error(`push-notifier failed with status ${pushResponse.status}`);
  }
  const result = (await pushResponse.json()) as { delivered?: number };
  return result.delivered ?? 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Serveur mal configuré (Supabase env manquant)' }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // Identity is already enforced by verify_jwt:true (gateway-level) -- this
    // guard is only against a client bug/retry loop spamming pushes to a
    // single device, same 1-per-15-min ceiling the feature itself implies.
    if (await isRateLimited(supabase, 'zone-idle-alert', 4)) {
      return json({ ok: true, skipped: true, reason: 'rate_limited' });
    }

    const body: RequestBody = await req.json().catch(() => ({}));
    const zoneName = body.zoneName?.trim() || null;
    const delivered = await relayToPushNotifier(supabaseUrl, serviceKey, zoneName);
    return json({ ok: true, delivered });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('zone-idle-alert error:', message);
    captureEdgeException(err, 'zone-idle-alert', { url: req.url, method: req.method });
    return json({ error: message }, 500);
  }
});
