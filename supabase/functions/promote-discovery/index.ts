// supabase/functions/promote-discovery/index.ts
// ──────────────────────────────────────────────────────────────────────────────
// Admin write path for the "Zones découvertes" screen. zones + zone_discoveries
// have RLS enabled with read-only client policies, so the browser can't create a
// zone or mark a discovery. This function does those writes with the service
// role (bypasses RLS), which is exactly what the zone_discoveries migration
// planned for ("Future admin UI will go through an Edge Function with
// service_role").
//
// Body:
//   { action: 'reject',  discovery_id }
//   { action: 'promote', discovery_id, zone: { id, city_id, name, type,
//                                               latitude, longitude, address? } }
// ──────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface ZonePayload {
  id: string;
  city_id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  address?: string | null;
}

interface RequestBody {
  action?: 'promote' | 'reject';
  discovery_id?: string;
  zone?: ZonePayload;
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
  try {
    const body: RequestBody = await req.json().catch(() => ({}));
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) {
      return json({ error: 'Serveur mal configuré (clés manquantes)' }, 500);
    }
    if (!body.discovery_id) {
      return json({ error: 'discovery_id requis' }, 400);
    }

    const client = createClient(url, serviceKey);

    if (body.action === 'reject') {
      const { error } = await client
        .from('zone_discoveries')
        .update({ status: 'rejected' })
        .eq('id', body.discovery_id);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    if (body.action === 'promote') {
      const z = body.zone;
      if (
        !z?.id || !z.city_id || !z.name ||
        typeof z.latitude !== 'number' || typeof z.longitude !== 'number'
      ) {
        return json({ error: 'Champs de zone requis (id, city_id, name, lat, lng)' }, 400);
      }

      // Idempotent: if the zone id already exists (re-promote, or two
      // intersections sharing a slug), keep the existing zone instead of
      // erroring on the primary key — then just mark the discovery promoted.
      const { error: zoneErr } = await client
        .from('zones')
        .upsert(
          {
            id: z.id,
            city_id: z.city_id,
            name: z.name,
            type: z.type || 'résidentiel',
            latitude: z.latitude,
            longitude: z.longitude,
            address: z.address ?? null,
            base_score: 50,
            current_score: 50,
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
      if (zoneErr) throw new Error(`Création zone: ${zoneErr.message}`);

      const { error: discErr } = await client
        .from('zone_discoveries')
        .update({ status: 'promoted', promoted_zone_id: z.id })
        .eq('id', body.discovery_id);
      if (discErr) {
        return json({
          ok: true,
          warning: `Zone créée mais découverte non marquée: ${discErr.message}`,
          zone_id: z.id,
        });
      }
      return json({ ok: true, zone_id: z.id });
    }

    return json({ error: 'Action inconnue' }, 400);
  } catch (err) {
    console.error('promote-discovery error:', err);
    captureEdgeException(err, 'promote-discovery', {
      url: req.url,
      method: req.method,
    });
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
