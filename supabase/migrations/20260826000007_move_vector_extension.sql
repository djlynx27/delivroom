-- ============================================================
-- Migration: move_vector_extension
-- Delivroom (hibzhsjgipybfihhzpxr) — postgres checkup 2026-08-26 (suite 3)
--
-- extension_in_public : déplace vector hors de public.
--
-- Vérifié avant migration :
-- - 3 colonnes vector (demand_patterns, user_pings, zone_context_vectors)
-- - 5 index ivfflat/hnsw vector_cosine_ops (référencés par OID, non affectés
--   par le déplacement de schéma)
-- - 3 fonctions utilisent l'opérateur <=> SANS qualification de schéma :
--   find_similar_contexts, match_similar_contexts, match_user_pings.
--   Elles ont search_path='' depuis la migration précédente -> le simple
--   déplacement de l'extension les aurait cassées ("operator does not
--   exist: vector <=> vector"). Corrigé dans la même transaction.
-- ============================================================

create schema if not exists extensions;

alter extension vector set schema extensions;

-- Les tables/colonnes referencent déjà public.xxx explicitement ; seul
-- l'opérateur <=> a besoin que 'extensions' soit dans le search_path.
alter function public.find_similar_contexts(p_zone_id text, p_vector vector, p_limit integer, p_min_trips integer) set search_path = 'extensions';
alter function public.match_similar_contexts(query_vector vector, query_zone_id text, match_count integer) set search_path = 'extensions';
alter function public.match_user_pings(query_vector vector, query_driver_fingerprint text, query_zone_id text, query_platform text, match_count integer) set search_path = 'extensions';
