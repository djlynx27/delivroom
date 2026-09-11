// supabase/functions/shift-tracker/index.ts
// ──────────────────────────────────────────────────────────────────────────────
// Edge Function: server-side shift (public.sessions) tracking so an active
// shift survives Android suspending/killing the PWA's JS in the background —
// a setInterval + localStorage timer alone can't recover from that, and
// worse, the GPS-based auto-shift-start (useAutoShift.ts) needs the PWA's JS
// running at all to even notice the driver started moving. MacroDroid runs as
// a real Android automation service (not a suspendable web page) and can fire
// this endpoint the instant Lyft Driver flips Online/Offline, independent of
// whether Delivroom's tab is even open.
//
// POST body: { action: 'START'|'STOP'|'HEARTBEAT'|'ADD_EARNINGS'|'STATUS',
//               lat?, lng?, amount?, platform? }
//
// MacroDroid alternative: send `event` with the raw Lyft Driver notification
// text instead of `action` and this resolves the verb itself (see
// resolveShiftAction in shiftLogic.ts), so the macro needs exactly one HTTP
// action for every trigger:
//   { "event": "{notification_text}", "timestamp": "{system_time_iso}" }
// "You're online" → START, "You're offline" → STOP, the 12-hour-limit
// notification → STOP recorded with stop_reason HOURS_LIMIT. An explicit
// `action` always wins over `event`.
//
// Auth (either one) — this is a *gate*, not a per-caller partition key (see
// "single-tenant bucket" below):
//   1. Header  Authorization: Bearer <SHIFT_TRACKER_API_KEY>  — the
//      MacroDroid path.
//   2. Header  Authorization: Bearer <supabase-session-access-token>  — a
//      real (anon or real) Supabase session, e.g. the PWA calling this
//      itself (supabase.functions.invoke attaches this automatically).
//
// SECURITY NOTE — single-tenant bucket, on purpose, and why it's safe here:
// every session this function reads/writes uses user_id = NULL, a shared
// bucket that only THIS service-role code (bypassing RLS entirely) can
// reach — public.sessions' RLS is strict `auth.uid() = user_id`, which
// NULL never satisfies, so no client holding just the public anon key can
// read or write it directly via PostgREST. An earlier version of this
// migration/function mistakenly made NULL a *client-visible* RLS bucket
// (`auth.uid() = user_id OR user_id IS NULL`) specifically so the PWA could
// read it directly too — that was a real IDOR (flagged by security review
// and fixed in 20260906000006_fix_sessions_rls_idor.sql): any holder of the
// public anon key could mutate the shared session directly. The fix moves
// all shared-bucket access behind this function instead: the PWA now calls
// STATUS/START/STOP here rather than querying public.sessions itself.
// The remaining trust boundary is intentional and narrower than before —
// anyone with a valid Supabase auth token (not just the anon key) can drive
// the one shared shift, matching this app's actual single-driver reality.
// Multi-driver support would need real per-account partitioning, not NULL.
//
// Deploy with: supabase functions deploy shift-tracker --no-verify-jwt
// Secrets required (supabase secrets set ...):
//   SHIFT_TRACKER_API_KEY — random token, given only to MacroDroid
// Auto-injected by Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ──────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';
import { isRateLimited } from '../_shared/rateLimit.ts';
import {
  elapsedSeconds,
  nearestZoneId,
  parseAmount,
  parseCoordinates,
  resolveShiftAction,
  resolveZoneTransition,
  type StopReason,
  type ZoneRow,
} from './shiftLogic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface RequestBody {
  action?: string;
  /** Raw Android notification text from MacroDroid, mapped to an action by
   * resolveShiftAction when `action` is absent. */
  event?: unknown;
  lat?: unknown;
  lng?: unknown;
  amount?: unknown;
  platform?: unknown;
}

interface SessionRow {
  id: number;
  user_id: string | null;
  started_at: string;
  ended_at: string | null;
  total_earnings: number | null;
  total_rides: number | null;
  total_hours: number | null;
  last_heartbeat_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  active_zone_id: string | null;
  notes: string | null;
}

/** Records WHY a shift ended in sessions.notes (a free-text column that
 * already exists — no migration needed for one enum-ish marker, and keeping
 * it parseable means a later migration can promote it to a real column
 * without losing the history). A 12h-limit cutoff is operationally different
 * from the driver choosing to go offline: Lyft forces it, so the next shift
 * can't simply be resumed, and the weekly planner should treat that block as
 * capped rather than as a short day. */
