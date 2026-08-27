// supabase/functions/quick-log-trip/index.ts
// ──────────────────────────────────────────────────────────────────────────
// Zero-UI trip capture: lets MacroDroid (or any script) POST a fare the
// instant a ride ends, without opening the PWA. The "Aujourd'hui" tab reads
// 0 $ in practice not because of a query bug but because nobody logs trips
// mid-shift through the UI — this endpoint logs them in the background
// while Lyft/Hypra/Imoove stays on screen.
//
// POST body: { amount: number, tips?: number, platform?: string, notes?: string }
// Auth: header  Authorization: Bearer <QUICK_LOG_API_KEY>
//   A dedicated shared secret, NOT the Supabase anon/service key — MacroDroid
//   can't run a real Supabase Auth session, so this is a plain API-key check
//   done in-function instead of --verify-jwt. Deploy with:
//     supabase functions deploy quick-log-trip --no-verify-jwt
//   Secrets required (supabase secrets set ...):
//     QUICK_LOG_API_KEY         — random token, given only to MacroDroid/script
//     QUICK_LOG_DRIVER_USER_ID  — the driver's auth.users.id (single-driver app,
//                                 so trips_user_isolation RLS still resolves
//                                 correctly when read back through the PWA)
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

const ALLOWED_PLATFORMS = ['lyft', 'hypra', 'imoove'];

interface QuickLogBody {
  amount?: number;
  tips?: number;
  platform?: string;
  notes?: string;
}

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
  if (req.method !== 'POST') {
    return json({ error: 'POST requis' }, 405);
  }

  try {
    const expectedKey = Deno.env.get('QUICK_LOG_API_KEY');
    const driverUserId = Deno.env.get('QUICK_LOG_DRIVER_USER_ID');
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!expectedKey || !driverUserId || !url || !serviceKey) {
      return json({ error: 'Serveur mal configuré (secrets manquants)' }, 500);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const providedKey = authHeader.replace(/^Bearer\s+/i, '');
    if (providedKey !== expectedKey) {
      return json({ error: 'Non autorisé' }, 401);
    }

    const client = createClient(url, serviceKey);

    if (await isRateLimited(client, 'quick-log-trip', 30)) {
      return json({ error: 'Trop de requêtes, réessaie dans une minute' }, 429);
    }

    const body: QuickLogBody = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: 'amount requis (nombre positif)' }, 400);
    }
    const tips = Number.isFinite(Number(body.tips)) ? Number(body.tips) : 0;
    const platform =
      typeof body.platform === 'string' &&
      ALLOWED_PLATFORMS.includes(body.platform.toLowerCase())
        ? body.platform.toLowerCase()
        : null;
    const notes =
      typeof body.notes === 'string' && body.notes.trim()
        ? body.notes.slice(0, 500)
        : 'Quick log (MacroDroid)';

    const now = new Date().toISOString();
    const { data, error } = await client
      .from('trips')
      .insert({
        user_id: driverUserId,
        earnings: amount,
        tips,
        platform,
        started_at: now,
        ended_at: now,
        source: 'real',
        notes,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    return json({ ok: true, trip_id: data.id });
  } catch (err) {
    console.error('quick-log-trip error:', err);
    captureEdgeException(err, 'quick-log-trip', {
      url: req.url,
      method: req.method,
    });
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
