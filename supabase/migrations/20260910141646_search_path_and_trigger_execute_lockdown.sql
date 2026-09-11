-- ============================================================
-- Migration: search_path_and_pg_net_cleanup
-- Delivroom (hibzhsjgipybfihhzpxr) — audit du 2026-09-10
--
-- 1) increment_rate_limit avait search_path = public au lieu de '' (règle
--    CLAUDE.md §4). Toutes les références sont déjà qualifiées
--    (public.edge_rate_limits) donc pas exploitable en l'état, mais on
--    l'aligne avec zone_discoveries_auto_promote (même pattern DEFINER).
--
-- 2) zone_discoveries_auto_promote() (ajoutée 2026-09-07) est un trigger
--    interne comme trg_trips_raw_aggregate/handle_new_user (catégorie C de
--    20260826000006_security_definer_audit.sql) mais n'a jamais reçu le
--    même verrou EXECUTE — restait ouverte à anon/authenticated.
--
-- 3) pg_net : PAS déplacée. pg_extension.extnamespace affiche "public" pour
--    cette extension (d'où le faux positif de l'advisor extension_in_public),
--    mais ses fonctions réelles (net.http_post etc.) vivent déjà dans le
--    schéma "net" — et ALTER EXTENSION ... SET SCHEMA n'est pas supporté par
--    pg_net (erreur Postgres 0A000). Rien à corriger ici ; vector, elle,
--    avait vraiment ses objets en public, d'où le déplacement réussi via
--    20260826000007_move_vector_extension.sql.
-- ============================================================

alter function public.increment_rate_limit(text, timestamptz) set search_path = '';

revoke execute on function public.zone_discoveries_auto_promote() from public, anon, authenticated;
grant execute on function public.zone_discoveries_auto_promote() to service_role;
