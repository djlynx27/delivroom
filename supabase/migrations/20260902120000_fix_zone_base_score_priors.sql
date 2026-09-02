-- ══════════════════════════════════════════════════════════════════════
-- Delivroom — Correction des priors base_score (Centre Bell / Vieux-Port /
-- Gare Centrale / Berri-UQAM)
--
-- Root cause: 20260319000003_zone_scores_territories.sql a fixé base_score
-- à la main, en confondant "potentiel de pointe" (soir d'événement) avec
-- "score de base" (moyenne). Centre Bell (79) encodait déjà son propre
-- event_boost dans base_score -- double comptage qui l'écrase les jours
-- SANS événement, quand event_boost (score-calculator/index.ts) est déjà
-- le mécanisme prévu pour ce cas.
--
-- Sur les vrais trips (source='real', hors seed synthétique) capturés à
-- date : Vieux-Port > Gare Centrale > Berri-UQAM > Centre Bell en $/course
-- moyen -- l'inverse exact du prior d'origine. Échantillon mince (15 trips
-- au total sur les 4 zones) -- à recalibrer une fois le volume réel plus
-- gros ; ceci corrige la direction, pas une valeur définitive.
-- ══════════════════════════════════════════════════════════════════════

UPDATE public.zones SET base_score = 78, current_score = 78 WHERE id = 'mtl-vp';
UPDATE public.zones SET base_score = 75, current_score = 75 WHERE id = 'mtl-gc';
UPDATE public.zones SET base_score = 69, current_score = 69 WHERE id = 'mtl-bq';
UPDATE public.zones SET base_score = 68, current_score = 68 WHERE id = 'mtl-cb';
