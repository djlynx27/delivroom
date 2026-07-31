-- Correction des coordonnées GPS des zones (audit du 2026-07-31).
--
-- Symptôme rapporté : « ça m'envoie vers l'école Montmorency au lieu de la
-- station », « pour le Centropolis ça m'envoie au centre floral ».
--
-- Méthode : chaque zone a été re-résolue contre OpenStreetMap / Nominatim
--   - lieux nommés  : appariement exact sur le POI OSM (railway=station,
--                     shop=mall, amenity=hospital|college, leisure=stadium…)
--   - intersections : noeuds partagés entre les deux voies nommées (Overpass)
-- Seules les zones dont la preuve est sans ambiguïté sont corrigées ici.
-- Les zones douteuses (POI introuvable, nom qui ne correspond à rien sur le
-- terrain) sont listées en fin de fichier et laissées telles quelles : elles
-- demandent un arbitrage, pas une correction automatique.
--
-- Le commentaire en fin de ligne indique l'écart avec l'ancienne valeur.

BEGIN;

-- ── Montréal ────────────────────────────────────────────────────────────────
-- Pointait au milieu des pistes ; on vise le débarcadère des arrivées.
UPDATE public.zones SET latitude = 45.457128, longitude = -73.749619 WHERE id = 'mtl-yul';  -- 1.4 km
UPDATE public.zones SET latitude = 45.539184, longitude = -73.613424 WHERE id = 'mtl-jt';   -- 0.31 km (station Jean-Talon)
UPDATE public.zones SET latitude = 45.508405, longitude = -73.566543 WHERE id = 'mtl-qs';   -- 0.33 km (Place des Arts)
UPDATE public.zones SET latitude = 45.506873, longitude = -73.578798 WHERE id = 'mtl-mg';   -- 0.26 km (campus McGill)
UPDATE public.zones SET latitude = 45.511355, longitude = -73.556923 WHERE id = 'mtl-ch';   -- 0.44 km (CHUM, 1051 Sanguinet)
-- Était sur l'île Sainte-Hélène ; le casino est sur l'île Notre-Dame.
UPDATE public.zones SET latitude = 45.505510, longitude = -73.525828 WHERE id = 'mtl-ca';   -- 1.14 km
UPDATE public.zones SET latitude = 45.528502, longitude = -73.647969 WHERE id = 'mtl-rk';   -- 1.24 km (Centre Rockland)
-- La zone vise l'artère commerciale : on la recentre sur Saint-Denis/Mont-Royal.
UPDATE public.zones SET latitude = 45.524095, longitude = -73.583039 WHERE id = 'mtl-mr';   -- 0.50 km
UPDATE public.zones SET latitude = 45.497190, longitude = -73.575720 WHERE id = 'mtl-cs';   -- 0.11 km (croisement exact)
UPDATE public.zones SET latitude = 45.543060, longitude = -73.606518 WHERE id = 'mtl-belanger-chambord';        -- 0.69 km (croisement OSM)
UPDATE public.zones SET latitude = 45.499774, longitude = -73.751053 WHERE id = 'mtl-valiquette-pitfield';      -- 2.47 km (croisement OSM)
UPDATE public.zones SET latitude = 45.461530, longitude = -73.822880 WHERE id = 'mtl-transcanadienne-autoroute'; -- 1.41 km (av. Holiday, Pointe-Claire)