function stopNote(existing: string | null, reason: StopReason | undefined): string | null {
  if (!reason) return existing;
  const marker = `stop_reason=${reason}`;
  if (existing?.includes(marker)) return existing;
  return existing ? `${existing} | ${marker}` : marker;
}

/** Authorization gate only — NOT a per-caller partition key. Every request
 * that passes operates on the same shared (user_id = NULL) bucket; see the
 * SECURITY NOTE above for why that's safe now that it's only reachable
 * through this service-role code, never directly via RLS. */
async function isAuthorized(req: Request, supabaseAdmin: SupabaseClient): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  const apiKey = Deno.env.get('SHIFT_TRACKER_API_KEY');
  if (apiKey && token === apiKey) return true;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && !!data.user;
}

async function findActiveSession(client: SupabaseClient): Promise<SessionRow | null> {
  const { data, error } = await client
    .from('sessions')
    .select('*')
    .is('ended_at', null)
    .is('user_id', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`findActiveSession failed: ${error.message}`);
  return (data as SessionRow | null) ?? null;
}

/** Sums public.trips within [startedAt, now] — the same window
 * ShiftTracker.tsx's buildShiftSnapshot already uses client-side, computed
 * here too so the sessions row itself is a self-updating source of truth
 * even if the PWA never gets to run that client-side math (backgrounded/
 * killed the whole shift). */
async function computeEarningsSince(
  client: SupabaseClient,
  startedAt: string,
  nowIso: string
): Promise<{ totalEarnings: number; totalRides: number }> {
  const { data, error } = await client
    .from('trips')
    .select('earnings, tips')
    .eq('source', 'real')
    .gte('started_at', startedAt)
    .lte('started_at', nowIso);
  if (error) throw new Error(`computeEarningsSince failed: ${error.message}`);
  const rows = (data ?? []) as { earnings: number | null; tips: number | null }[];
  const totalEarnings = rows.reduce((sum, r) => sum + (r.earnings ?? 0) + (r.tips ?? 0), 0);
  return { totalEarnings, totalRides: rows.length };
}

/** Applies a resolved lat/lng to a session: updates last_lat/last_lng and,
 * on an actual zone change, closes the previous session_zones entry and
 * opens a new one. No-ops when coordinates are absent or unchanged. */
