// supabase/functions/zone-idle-alert/index.ts
// ──────────────────────────────────────────────────────────────────────────
// Thin proxy in front of push-notifier for the "15 min dead time" alert.
// push-notifier itself only accepts a service_role bearer (by design -- see
// its own header comment: the anon key ships in the PWA bundle so it can't
// be enough to trigger a push to every driver), and CLAUDE.md forbids
// service_role client-side, so this relays server-to-server, same pattern
// surge-detector already uses.
//
// verify_jwt:true on this function is NOT a real authorization boundary --
// this app signs every visitor in anonymously (see useAnonAuth.ts /
// supabase.auth.signInAnonymously()), so any anonymous PWA visitor holds a
// JWT that passes it. The actual scoping is `endpoint`: the caller must
// supply their OWN already-registered push_subscriptions.endpoint (obtained
// client-side from pushManager.getSubscription(), see zoneIdlePush.ts), and
// push-notifier is only ever called with that exact-match filter -- never
// omit it, or an anonymous caller could fan this out to every driver's
// subscription. zoneName is free text from that same untrusted caller and
// is sanitized (see ZONE_NAME_PATTERN) before it's ever reflected into a
// notification body, closing the content-injection/phishing vector a raw
// interpolation would otherwise open.
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
  /** The caller's OWN push subscription endpoint (from their already-
   * registered pushManager.getSubscription()). Required — without it this
   * function must never fall through to push-notifier's broadcast-all
   * behavior (see that function's driver_id/endpoint filter comment). */
  endpoint?: string;
  /** Must accompany endpoint — see push-notifier's `auth` field comment.
   * Proves the caller owns this subscription, not just that they've seen
   * its (less-secret) endpoint URL somewhere. */
  auth?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Letters (incl. accents), digits, spaces and a small set of punctuation
// actually seen in zone names ("Gare Centrale", "CF Carrefour Laval") — no
// URLs, no markup, nothing that could turn this into a phishing/social-
// engineering vector once it's pushed as a trusted native notification.
// Anything else (or a caller-supplied name that doesn't match — this is
// attacker-controlled input from an anonymously-authenticated request, see
// useAnonAuth.ts) silently drops to a generic message rather than reflecting
// unvalidated text.
const ZONE_NAME_PATTERN = /^[\p{L}0-9 '\-.()/]{1,40}$/u;

function sanitizeZoneName(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || !ZONE_NAME_PATTERN.test(trimmed)) return null;
  return trimmed;
}

// Real push endpoints are always an https URL from a known push service
// (fcm.googleapis.com, etc.) — this is just a sanity bound, not the actual
// authorization (the endpoint eq-match against push_subscriptions below is
// what actually scopes delivery to one real, already-registered device).
function isPlausibleEndpoint(raw: string | undefined): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 500 && raw.startsWith('https://');
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
  zoneName: string | null,
  endpoint: string,
  auth: string
): Promise<number> {
  const { title, body } = buildAlertMessage(zoneName);
  const pushResponse = await fetch(`${supabaseUrl}/functions/v1/push-notifier`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    // endpoint+auth scope delivery to exactly this one already-registered
    // device — NEVER omit these, or an anonymously-authenticated caller
    // (anyone who opens the public PWA, see useAnonAuth.ts) could fan this
    // out to every driver's push_subscriptions row.
    body: JSON.stringify({ title, body, url: '/', tag: 'zone-idle', endpoint, auth }),
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

    const body: RequestBody = await req.json().catch(() => ({}));
    if (!isPlausibleEndpoint(body.endpoint) || !body.auth) {
      return json({ error: 'endpoint and auth required' }, 400);
    }

    // Keyed per-endpoint (not a single shared 'zone-idle-alert' bucket) so
    // one anonymous caller spamming a garbage/foreign endpoint can't exhaust
    // a global quota and deny the real driver's own alert.
    if (await isRateLimited(supabase, `zone-idle-alert:${body.endpoint}`, 4)) {
      return json({ ok: true, skipped: true, reason: 'rate_limited' });
    }

    const zoneName = sanitizeZoneName(body.zoneName);
    const delivered = await relayToPushNotifier(
      supabaseUrl,
      serviceKey,
      zoneName,
      body.endpoint,
      body.auth
    );
    return json({ ok: true, delivered });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('zone-idle-alert error:', message);
    captureEdgeException(err, 'zone-idle-alert', { url: req.url, method: req.method });
    return json({ error: message }, 500);
  }
});
