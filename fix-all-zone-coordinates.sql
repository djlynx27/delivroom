-- Script pour corriger TOUTES les coordonnées GPS des zones dans Supabase
-- Basé sur les coordonnées GPS du fichier gps_mtl_laval_longueuil_rivenord.csv
-- Exécuter ce script dans le SQL Editor de Supabase Dashboard

-- Montréal - Corrections
UPDATE zones SET latitude = 45.4687, longitude = -73.7425 WHERE id = 'mtl-yul'; -- Aéroport Trudeau (YUL)
UPDATE zones SET latitude = 45.5003, longitude = -73.5672 WHERE id = 'mtl-gc'; -- Gare Centrale
UPDATE zones SET latitude = 45.5151, longitude = -73.5611 WHERE id = 'mtl-bq'; -- Station Berri-UQAM
UPDATE zones SET latitude = 45.483, longitude = -73.5794 WHERE id = 'mtl-ll'; -- Station Lionel-Groulx
UPDATE zones SET latitude = 45.5367, longitude = -73.6116 WHERE id = 'mtl-jt'; -- Station Jean-Talon
UPDATE zones SET latitude = 45.5144, longitude = -73.6831 WHERE id = 'mtl-cv'; -- Station Côte-Vertu
UPDATE zones SET latitude = 45.5111, longitude = -73.5647 WHERE id = 'mtl-qs'; -- Quartier des spectacles
UPDATE zones SET latitude = 45.4975, longitude = -73.577 WHERE id = 'mtl-cs'; -- Crescent Sainte-Catherine
UPDATE zones SET latitude = 45.5087, longitude = -73.552 WHERE id = 'mtl-vp'; -- Vieux-Port de Montréal
UPDATE zones SET latitude = 45.4969, longitude = -73.5698 WHERE id = 'mtl-cb'; -- Centre Bell
UPDATE zones SET latitude = 45.5593, longitude = -73.551 WHERE id = 'mtl-so'; -- Stade olympique
UPDATE zones SET latitude = 45.5177, longitude = -73.6518 WHERE id = 'mtl-rk'; -- Centre commercial Rockland
UPDATE zones SET latitude = 45.5359, longitude = -73.6152 WHERE id = 'mtl-mj'; -- Marché Jean-Talon
UPDATE zones SET latitude = 45.5108, longitude = -73.5512 WHERE id = 'mtl-ch'; -- CHUM Hôpital
UPDATE zones SET latitude = 45.5048, longitude = -73.5772 WHERE id = 'mtl-mg'; -- Université McGill
UPDATE zones SET latitude = 45.5106, longitude = -73.5622 WHERE id = 'mtl-uq'; -- UQAM
UPDATE zones SET latitude = 45.536, longitude = -73.6055 WHERE id = 'mtl-ph'; -- Plaza Saint-Hubert
UPDATE zones SET latitude = 45.521, longitude = -73.5877 WHERE id = 'mtl-mr'; -- Avenue Mont-Royal
UPDATE zones SET latitude = 45.5123, longitude = -73.5367 WHERE id = 'mtl-ca'; -- Casino de Montréal

-- Laval - Corrections
UPDATE zones SET latitude = 45.5586, longitude = -73.7192 WHERE id = 'lvl-mm'; -- Station Montmorency
UPDATE zones SET latitude = 45.559, longitude = -73.688 WHERE id = 'lvl-ct'; -- Station Cartier
UPDATE zones SET latitude = 45.561, longitude = -73.674 WHERE id = 'lvl-dc'; -- Station De La Concorde
UPDATE zones SET latitude = 45.5702, longitude = -73.7519 WHERE id = 'lvl-cl'; -- Carrefour Laval
UPDATE zones SET latitude = 45.5645, longitude = -73.779 WHERE id = 'lvl-cp'; -- Centropolis Laval
UPDATE zones SET latitude = 45.5548, longitude = -73.705 WHERE id = 'lvl-pl'; -- Place Laval
UPDATE zones SET latitude = 45.5776, longitude = -73.697 WHERE id = 'lvl-hp'; -- Hôpital Cité-de-la-Santé
UPDATE zones SET latitude = 45.5578, longitude = -73.722 WHERE id = 'lvl-cm'; -- Cégep Montmorency
UPDATE zones SET latitude = 45.5565, longitude = -73.7205 WHERE id = 'lvl-um'; -- Université de Montréal Laval
UPDATE zones SET latitude = 45.62, longitude = -73.79 WHERE id = 'lvl-gs'; -- Gare Sainte-Rose
UPDATE zones SET latitude = 45.5568, longitude = -73.7198 WHERE id = 'lvl-pb'; -- Place Bell

