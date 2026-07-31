-- Nettoyage des zones signalées par l'audit GPS du 2026-07-31
-- (voir 20260731130000_fix_zone_coordinates.sql, section « à arbitrer »).
--
-- Règle appliquée : on renomme quand un vrai lieu existe derrière le mauvais
-- nom, on supprime quand il n'y a rien sur le terrain. Une zone renommée qui
-- ne génère aucune course finira de toute façon par ressortir dans le suivi
-- « courses depuis » — c'est le filet de sécurité, pas cette migration.
--
-- Vérifié avant suppression : aucune de ces zones n'a de course, de visite de
-- session ni de ligne zone_performance. Les seules « données » associées sont
-- les lignes de scores écrites automatiquement par le cron pour chaque zone.

BEGIN;

-- ── Renommées : le lieu existe, le nom était faux ───────────────────────────

-- Aucun « complexe sportif » à Blainville ; l'aréna municipale, elle, existe.
UPDATE public.zones
   SET name = 'Aréna de Blainville', latitude = 45.681725, longitude = -73.876811
 WHERE id = 'blv-cs';

-- Le centre commercial de Blainville s'appelle Le Blainvillois.
UPDATE public.zones
   SET name = 'Le Blainvillois', latitude = 45.688957, longitude = -73.902811
 WHERE id = 'blv-cc';

-- Rosemère n'a pas de centre-ville : le second pôle commercial après Place
-- Rosemère est la Galerie des Mille-Îles.
UPDATE public.zones
   SET name = 'Galerie des Mille-Îles', latitude = 45.629246, longitude = -73.812617
 WHERE id = 'rsm-cv';

-- ── Repositionnées : le nom est bon, les coordonnées étaient fausses ────────

-- Place Laval est à Chomedey (boul. Saint-Martin Ouest), pas à Pont-Viau.
UPDATE public.zones
   SET latitude = 45.581173, longitude = -73.706057
 WHERE id = 'lvl-pl';  -- 2.9 km

-- Le vrai centre-ville de Sainte-Thérèse est la rue Blainville Est.
UPDATE public.zones
   SET latitude = 45.639231, longitude = -73.833225
 WHERE id = 'sth-cv';  -- 0.9 km

-- Coordonnées déjà correctes, mais le lieu est à Saint-Laurent (Montréal),
-- pas à Laval — il était classé dans la mauvaise ville.
UPDATE public.zones SET city_id = 'mtl' WHERE id = 'lvl-croissant-langevin';

-- ── Supprimées : rien de réel derrière ──────────────────────────────────────

DELETE FROM public.zones WHERE id IN (
  -- Le Carrefour du Nord est à Saint-Jérôme, 20 km hors du secteur.
  'bsb-cn',
  -- Aucune gare exo à Boisbriand : la ligne dessert Sainte-Thérèse et Rosemère.
  'bsb-gb',
  -- Aucun centre commercial de ce nom à Sainte-Thérèse.
  'sth-gal',
  -- Blainville n'a pas de centre-ville commerçant ; la gare (blv-gb) est à 1 km
  -- et couvre déjà le secteur.
  'blv-cv',
  -- Bois-des-Filion : les trois zones pointaient de 1.8 à 9 km hors de la
  -- ville, et la ville elle-même n'a aucun générateur de courses — une piscine
  -- municipale et un terrain de balle. Rien à repositionner.
  'bdf-ar',
  'bdf-rp',
  'bdf-cl'
);

-- Plus aucune zone à Bois-des-Filion : on retire la ville, sinon la détection
-- automatique peut y basculer et afficher un écran vide.
DELETE FROM public.cities WHERE id = 'bdf';

COMMIT;
