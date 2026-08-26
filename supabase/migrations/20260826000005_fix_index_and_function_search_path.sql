-- ============================================================
-- Migration: fix_index_and_function_search_path
-- Delivroom (hibzhsjgipybfihhzpxr) — postgres checkup 2026-08-26 (suite)
--
-- 1. duplicate_index sur zone_performance : drop de l'index redondant
--    zone_performance_unique. On garde zone_performance_zone_hour_dow_platform_key
--    car c'est celui qui backe la contrainte UNIQUE standard
--    (zone_performance_zone_hour_dow_platform_key, contype='u' dans pg_constraint) —
--    zone_performance_unique n'est qu'un index dupliqué, pas une contrainte.
--
-- 2. function_search_path_mutable : 17 fonctions au total (pas 14, compte exact
--    via pg_proc). SET search_path='' partout.
--    ATTENTION : aggregate_zone_performance() et trg_trips_raw_aggregate()
--    référencent trips_raw / zone_performance SANS préfixe de schéma. Avec
--    search_path='', ces appels auraient cassé ("relation does not exist").
--    Elles sont donc recréées via CREATE OR REPLACE avec préfixe public.
--    explicite, logique métier strictement identique. Les 15 autres n'ont que
--    des références déjà qualifiées (public.xxx) -> simple ALTER FUNCTION.
--
-- SECURITY DEFINER non touché ici (hors scope de la demande) : 9 fonctions
-- sur les 17 sont SECURITY DEFINER (aggregate_zone_performance,
-- cleanup_old_platform_signals, cleanup_old_weight_history,
-- get_best_platform_for_zone, get_latest_weights, get_platform_signals_by_zone,
-- get_weight_calibration_summary, recalculate_zone_scores,
-- trg_trips_raw_aggregate). Règle CLAUDE.md §4 (SECURITY INVOKER par défaut) à
-- statuer séparément avec justification métier avant tout changement.
-- ============================================================

-- ------------------------------------------------------------
-- 1) duplicate_index
-- ------------------------------------------------------------
drop index if exists public.zone_performance_unique;

-- ------------------------------------------------------------
-- 2a) Fonctions à recréer (références de tables non qualifiées à corriger)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aggregate_zone_performance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.zone_performance (
    id, zone_id, hour_of_day, day_of_week, platform,
    avg_fare_cad, avg_wait_min, avg_distance_km, trip_count, demand_score, updated_at
  )
  SELECT
    gen_random_uuid(),
    tr.zone_id,
    EXTRACT(HOUR FROM tr.started_at)::smallint,
    EXTRACT(DOW  FROM tr.started_at)::smallint,
    COALESCE(tr.platform, 'unknown'),
    AVG(tr.fare_cad)::real,
    AVG(tr.wait_min)::real,
    AVG(tr.distance_km)::real,
    COUNT(*)::integer,
    LEAST(
      100.0,
      (COUNT(*) * 100.0 / NULLIF(
        MAX(COUNT(*)) OVER (
          PARTITION BY EXTRACT(HOUR FROM tr.started_at),
                       EXTRACT(DOW  FROM tr.started_at)
        ), 0
      ))
    )::real,
    NOW()
  FROM public.trips_raw tr
  WHERE tr.zone_id IS NOT NULL
  GROUP BY
    tr.zone_id,
    EXTRACT(HOUR FROM tr.started_at),
    EXTRACT(DOW  FROM tr.started_at),
    COALESCE(tr.platform, 'unknown')
  ON CONFLICT (zone_id, hour_of_day, day_of_week, platform)
  DO UPDATE SET
    avg_fare_cad    = EXCLUDED.avg_fare_cad,
    avg_wait_min    = EXCLUDED.avg_wait_min,
    avg_distance_km = EXCLUDED.avg_distance_km,
    trip_count      = EXCLUDED.trip_count,
    demand_score    = EXCLUDED.demand_score,
    updated_at      = NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_trips_raw_aggregate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.zone_performance (
    id, zone_id, hour_of_day, day_of_week, platform,
    avg_fare_cad, avg_wait_min, avg_distance_km, trip_count, demand_score, updated_at
  )
  SELECT
    gen_random_uuid(),
    NEW.zone_id,
    EXTRACT(HOUR FROM NEW.started_at)::smallint,
    EXTRACT(DOW  FROM NEW.started_at)::smallint,
    COALESCE(NEW.platform, 'unknown'),
    AVG(fare_cad)::real,
    AVG(wait_min)::real,
    AVG(distance_km)::real,
    COUNT(*)::integer,
    LEAST(100.0, COUNT(*) * 2.0)::real,
    NOW()
  FROM public.trips_raw
  WHERE zone_id   = NEW.zone_id
    AND EXTRACT(HOUR FROM started_at) = EXTRACT(HOUR FROM NEW.started_at)
    AND EXTRACT(DOW  FROM started_at) = EXTRACT(DOW  FROM NEW.started_at)
    AND COALESCE(platform, 'unknown')  = COALESCE(NEW.platform, 'unknown')
  GROUP BY zone_id
  ON CONFLICT (zone_id, hour_of_day, day_of_week, platform)
  DO UPDATE SET
    avg_fare_cad    = EXCLUDED.avg_fare_cad,
    avg_wait_min    = EXCLUDED.avg_wait_min,
    avg_distance_km = EXCLUDED.avg_distance_km,
    trip_count      = EXCLUDED.trip_count,
    demand_score    = EXCLUDED.demand_score,
    updated_at      = NOW();

  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- 2b) Fonctions déjà qualifiées (public.xxx) -> ALTER FUNCTION suffit
-- ------------------------------------------------------------

alter function public.cleanup_old_context_vectors() set search_path = '';
alter function public.cleanup_old_platform_signals() set search_path = '';
alter function public.cleanup_old_weight_history() set search_path = '';
alter function public.find_similar_contexts(p_zone_id text, p_vector vector, p_limit integer, p_min_trips integer) set search_path = '';
alter function public.get_best_platform_for_zone(p_zone_id text, p_lookback interval) set search_path = '';
alter function public.get_latest_scores(p_city_id text) set search_path = '';
alter function public.get_latest_weights() set search_path = '';
alter function public.get_platform_signals_by_zone(p_city_id text, p_lookback interval) set search_path = '';
alter function public.get_surge_baseline(p_zone_id text, p_hour_slot integer, p_dow integer) set search_path = '';
alter function public.get_weight_calibration_summary(p_limit integer) set search_path = '';
alter function public.handle_updated_at() set search_path = '';
alter function public.match_similar_contexts(query_vector vector, query_zone_id text, match_count integer) set search_path = '';
alter function public.match_user_pings(query_vector vector, query_driver_fingerprint text, query_zone_id text, query_platform text, match_count integer) set search_path = '';
alter function public.recalculate_zone_scores() set search_path = '';
alter function public.update_push_subscriptions_updated_at() set search_path = '';