async function applyPosition(
  client: SupabaseClient,
  session: SessionRow,
  lat: number,
  lng: number,
  zones: readonly ZoneRow[],
  nowIso: string
): Promise<string | null> {
  const resolvedZoneId = nearestZoneId(lat, lng, zones);
  const { changed, newZoneId } = resolveZoneTransition(session.active_zone_id, resolvedZoneId);

  if (changed) {
    if (session.active_zone_id) {
      await client
        .from('session_zones')
        .update({ exited_at: nowIso })
        .eq('session_id', session.id)
        .is('exited_at', null);
    }
    if (newZoneId) {
      await client.from('session_zones').insert({
        session_id: session.id,
        zone_id: newZoneId,
        entered_at: nowIso,
      });
    }
  }
  return newZoneId;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST requis' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Serveur mal configuré (secrets manquants)' }, 500);
    }
    const client = createClient(supabaseUrl, serviceKey);

    if (!(await isAuthorized(req, client))) return json({ error: 'Non autorisé' }, 401);

    if (await isRateLimited(client, 'shift-tracker', 60)) {
      return json({ error: 'Trop de requêtes, réessaie dans une minute' }, 429);
    }

    const body: RequestBody = await req.json().catch(() => ({}));
    const resolved = resolveShiftAction(body);
    if (!resolved) {
      return json(
        {
          error:
            'action requis: START | STOP | HEARTBEAT | ADD_EARNINGS | STATUS ' +
            '(ou event = texte de notification Lyft reconnaissable)',
        },
        400
      );
    }
    const action = resolved.action;

    const now = new Date();
    const nowIso = now.toISOString();
    const coords = parseCoordinates(body);

    if (action === 'STATUS') {
      const active = await findActiveSession(client);
      return json({
        ok: true,
        session: active,
        elapsedSeconds: active ? elapsedSeconds(active.started_at, now.getTime()) : null,
      });
    }

    if (action === 'START') {
      const existing = await findActiveSession(client);
      if (existing) {
        return json({ ok: true, alreadyActive: true, session: existing, elapsedSeconds: elapsedSeconds(existing.started_at, now.getTime()) });
      }
      const { data, error } = await client
        .from('sessions')
        .insert({
          user_id: null,
          started_at: nowIso,
          last_heartbeat_at: nowIso,
          last_lat: coords?.lat ?? null,
          last_lng: coords?.lng ?? null,
        })
        .select('*')
        .single();
      if (error) throw new Error(`session insert failed: ${error.message}`);
      return json({ ok: true, session: data, elapsedSeconds: 0 });
    }

    // Every other action requires an active session — HEARTBEAT auto-starts
    // one defensively (a MacroDroid automation added mid-drive, or one that
    // only wires the heartbeat trigger, shouldn't just silently no-op).
    let session = await findActiveSession(client);
    if (!session && action === 'HEARTBEAT') {
      const { data, error } = await client
        .from('sessions')
        .insert({ user_id: null, started_at: nowIso, last_heartbeat_at: nowIso })
        .select('*')
        .single();
      if (error) throw new Error(`session insert failed: ${error.message}`);
      session = data as SessionRow;
    }

    if (action === 'ADD_EARNINGS') {
      const amount = parseAmount(body.amount);
      if (amount === null) return json({ error: 'amount requis (nombre positif)' }, 400);
      const platform =
        typeof body.platform === 'string' ? body.platform.toLowerCase().slice(0, 40) : null;

      const { data: trip, error: tripError } = await client
        .from('trips')
        .insert({
          user_id: null,
          earnings: amount,
          tips: 0,
          platform,
          started_at: nowIso,
          ended_at: nowIso,
          source: 'real',
          notes: 'Shift tracker (MacroDroid/API)',
        })
        .select('id')
        .single();
      if (tripError) throw new Error(`trip insert failed: ${tripError.message}`);

      if (session) {
        const { data: updated, error: updateErr } = await client
          .from('sessions')
          .update({
            total_earnings: (session.total_earnings ?? 0) + amount,
            total_rides: (session.total_rides ?? 0) + 1,
            last_heartbeat_at: nowIso,
          })
          .eq('id', session.id)
          .select('*')
          .single();
        if (updateErr) throw new Error(`session update failed: ${updateErr.message}`);
        session = updated as SessionRow;
      }
      return json({ ok: true, tripId: trip.id, session });
    }

    if (!session) {
      return json({ ok: true, message: 'Aucun shift actif' });
    }

    if (action === 'HEARTBEAT') {
      const { data: zones, error: zonesErr } = await client
        .from('zones')
        .select('id, city_id, latitude, longitude');
      if (zonesErr) throw new Error(`zones fetch failed: ${zonesErr.message}`);

      let activeZoneId = session.active_zone_id;
      if (coords) {
        activeZoneId = await applyPosition(client, session, coords.lat, coords.lng, zones as ZoneRow[], nowIso);
      }

      const { totalEarnings, totalRides } = await computeEarningsSince(client, session.started_at, nowIso);

      const { data: updated, error: updateErr } = await client
        .from('sessions')
        .update({
          last_heartbeat_at: nowIso,
          last_lat: coords?.lat ?? session.last_lat,
          last_lng: coords?.lng ?? session.last_lng,
          active_zone_id: activeZoneId,
          total_earnings: totalEarnings,
          total_rides: totalRides,
        })
        .eq('id', session.id)
        .select('*')
        .single();
      if (updateErr) throw new Error(`session update failed: ${updateErr.message}`);

      return json({ ok: true, session: updated, elapsedSeconds: elapsedSeconds(session.started_at, now.getTime()) });
    }

    // STOP
    const { totalEarnings, totalRides } = await computeEarningsSince(client, session.started_at, nowIso);
    const totalHours = elapsedSeconds(session.started_at, now.getTime()) / 3600;

    if (session.active_zone_id) {
      await client
        .from('session_zones')
        .update({ exited_at: nowIso })
        .eq('session_id', session.id)
        .is('exited_at', null);
    }

    const { data: ended, error: endErr } = await client
      .from('sessions')
      .update({
        ended_at: nowIso,
        total_hours: totalHours,
        total_earnings: totalEarnings,
        total_rides: totalRides,
        notes: stopNote(session.notes, resolved.stopReason),
      })
      .eq('id', session.id)
      .select('*')
      .single();
    if (endErr) throw new Error(`session end failed: ${endErr.message}`);

    return json({
      ok: true,
      session: ended,
      stopReason: resolved.stopReason ?? null,
      elapsedSeconds: elapsedSeconds(session.started_at, now.getTime()),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[shift-tracker]', message);
    captureEdgeException(err, 'shift-tracker', { url: req.url, method: req.method });
    return json({ ok: false, error: message }, 500);
  }
});