-- Longueuil / Rive-Sud - Corrections
UPDATE zones SET latitude = 45.5249, longitude = -73.5219 WHERE id = 'lng-us'; -- Station Longueuil-Université-de-Sherbrooke
UPDATE zones SET latitude = 45.5243, longitude = -73.5215 WHERE id = 'lng-tl'; -- Terminus Longueuil
UPDATE zones SET latitude = 45.5219, longitude = -73.4769 WHERE id = 'lng-mc'; -- Mail Champlain
UPDATE zones SET latitude = 45.5312, longitude = -73.5181 WHERE id = 'lng-pl'; -- Place Longueuil
UPDATE zones SET latitude = 45.5006, longitude = -73.474 WHERE id = 'lng-hc'; -- Hôpital Charles-Le Moyne
UPDATE zones SET latitude = 45.533, longitude = -73.505 WHERE id = 'lng-vl'; -- Vieux-Longueuil
UPDATE zones SET latitude = 45.5216, longitude = -73.4998 WHERE id = 'lng-em'; -- Cégep Édouard-Montpetit
UPDATE zones SET latitude = 45.5251, longitude = -73.5204 WHERE id = 'lng-us2'; -- Université de Sherbrooke Longueuil
UPDATE zones SET latitude = 45.5048, longitude = -73.3855 WHERE id = 'lng-psb'; -- Promenades Saint-Bruno
UPDATE zones SET latitude = 45.4518, longitude = -73.442 WHERE id = 'lng-rem'; -- Gare Brossard REM

-- Boisbriand - Corrections
UPDATE zones SET latitude = 45.608, longitude = -73.822 WHERE id = 'bsb-gb'; -- Gare Boisbriand exo
UPDATE zones SET latitude = 45.6125, longitude = -73.8175 WHERE id = 'bsb-cn'; -- Carrefour du Nord
UPDATE zones SET latitude = 45.611, longitude = -73.829 WHERE id = 'bsb-pb'; -- Promenades de Boisbriand

-- Sainte-Thérèse - Corrections
UPDATE zones SET latitude = 45.633, longitude = -73.829 WHERE id = 'sth-gs'; -- Gare Sainte-Thérèse exo
UPDATE zones SET latitude = 45.6338, longitude = -73.826 WHERE id = 'sth-cv'; -- Centre-ville Sainte-Thérèse
UPDATE zones SET latitude = 45.6335, longitude = -73.8345 WHERE id = 'sth-cl'; -- Cégep Lionel-Groulx
UPDATE zones SET latitude = 45.6288, longitude = -73.8365 WHERE id = 'sth-gal'; -- Galeries Sainte-Thérèse

-- Blainville - Corrections
UPDATE zones SET latitude = 45.666, longitude = -73.872 WHERE id = 'blv-gb'; -- Gare Blainville exo
UPDATE zones SET latitude = 45.6645, longitude = -73.8665 WHERE id = 'blv-cs'; -- Complexe sportif de Blainville
UPDATE zones SET latitude = 45.67, longitude = -73.88 WHERE id = 'blv-cc'; -- Centre commercial Blainville
UPDATE zones SET latitude = 45.668, longitude = -73.867 WHERE id = 'blv-cv'; -- Centre-ville Blainville

-- Rosemère - Corrections
UPDATE zones SET latitude = 45.6325, longitude = -73.8095 WHERE id = 'rsm-pr'; -- Place Rosemère
UPDATE zones SET latitude = 45.634, longitude = -73.815 WHERE id = 'rsm-cv'; -- Centre-ville Rosemère
UPDATE zones SET latitude = 45.6355, longitude = -73.7885 WHERE id = 'rsm-gr'; -- Gare Rosemère (Ste-Rose)

-- Bois-des-Filion - Corrections
UPDATE zones SET latitude = 45.689, longitude = -73.87 WHERE id = 'bdf-cl'; -- Secteur Curé-Labelle
UPDATE zones SET latitude = 45.672, longitude = -73.7925 WHERE id = 'bdf-ar'; -- Aréna Bois-des-Filion
UPDATE zones SET latitude = 45.679, longitude = -73.774 WHERE id = 'bdf-rp'; -- Rue Principale Bois-des-Filion

-- Terrebonne - Corrections
UPDATE zones SET latitude = 45.71, longitude = -73.652 WHERE id = 'trb-cl'; -- Carrefour des Laurentides
UPDATE zones SET latitude = 45.7078, longitude = -73.649 WHERE id = 'trb-vt'; -- Vieux-Terrebonne
UPDATE zones SET latitude = 45.7015, longitude = -73.6485 WHERE id = 'trb-gt'; -- Gare Terrebonne exo
UPDATE zones SET latitude = 45.7095, longitude = -73.6295 WHERE id = 'trb-ct'; -- Cégep de Terrebonne
UPDATE zones SET latitude = 45.734, longitude = -73.4705 WHERE id = 'trb-hp'; -- Hôpital Pierre-Le Gardeur

-- Vérification des corrections principales
SELECT id, name, latitude, longitude 
FROM zones 
WHERE id IN ('lvl-pb', 'lvl-cl', 'mtl-cb', 'mtl-ch')
ORDER BY city_id, name;
