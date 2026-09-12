-- mtl-anjou pointait 1.07 km au nord-est du centre commercial, dans une rue
-- résidentielle (rapporté par le chauffeur : "Naviguer" atterrit au hasard au
-- lieu des Galeries d'Anjou). Recentré sur le point de dépose Taxi Hochelaga,
-- 7999 boul. des Galeries d'Anjou (voir taxiStands.ts standId 46-906),
-- même méthode que la migration 20260731130000_fix_zone_coordinates.sql.

BEGIN;

UPDATE public.zones
SET latitude = 45.599762, longitude = -73.563115
WHERE id = 'mtl-anjou';  -- 1.07 km

COMMIT;
