-- ============================================================
-- Migration: security_definer_audit
-- Delivroom (hibzhsjgipybfihhzpxr) — postgres checkup 2026-08-26 (suite 2)
--
-- Audit SECURITY DEFINER selon CLAUDE.md §4 (SECURITY INVOKER par défaut,
-- DEFINER uniquement si strictement indispensable).
--
-- 11 fonctions flaggées par l'advisor anon/authenticated_security_definer_
-- function_executable. Vérifié via cron.job, pg_trigger, pg_policies,
-- has_function_privilege (pas de devinette) :
--
-- A) DEFINER inutile (table déjà en lecture publique via RLS) -> INVOKER :
--    get_best_platform_for_zone, get_platform_signals_by_zone,
--    get_latest_weights, get_weight_calibration_summary
--
-- B) Jobs système confirmés (cron.job ou purge admin) -> garde DEFINER,
--    revoke EXECUTE anon/authenticated, grant explicite service_role :
--    aggregate_zone_performance, recalculate_zone_scores,
--    cleanup_old_platform_signals, cleanup_old_weight_history
--
-- C) Triggers internes confirmés (pg_trigger) -> garde DEFINER,
--    revoke EXECUTE anon/authenticated (le trigger continue de fonctionner,
--    l'exécution via trigger ne passe pas par le contrôle EXECUTE) :
--    trg_trips_raw_aggregate (trigger sur trips_raw),
--    handle_new_user (trigger sur auth.users)
--
-- D) increment_rate_limit : NON touchée. DEFINER + accès anon/authenticated
--    voulus (edge_rate_limits a RLS activé sans aucune policy -> cette
--    fonction est la seule porte d'entrée contrôlée, et le rate-limit doit
--    s'appliquer aussi aux requêtes anonymes). À reconfirmer avec Oualid si
--    le pattern d'appel change côté app.
-- ============================================================

-- ------------------------------------------------------------
-- A) DEFINER -> INVOKER (RLS déjà public sur les tables lues)
-- ------------------------------------------------------------
alter function public.get_best_platform_for_zone(p_zone_id text, p_lookback interval) security invoker;
alter function public.get_platform_signals_by_zone(p_city_id text, p_lookback interval) security invoker;
alter function public.get_latest_weights() security invoker;
alter function public.get_weight_calibration_summary(p_limit integer) security invoker;

-- ------------------------------------------------------------
-- B) Jobs système : garde DEFINER, verrouille l'accès RPC public
-- ------------------------------------------------------------
revoke execute on function public.aggregate_zone_performance() from public, anon, authenticated;
grant execute on function public.aggregate_zone_performance() to service_role;

revoke execute on function public.recalculate_zone_scores() from public, anon, authenticated;
grant execute on function public.recalculate_zone_scores() to service_role;

revoke execute on function public.cleanup_old_platform_signals() from public, anon, authenticated;
grant execute on function public.cleanup_old_platform_signals() to service_role;

revoke execute on function public.cleanup_old_weight_history() from public, anon, authenticated;
grant execute on function public.cleanup_old_weight_history() to service_role;

-- ------------------------------------------------------------
-- C) Triggers internes : garde DEFINER, verrouille l'accès RPC public
--    (le déclenchement via trigger n'est pas affecté par ce revoke)
-- ------------------------------------------------------------
revoke execute on function public.trg_trips_raw_aggregate() from public, anon, authenticated;
grant execute on function public.trg_trips_raw_aggregate() to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;
