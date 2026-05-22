import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';

/**
 * context-embeddings — Edge Function Delivroom
 *
 * Gère le stockage et la recherche de vecteurs de contexte 8D via pgvector.
 *
 * Routes :
 *   POST /context-embeddings
 *     Body: { zone_id, context_vector, surge_multiplier, surge_class,
 *             actual_earnings_per_hour?, trip_count? }
 *     → Stocke un nouveau vecteur. Appelé par score-calculator après chaque recalcul.
 *
 *   POST /context-embeddings  { action: 'query', zone_id, context_vector, limit? }
 *     → Retourne les K contextes historiques les plus similaires (similarité cosinus).
 *
 *   POST /context-embeddings  { action: 'update_outcome', id, actual_earnings_per_hour, trip_count }
 *     → Met à jour le résultat réel après une course (feedback loop ML).
 *
 *   GET  /context-embeddings?zone_id=xxx&hour=14&dow=5
 *     → Retourne le baseline de surge (moyenne 4 semaines, même créneau).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface StoreBody {
  action?: undefined;
  zone_id: string;
  context_vector: number[];
  surge_multiplier: number;
  surge_class: 'normal' | 'elevated' | 'high' | 'peak';
  actual_earnings_per_hour?: number;
  trip_count?: number;
}

interface QueryBody {
  action: 'query';
  zone_id: string;
  context_vector: number[];
  limit?: number;
  min_trips?: number;
}

interface UpdateOutcomeBody {
  action: 'update_outcome';
  id: string;
  actual_earnings_per_hour: number;
  trip_count: number;
}

type RequestBody = StoreBody | QueryBody | UpdateOutcomeBody;

function isQueryBody(body: RequestBody): body is QueryBody {
  return body.action === 'query';
}

function isUpdateOutcomeBody(body: RequestBody): body is UpdateOutcomeBody {
  return body.action === 'update_outcome';
}

function vectorToPostgres(vec: number[]): string {
  return `[${vec.map((v) => v.toFixed(6)).join(',')}]`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// eslint-disable-next-line complexity
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── GET: baseline surge pour un créneau ────────────────────────────────
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const zoneId = url.searchParams.get('zone_id');
      const hour = parseInt(url.searchParams.get('hour') ?? '12', 10);
      const dow = parseInt(url.searchParams.get('dow') ?? '1', 10);

      if (!zoneId) {
        return jsonResponse({ error: 'zone_id requis' }, 400);
      }

      const { data, error } = await supabase.rpc('get_surge_baseline', {
        p_zone_id: zoneId,
        p_hour_slot: hour,
        p_dow: dow,
      });

      if (error) throw error;
      return jsonResponse({ baseline: data ?? 1.0 });
    }

    // ── POST: store | query | update_outcome ───────────────────────────────
    if (req.method === 'POST') {
      const body: RequestBody = await req.json();

      // ── Action: query similar contexts ──────────────────────────────────
      if (isQueryBody(body)) {
        const { zone_id, context_vector, limit = 10, min_trips = 1 } = body;

        if (!zone_id || !context_vector?.length) {
          return jsonResponse(
            { error: 'zone_id et context_vector requis' },
            400
          );
        }

        const { data, error } = await supabase.rpc('find_similar_contexts', {
          p_zone_id: zone_id,
          p_vector: vectorToPostgres(context_vector),
          p_limit: Math.min(limit, 50),
          p_min_trips: min_trips,
        });

        if (error) throw error;

        // Aggreger les résultats similaires → prédiction $/h
        const withOutcome = (data ?? []).filter(
          (r: { actual_earnings_per_hour: number | null }) =>
            r.actual_earnings_per_hour !== null
        );

        const avgEarningsPerHour =
          withOutcome.length > 0
            ? withOutcome.reduce(
                (s: number, r: { actual_earnings_per_hour: number }) =>
                  s + r.actual_earnings_per_hour,
                0
              ) / withOutcome.length
            : null;

        return jsonResponse({
          similar: data ?? [],
          predicted_earnings_per_hour: avgEarningsPerHour
            ? Math.round(avgEarningsPerHour * 100) / 100
            : null,
          sample_size: withOutcome.length,
        });
      }

      // ── Action: update outcome after trip ───────────────────────────────
      if (isUpdateOutcomeBody(body)) {
        const { id, actual_earnings_per_hour, trip_count } = body;

        if (!id) {
          return jsonResponse({ error: 'id requis' }, 400);
        }

        const { error } = await supabase
          .from('zone_context_vectors')
          .update({ actual_earnings_per_hour, trip_count })
          .eq('id', id);

        if (error) throw error;
        return jsonResponse({ updated: true });
      }

      // ── Default action: store new context vector ─────────────────────────
      const storeBody = body as StoreBody;
      const {
        zone_id,
        context_vector,
        surge_multiplier,
        surge_class,
        actual_earnings_per_hour,
        trip_count = 0,
      } = storeBody;

      if (!zone_id || !context_vector?.length) {
        return jsonResponse({ error: 'zone_id et context_vector requis' }, 400);
      }

      if (context_vector.length !== 8) {
        return jsonResponse(
          {
            error: `context_vector doit avoir 8 dimensions (reçu: ${context_vector.length})`,
          },
          400
        );
      }

      // Validate surge_class
      const validClasses = ['normal', 'elevated', 'high', 'peak'];
      if (!validClasses.includes(surge_class)) {
        return jsonResponse(
          { error: `surge_class invalide: ${surge_class}` },
          400
        );
      }

      const { data: inserted, error } = await supabase
        .from('zone_context_vectors')
        .insert({
          zone_id,
          context_vector: vectorToPostgres(context_vector),
          surge_multiplier,
          surge_class,
          actual_earnings_per_hour: actual_earnings_per_hour ?? null,
          trip_count,
        })
        .select('id')
        .single();

      if (error) throw error;

      return jsonResponse({ stored: true, id: inserted?.id });
    }

    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error('context-embeddings error:', err);
    captureEdgeException(err, 'context-embeddings', { url: req.url, method: req.method });
    return jsonResponse({ error: String(err) }, 500);
  }
});