-- ── Laval ───────────────────────────────────────────────────────────────────
-- Le point tombait entre le métro et le collège : on vise le terminus du métro.
UPDATE public.zones SET latitude = 45.558353, longitude = -73.721518 WHERE id = 'lvl-mm';  -- 0.18 km
UPDATE public.zones SET latitude = 45.559957, longitude = -73.719121 WHERE id = 'lvl-cm';  -- 0.33 km (475 boul. de l'Avenir)
UPDATE public.zones SET latitude = 45.560230, longitude = -73.681799 WHERE id = 'lvl-ct';  -- 0.50 km (station Cartier)
UPDATE public.zones SET latitude = 45.560149, longitude = -73.709824 WHERE id = 'lvl-dc';  -- 2.79 km (station De la Concorde)
-- Envoyait au centre floral ; le Centropolis est sur la Promenade du Centropolis.
UPDATE public.zones SET latitude = 45.562258, longitude = -73.744674 WHERE id = 'lvl-cp';  -- 2.68 km
UPDATE public.zones SET latitude = 45.602584, longitude = -73.710236 WHERE id = 'lvl-hp';  -- 2.96 km (Cité-de-la-Santé)
UPDATE public.zones SET latitude = 45.625284, longitude = -73.764425 WHERE id = 'lvl-gs';  -- 2.07 km (gare Sainte-Rose)
UPDATE public.zones SET latitude = 45.555842, longitude = -73.721663 WHERE id = 'lvl-pb';  -- 0.18 km (1950 rue Claude-Gagné)
-- Pointait près de Sorel, à 51 km de Laval — la pire erreur du lot.
UPDATE public.zones SET latitude = 45.557094, longitude = -73.721173 WHERE id = 'lvl-paiement-claude';     -- 51.1 km
UPDATE public.zones SET latitude = 45.558444, longitude = -73.722424 WHERE id = 'lvl-tetreault-paiement';  -- 7.2 km
UPDATE public.zones SET latitude = 45.544154, longitude = -73.739052 WHERE id = 'lvl-chomedey-notre';      -- 1.79 km

-- ── Longueuil / Rive-Sud ────────────────────────────────────────────────────
UPDATE public.zones SET latitude = 45.528776, longitude = -73.515517 WHERE id = 'lng-pl';   -- 0.34 km (Place Longueuil)
-- Le Mail Champlain est à Brossard, pas au centre de Longueuil.
UPDATE public.zones SET latitude = 45.471776, longitude = -73.471554 WHERE id = 'lng-mc';   -- 5.59 km
UPDATE public.zones SET latitude = 45.496966, longitude = -73.486550 WHERE id = 'lng-hc';   -- 1.06 km (3120 boul. Taschereau)
UPDATE public.zones SET latitude = 45.535936, longitude = -73.493890 WHERE id = 'lng-em';   -- 1.66 km (ch. de Chambly)
UPDATE public.zones SET latitude = 45.505370, longitude = -73.378055 WHERE id = 'lng-psb';  -- 0.58 km (Promenades Saint-Bruno)
UPDATE public.zones SET latitude = 45.438061, longitude = -73.430582 WHERE id = 'lng-rem';  -- 1.77 km (terminus REM Brossard)

-- ── Couronne nord ───────────────────────────────────────────────────────────
UPDATE public.zones SET latitude = 45.672176, longitude = -73.865831 WHERE id = 'blv-gb';   -- 0.84 km (gare Blainville)
UPDATE public.zones SET latitude = 45.630634, longitude = -73.819278 WHERE id = 'rsm-pr';   -- 0.79 km (Place Rosemère)
UPDATE public.zones SET latitude = 45.634566, longitude = -73.795901 WHERE id = 'rsm-gr';   -- 0.56 km (gare Rosemère)
UPDATE public.zones SET latitude = 45.635984, longitude = -73.834121 WHERE id = 'sth-gs';   -- 0.52 km (gare Sainte-Thérèse)
UPDATE public.zones SET latitude = 45.642839, longitude = -73.842701 WHERE id = 'sth-cl';   -- 1.22 km (Collège Lionel-Groulx)
-- Le centre commercial de Boisbriand s'appelle Faubourg Boisbriand.
UPDATE public.zones SET latitude = 45.628105, longitude = -73.848388 WHERE id = 'bsb-pb';   -- 2.43 km

-- ── Terrebonne ──────────────────────────────────────────────────────────────
UPDATE public.zones SET latitude = 45.702803, longitude = -73.646687 WHERE id = 'trb-cl';   -- 0.90 km (Galeries Terrebonne)
-- Pointait près des Galeries ; le Vieux-Terrebonne est à l'Île-des-Moulins.
UPDATE public.zones SET latitude = 45.692743, longitude = -73.638519 WHERE id = 'trb-vt';   -- 1.86 km
UPDATE public.zones SET latitude = 45.720999, longitude = -73.705160 WHERE id = 'trb-ct';   -- 6.01 km (Cégep de Lanaudière)
UPDATE public.zones SET latitude = 45.728427, longitude = -73.521169 WHERE id = 'trb-gt';   -- 10.33 km (gare exo Terrebonne)
UPDATE public.zones SET latitude = 45.723861, longitude = -73.510702 WHERE id = 'trb-hp';   -- 3.32 km (Pierre-Le Gardeur)

COMMIT;

-- ── Zones NON corrigées, à arbitrer manuellement ────────────────────────────
-- Aucune preuve fiable trouvée : le lieu nommé n'existe pas, ou la coordonnée
-- actuelle est un simple placeholder arrondi. Les corriger « au jugé » ferait
-- plus de mal que de bien.
--
--   bsb-cn  « Carrefour du Nord »        Le vrai Carrefour du Nord est à
--                                        SAINT-JÉRÔME (45.7939, -74.0181),
--                                        à 20 km de Boisbriand. Zone à
--                                        déplacer, renommer ou supprimer.
--   bsb-gb  « Gare Boisbriand exo »      Aucune gare exo à Boisbriand : la
--                                        ligne dessert Sainte-Thérèse et
--                                        Rosemère. Zone probablement fictive.
--   sth-gal « Galeries Sainte-Thérèse »  Aucun centre commercial de ce nom.
--   blv-cs  « Complexe sportif »         Introuvable à Blainville.
--   blv-cc / blv-cv / rsm-cv / sth-cv    Coordonnées = centroïde municipal
--                                        arrondi, pas un lieu de prise en
--                                        charge réel.
--   bdf-ar / bdf-rp / bdf-cl             Les 3 zones de Bois-des-Filion sont
--                                        1.8 à 9 km à l'ouest de la ville
--                                        (centre réel : 45.6701, -73.7549).
--                                        bdf-cl est carrément à Blainville.
--   lvl-pl  « Place Laval »              Deux candidats incompatibles ;
--                                        à confirmer sur le terrain.
--   mtl-vp  « Vieux-Port »               Le POI est une longue bande ; le
--                                        point actuel (45.5087, -73.5520)
--                                        reste utilisable.
--   lvl-croissant-langevin               Coordonnées correctes (croisement
--                                        confirmé) mais city_id = 'lvl' alors
--                                        que le lieu est à Saint-Laurent
--                                        (Montréal). Étiquette à corriger.
