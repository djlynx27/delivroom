-- Script pour corriger les coordonnées GPS des zones dans Supabase
-- Exécuter ce script dans le SQL Editor de Supabase Dashboard

-- Mise à jour des coordonnées pour Place Bell (Laval) - COORDONNÉES CORRIGÉES
UPDATE zones 
SET latitude = 45.5562, longitude = -73.7203 
WHERE id = 'lvl-pb';

-- Vérification
SELECT id, name, latitude, longitude 
FROM zones 
WHERE id = 'lvl-pb';
