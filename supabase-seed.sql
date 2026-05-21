-- Helper générique pour upsert sur weight_history
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION upsert_weight_history(
    p_weights jsonb,
    p_prediction_mae numeric,
    p_triggered_by text,
    p_created_at timestamptz
  ) RETURNS void AS $$
  BEGIN
    UPDATE public.weight_history
    SET weights = p_weights,
        prediction_mae = p_prediction_mae
    WHERE triggered_by = p_triggered_by
      AND created_at = p_created_at;
    IF NOT FOUND THEN
      INSERT INTO public.weight_history (
        weights, prediction_mae, triggered_by, created_at
      ) VALUES (
        p_weights, p_prediction_mae, p_triggered_by, p_created_at
      );
    END IF;
  END;
  $$ LANGUAGE plpgsql;
END $$;

-- Helper générique pour upsert sur session_zones
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION upsert_session_zone(
    p_session_id bigint,
    p_zone_id text,
    p_entered_at timestamptz,
    p_exited_at timestamptz,
    p_rides_count integer,
    p_earnings numeric,
    p_predicted_score integer,
    p_factors_snapshot jsonb
  ) RETURNS void AS $$
  BEGIN
    UPDATE public.session_zones
    SET exited_at = p_exited_at,
        rides_count = p_rides_count,
        earnings = p_earnings,
        predicted_score = p_predicted_score,
        factors_snapshot = p_factors_snapshot
    WHERE session_id = p_session_id
      AND zone_id = p_zone_id
      AND entered_at = p_entered_at;
    IF NOT FOUND THEN
      INSERT INTO public.session_zones (
        session_id, zone_id, entered_at, exited_at, rides_count, earnings, predicted_score, factors_snapshot
      ) VALUES (
        p_session_id, p_zone_id, p_entered_at, p_exited_at, p_rides_count, p_earnings, p_predicted_score, p_factors_snapshot
      );
    END IF;
  END;
  $$ LANGUAGE plpgsql;
END $$;

-- Helper générique pour upsert sur predictions
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION upsert_prediction(
    p_zone_id text,
    p_predicted_at timestamptz,
    p_predicted_score integer,
    p_factors_snapshot jsonb,
    p_actual_earnings_per_hour numeric,
    p_prediction_error numeric
  ) RETURNS void AS $$
  BEGIN
    UPDATE public.predictions
    SET factors_snapshot = p_factors_snapshot,
        actual_earnings_per_hour = p_actual_earnings_per_hour,
        prediction_error = p_prediction_error
    WHERE zone_id = p_zone_id
      AND predicted_at = p_predicted_at
      AND predicted_score = p_predicted_score;
    IF NOT FOUND THEN
      INSERT INTO public.predictions (
        zone_id, predicted_at, predicted_score, factors_snapshot, actual_earnings_per_hour, prediction_error
      ) VALUES (
        p_zone_id, p_predicted_at, p_predicted_score, p_factors_snapshot, p_actual_earnings_per_hour, p_prediction_error
      );
    END IF;
  END;
  $$ LANGUAGE plpgsql;
END $$;

-- Helper générique pour upsert sur demand_patterns
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION upsert_demand_pattern(
    p_zone_id text,
    p_context_vector vector,
    p_actual_earnings_per_hour numeric
  ) RETURNS void AS $$
  BEGIN
    UPDATE public.demand_patterns
    SET actual_earnings_per_hour = p_actual_earnings_per_hour
    WHERE zone_id = p_zone_id
      AND context_vector = p_context_vector;
    IF NOT FOUND THEN
      INSERT INTO public.demand_patterns (
        zone_id, context_vector, actual_earnings_per_hour
      ) VALUES (
        p_zone_id, p_context_vector, p_actual_earnings_per_hour
      );
    END IF;
  END;
  $$ LANGUAGE plpgsql;
END $$;

-- Helper générique pour upsert sur scores
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION upsert_score(
    p_zone_id text,
    p_score numeric,
    p_weather_boost numeric,
    p_event_boost numeric,
    p_final_score numeric,
    p_calculated_at timestamptz
  ) RETURNS void AS $$
  BEGIN
    UPDATE public.scores
    SET score = p_score,
        weather_boost = p_weather_boost,
        event_boost = p_event_boost,
        final_score = p_final_score
    WHERE zone_id = p_zone_id
      AND calculated_at = p_calculated_at;
    IF NOT FOUND THEN
      INSERT INTO public.scores (
        zone_id, score, weather_boost, event_boost, final_score, calculated_at
      ) VALUES (
        p_zone_id, p_score, p_weather_boost, p_event_boost, p_final_score, p_calculated_at
      );
    END IF;
  END;
  $$ LANGUAGE plpgsql;
END $$;

-- ============================================================
-- Seed: Données réelles HustleGo
-- Source: zones bubble.csv + QuickBooks_Mileage.csv
-- Note: Le schéma (CREATE TABLE) est dans les migrations.
-- Exécution:
--   1. Supabase Dashboard > SQL Editor
--   2. Coller ce fichier complet
--   3. Exécuter le script
--   4. Recharger Admin > Apprentissage IA
-- Idempotence:
--   - cities / zones / daily_reports / events utilisent ON CONFLICT avec update
--   - learning seed et observability seed sont auto-réparables au rerun
--   - sessions seed sont retrouvées via une identité métier stable puis remises à niveau
--   - session_zones sont remis à niveau puis insérés si manquants
--   - demand_patterns sont remis à niveau via zone_id + context_vector puis insérés si manquants
--   - predictions et scores sont remis à niveau puis insérés si manquants
--   - weight_history est remis à niveau via triggered_by + created_at puis inséré si manquant
-- ============================================================

-- ── Villes ──────────────────────────────────────────────────
INSERT INTO cities (id, name) VALUES
  ('mtl', 'Montréal'),
  ('lvl', 'Laval'),
  ('lng', 'Longueuil'),
  ('bsb', 'Boisbriand'),
  ('sth', 'Sainte-Thérèse'),
  ('blv', 'Blainville'),
  ('rsm', 'Rosemère'),
  ('bdf', 'Bois-des-Filion'),
  ('trb', 'Terrebonne')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ── Zones (coordonnées GPS réelles) ─────────────────────────
INSERT INTO zones (id, city_id, name, type, latitude, longitude) VALUES
  ('mtl-yul', 'mtl', 'Aéroport Trudeau (YUL)', 'aéroport', 45.4706, -73.7408),
  ('mtl-gc', 'mtl', 'Gare Centrale', 'transport', 45.4994, -73.5685),
  ('mtl-bq', 'mtl', 'Station Berri-UQAM', 'métro', 45.5163, -73.5694),
  ('mtl-ll', 'mtl', 'Station Lionel-Groulx', 'métro', 45.4734, -73.5773),
  ('mtl-jt', 'mtl', 'Station Jean-Talon', 'métro', 45.5353, -73.6238),
  ('mtl-cv', 'mtl', 'Station Côte-Vertu', 'métro', 45.5058, -73.7438),
  ('mtl-qs', 'mtl', 'Quartier des spectacles', 'nightlife', 45.5088, -73.5603),
  ('mtl-cs', 'mtl', 'Crescent Sainte-Catherine', 'nightlife', 45.4985, -73.5795),
  ('mtl-vp', 'mtl', 'Vieux-Port de Montréal', 'tourisme', 45.5088, -73.554),
  ('mtl-cb', 'mtl', 'Centre Bell', 'événements', 45.496, -73.5694),
  ('mtl-so', 'mtl', 'Stade olympique', 'événements', 45.5597, -73.5515),
  ('mtl-rk', 'mtl', 'Centre commercial Rockland', 'commercial', 45.4942, -73.662),
  ('mtl-mj', 'mtl', 'Marché Jean-Talon', 'commercial', 45.5349, -73.6148),
  ('mtl-ch', 'mtl', 'CHUM Hôpital', 'médical', 45.511, -73.556),
  ('mtl-mg', 'mtl', 'Université McGill', 'université', 45.5048, -73.5772),
  ('mtl-uq', 'mtl', 'UQAM', 'université', 45.5094, -73.5688),
  ('mtl-ph', 'mtl', 'Plaza Saint-Hubert', 'commercial', 45.5402, -73.5845),
  ('mtl-mr', 'mtl', 'Avenue Mont-Royal', 'résidentiel', 45.5268, -73.585),
  ('mtl-ca', 'mtl', 'Casino de Montréal', 'nightlife', 45.5095, -73.5296),
  ('lvl-mm', 'lvl', 'Station Montmorency', 'métro', 45.5585, -73.7114),
  ('lvl-ct', 'lvl', 'Station Cartier', 'métro', 45.5503, -73.7006),
  ('lvl-dc', 'lvl', 'Station De La Concorde', 'métro', 45.5446, -73.6936),
  ('lvl-cl', 'lvl', 'Carrefour Laval', 'commercial', 45.5702, -73.7519),
  ('lvl-cp', 'lvl', 'Centropolis Laval', 'nightlife', 45.5572, -73.7468),
  ('lvl-pl', 'lvl', 'Place Laval', 'commercial', 45.5422, -73.7167),
  ('lvl-hp', 'lvl', 'Hôpital Cité-de-la-Santé', 'médical', 45.5535, -73.7528),
  ('lvl-cm', 'lvl', 'Cégep Montmorency', 'université', 45.5592, -73.7118),
  ('lvl-um', 'lvl', 'Université de Montréal Laval', 'université', 45.5718, -73.735),
  ('lvl-gs', 'lvl', 'Gare Sainte-Rose', 'transport', 45.6049, -73.7698),
  ('lvl-pb', 'lvl', 'Place Bell', 'événements', 45.5562, -73.7203),
  ('lng-us', 'lng', 'Station Longueuil U. Sherbrooke', 'métro', 45.5252, -73.5205),
  ('lng-tl', 'lng', 'Terminus Longueuil', 'transport', 45.5254, -73.5198),
  ('lng-mc', 'lng', 'Mail Champlain', 'commercial', 45.5001, -73.4998),
  ('lng-pl', 'lng', 'Place Longueuil', 'commercial', 45.5255, -73.5176),
  ('lng-hc', 'lng', 'Hôpital Charles-Le Moyne', 'médical', 45.5223, -73.5068),
  ('lng-vl', 'lng', 'Vieux-Longueuil', 'résidentiel', 45.5311, -73.5066),
  ('lng-em', 'lng', 'Cégep Édouard-Montpetit', 'université', 45.4991, -73.5053),
  ('lng-us2', 'lng', 'Université de Sherbrooke Longueuil', 'université', 45.4998, -73.5045),
  ('lng-psb', 'lng', 'Promenades Saint-Bruno', 'commercial', 45.5311, -73.3581),
  ('lng-rem', 'lng', 'Gare Brossard REM', 'transport', 45.4582, -73.4718),
  -- Boisbriand
  ('bsb-gb', 'bsb', 'Gare Boisbriand exo', 'transport', 45.6202, -73.8428),
  ('bsb-cn', 'bsb', 'Carrefour du Nord', 'commercial', 45.6234, -73.8396),
  ('bsb-pb', 'bsb', 'Promenades de Boisbriand', 'commercial', 45.6281, -73.8494),
  -- Sainte-Thérèse
  ('sth-gs', 'sth', 'Gare Sainte-Thérèse exo', 'transport', 45.6435, -73.8284),
  ('sth-cv', 'sth', 'Centre-ville Sainte-Thérèse', 'résidentiel', 45.6422, -73.8295),
  ('sth-cl', 'sth', 'Cégep Lionel-Groulx', 'université', 45.6462, -73.8408),
  ('sth-gal', 'sth', 'Galeries Sainte-Thérèse', 'commercial', 45.6380, -73.8248),
  -- Blainville
  ('blv-gb', 'blv', 'Gare Blainville exo', 'transport', 45.6784, -73.8648),
  ('blv-cs', 'blv', 'Complexe sportif de Blainville', 'événements', 45.6715, -73.8878),
  ('blv-cc', 'blv', 'Centre commercial Blainville', 'commercial', 45.6750, -73.8779),
  ('blv-cv', 'blv', 'Centre-ville Blainville', 'résidentiel', 45.6700, -73.8649),
  -- Rosemère
  ('rsm-pr', 'rsm', 'Place Rosemère', 'commercial', 45.6365, -73.7993),
  ('rsm-cv', 'rsm', 'Centre-ville Rosemère', 'résidentiel', 45.6390, -73.7950),
  ('rsm-gr', 'rsm', 'Gare Rosemère (Ste-Rose)', 'transport', 45.6250, -73.7643),
  -- Bois-des-Filion
  ('bdf-cl', 'bdf', 'Secteur Curé-Labelle', 'commercial', 45.6691, -73.7563),
  ('bdf-ar', 'bdf', 'Aréna Bois-des-Filion', 'événements', 45.6658, -73.7603),
  ('bdf-rp', 'bdf', 'Rue Principale Bois-des-Filion', 'résidentiel', 45.6670, -73.7588),
  -- Terrebonne
  ('trb-cl', 'trb', 'Carrefour des Laurentides', 'commercial', 45.7040, -73.6420),
  ('trb-vt', 'trb', 'Vieux-Terrebonne', 'tourisme', 45.7017, -73.6449),
  ('trb-gt', 'trb', 'Gare Terrebonne exo', 'transport', 45.7033, -73.6367),
  ('trb-ct', 'trb', 'Cégep de Terrebonne', 'université', 45.6942, -73.6449),
  ('trb-hp', 'trb', 'Hôpital Pierre-Le Gardeur', 'médical', 45.7248, -73.4800)
ON CONFLICT (id) DO UPDATE SET
  city_id = EXCLUDED.city_id,
  name = EXCLUDED.name, type = EXCLUDED.type,
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude;

-- ── Rapports journaliers (données réelles QuickBooks fév-mars 2026) ──
INSERT INTO daily_reports (id, report_date, total_trips, total_distance_km, hours_worked, total_earnings, dead_time_pct, ai_recommendation) VALUES
  (gen_random_uuid(), '2026-02-05', 3, 132.9, 5.3, 248.23, 18, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-02-06', 5, 226.6, 9.1, 422.88, 12, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-07', 3, 157.3, 6.3, 292.05, 24, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-08', 6, 360.8, 14.4, 667.4, 10, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-02-09', 6, 197.1, 7.9, 372.86, 13, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-10', 7, 248, 9.9, 467.36, 23, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-11', 3, 184, 7.4, 340.16, 28, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-12', 5, 213, 8.5, 398.31, 13, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-13', 5, 172.8, 6.9, 326.13, 16, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-14', 9, 259.3, 10.4, 493.78, 20, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-02-15', 6, 171, 6.8, 325.82, 12, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-16', 6, 254.3, 10.2, 475.72, 18, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-02-17', 7, 258.4, 10.3, 486.18, 28, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-02-18', 6, 305, 12.2, 566.93, 22, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-02-19', 9, 154.3, 6.2, 304.78, 24, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-20', 8, 319.4, 12.8, 598.85, 30, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-02-21', 7, 319.5, 12.8, 596.14, 14, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-02-22', 6, 135, 5.4, 261.06, 27, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-02-23', 6, 253.2, 10.1, 473.8, 24, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-02-24', 6, 174.8, 7, 332.57, 14, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-02-25', 6, 121.9, 4.9, 237.43, 15, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-02-26', 4, 5, 0.2, 21.07, 24, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-02-27', 6, 100, 4, 198, 23, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-02-28', 5, 157.4, 6.3, 298.33, 11, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-03-01', 5, 191.5, 7.7, 359.66, 21, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-03-02', 6, 361.6, 14.5, 668.93, 12, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-03-03', 8, 242.2, 9.7, 459.88, 10, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-03-04', 7, 206, 8.2, 391.86, 14, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-03-05', 4, 27.1, 1.1, 60.72, 24, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-03-06', 3, 143.3, 5.7, 266.89, 13, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-03-07', 5, 73.2, 2.9, 146.73, 24, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-03-08', 6, 246.9, 9.9, 462.46, 25, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-03-09', 9, 253.1, 10.1, 482.57, 20, 'Excellente journée — continue sur ta lancée!'),
  (gen_random_uuid(), '2026-03-10', 6, 222.6, 8.9, 418.65, 24, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-03-11', 4, 158, 6.3, 296.34, 24, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-03-12', 5, 214.7, 8.6, 401.5, 20, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-03-13', 4, 242.4, 9.7, 448.29, 18, 'Bonne performance — concentre-toi sur les heures de pointe.'),
  (gen_random_uuid(), '2026-03-14', 4, 105.2, 4.2, 201.39, 19, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-03-15', 2, 76.7, 3.1, 144.1, 14, 'Journée légère — cible les stations de métro et l''aéroport.'),
  (gen_random_uuid(), '2026-03-16', 7, 132.8, 5.3, 260.06, 28, 'Journée légère — cible les stations de métro et l''aéroport.')
ON CONFLICT (report_date) DO UPDATE SET
  total_trips = EXCLUDED.total_trips,
  total_distance_km = EXCLUDED.total_distance_km,
  hours_worked = EXCLUDED.hours_worked,
  total_earnings = EXCLUDED.total_earnings,
  dead_time_pct = EXCLUDED.dead_time_pct,
  ai_recommendation = EXCLUDED.ai_recommendation;

-- ── Événements de démonstration (Mars 2026 — Montréal) ──────
INSERT INTO public.events (
  id, name, venue, city_id,
  latitude, longitude,
  start_at, end_at,
  capacity, demand_impact, boost_multiplier, boost_radius_km,
  boost_zone_types, category, is_holiday
) VALUES
  ('e0ca0001-cafe-4001-8001-000000000001',
   'Canadiens vs Maple Leafs', 'Centre Bell', 'mtl',
   45.4957, -73.5693,
   '2026-03-18 23:00:00+00', '2026-03-19 02:30:00+00',
   21288, 5, 2.5, 3.0,
   ARRAY['nightlife','commercial'], 'hockey', false),

  ('e0ca0001-cafe-4001-8001-000000000002',
   'Festival MTL en Lumière – Clôture', 'Place des Arts', 'mtl',
   45.5088, -73.5682,
   '2026-03-19 21:00:00+00', '2026-03-20 03:00:00+00',
   8000, 4, 2.0, 2.5,
   ARRAY['nightlife','commercial','tourisme'], 'festival', false),

  ('e0ca0001-cafe-4001-8001-000000000003',
   'Concert OSM — Beethoven', 'Maison Symphonique', 'mtl',
   45.5085, -73.5689,
   '2026-03-20 01:00:00+00', '2026-03-20 03:00:00+00',
   2100, 3, 1.8, 1.5,
   ARRAY['commercial'], 'event', false),

  ('e0ca0001-cafe-4001-8001-000000000004',
   'Match CF Montréal', 'Saputo Stadium', 'mtl',
   45.5635, -73.5525,
   '2026-03-21 19:00:00+00', '2026-03-21 21:30:00+00',
   13034, 4, 2.2, 2.5,
   ARRAY['commercial','transport','événements'], 'event', false),

  ('e0ca0001-cafe-4001-8001-000000000005',
   'Salon de l''Auto de Montréal', 'Palais des Congrès', 'mtl',
   45.5052, -73.5618,
   '2026-03-22 14:00:00+00', '2026-03-23 00:00:00+00',
   12000, 3, 1.6, 1.8,
   ARRAY['commercial','transport'], 'event', false),

  ('e0ca0001-cafe-4001-8001-000000000006',
   'Nuit Blanche Montréal', 'Centre-ville', 'mtl',
   45.5048, -73.5741,
   '2026-03-22 05:00:00+00', '2026-03-22 11:00:00+00',
   40000, 5, 3.0, 5.0,
   ARRAY['nightlife','commercial','tourisme','événements'], 'festival', false),

  ('e0ca0001-cafe-4001-8001-000000000007',
   'Canadiens vs Sénateurs', 'Centre Bell', 'mtl',
   45.4957, -73.5693,
   '2026-03-24 23:00:00+00', '2026-03-25 02:30:00+00',
   21288, 5, 2.5, 3.0,
   ARRAY['nightlife','commercial'], 'hockey', false),

  ('e0ca00bb-cafe-4001-8001-000000000001',
   'Carrefour Laval — Exposition Printemps', 'Carrefour Laval', 'lvl',
   45.5585, -73.7469,
   '2026-03-22 13:00:00+00', '2026-03-22 23:00:00+00',
   5000, 2, 1.4, 1.5,
   ARRAY['commercial'], 'event', false)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  venue = EXCLUDED.venue,
  city_id = EXCLUDED.city_id,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  start_at = EXCLUDED.start_at,
  end_at = EXCLUDED.end_at,
  capacity = EXCLUDED.capacity,
  demand_impact = EXCLUDED.demand_impact,
  boost_multiplier = EXCLUDED.boost_multiplier,
  boost_radius_km = EXCLUDED.boost_radius_km,
  boost_zone_types = EXCLUDED.boost_zone_types,
  category = EXCLUDED.category,
  is_holiday = EXCLUDED.is_holiday;

-- ── Données learning / sessions de démonstration ────────────
DO $$
DECLARE
  seeded_session_id bigint;
BEGIN
  SELECT s.id
  INTO seeded_session_id
  FROM public.sessions s
  WHERE s.started_at = '2026-03-16 21:00:00+00'
    AND s.ended_at = '2026-03-17 01:30:00+00'
    AND s.notes = 'Session seed de démonstration pour la boucle learning.'
  ORDER BY s.id DESC
  LIMIT 1;

  IF seeded_session_id IS NULL THEN
    INSERT INTO public.sessions (
      started_at,
      ended_at,
      total_earnings,
      total_rides,
      total_hours,
      weather_snapshot,
      notes
    ) VALUES (
      '2026-03-16 21:00:00+00',
      '2026-03-17 01:30:00+00',
      182.50,
      5,
      4.5,
      jsonb_build_object('accuracy_percent', 87, 'mean_absolute_error', 13),
      'Session seed de démonstration pour la boucle learning.'
    )
    RETURNING id INTO seeded_session_id;
  ELSE
    UPDATE public.sessions
    SET total_earnings = 182.50,
        total_rides = 5,
        total_hours = 4.5,
        weather_snapshot = jsonb_build_object(
          'accuracy_percent', 87,
          'mean_absolute_error', 13
        ),
        notes = 'Session seed de démonstration pour la boucle learning.'
    WHERE id = seeded_session_id;
  END IF;

  PERFORM upsert_session_zone(
    seeded_session_id,
    'mtl-cb',
    '2026-03-16 21:05:00+00',
    '2026-03-16 23:10:00+00',
    3,
    118.50,
    74,
    jsonb_build_object('source', 'seed', 'zone_type', 'événements')
  );

  PERFORM upsert_session_zone(
    seeded_session_id,
    'mtl-bq',
    '2026-03-16 23:20:00+00',
    '2026-03-17 01:20:00+00',
    2,
    64.00,
    56,
    jsonb_build_object('source', 'seed', 'zone_type', 'métro')
  );

  PERFORM upsert_prediction(
    'mtl-cb',
    '2026-03-16 21:05:00+00',
    74,
    jsonb_build_object('source', 'seed', 'platform', 'uber'),
    52.60,
    14.0000
  );

  PERFORM upsert_prediction(
    'mtl-bq',
    '2026-03-16 23:20:00+00',
    56,
    jsonb_build_object('source', 'seed', 'platform', 'lyft'),
    31.90,
    -3.0000
  );

  UPDATE public.predictions
  SET factors_snapshot = jsonb_build_object('source', 'seed', 'platform', 'uber'),
      actual_earnings_per_hour = 52.60,
      prediction_error = 14.0000
  WHERE zone_id = 'mtl-cb'
    AND predicted_at = '2026-03-16 21:05:00+00'
    AND predicted_score = 74;

  INSERT INTO public.predictions (
    zone_id,
    predicted_at,
    predicted_score,
    factors_snapshot,
    actual_earnings_per_hour,
    prediction_error
  )
  SELECT
    'mtl-cb',
    '2026-03-16 21:05:00+00',
    74,
    jsonb_build_object('source', 'seed', 'platform', 'uber'),
    52.60,
    14.0000
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.predictions p
    WHERE p.zone_id = 'mtl-cb'
      AND p.predicted_at = '2026-03-16 21:05:00+00'
      AND p.predicted_score = 74
  );

  UPDATE public.predictions
  SET factors_snapshot = jsonb_build_object('source', 'seed', 'platform', 'lyft'),
      actual_earnings_per_hour = 31.90,
      prediction_error = -3.0000
  WHERE zone_id = 'mtl-bq'
    AND predicted_at = '2026-03-16 23:20:00+00'
    AND predicted_score = 56;

  INSERT INTO public.predictions (
    zone_id,
    predicted_at,
    predicted_score,
    factors_snapshot,
    actual_earnings_per_hour,
    prediction_error
  )
  SELECT
    'mtl-bq',
    '2026-03-16 23:20:00+00',
    56,
    jsonb_build_object('source', 'seed', 'platform', 'lyft'),
    31.90,
    -3.0000
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.predictions p
    WHERE p.zone_id = 'mtl-bq'
      AND p.predicted_at = '2026-03-16 23:20:00+00'
      AND p.predicted_score = 56
  );

  PERFORM upsert_weight_history(
    jsonb_build_object(
      'timeOfDay', 0.24,
      'dayOfWeek', 0.14,
      'weather', 0.15,
      'events', 0.18,
      'historicalEarnings', 0.11,
      'transitDisruption', 0.08,
      'trafficCongestion', 0.06,
      'winterConditions', 0.04
    ),
    8.5,
    'seed_demo',
    '2026-03-17 01:35:00+00'
  );

  INSERT INTO public.ema_patterns (
    zone_id,
    day_of_week,
    hour_block,
    ema_earnings_per_hour,
    ema_ride_count,
    observation_count,
    last_updated
  ) VALUES
    ('mtl-cb', 1, 84, 52.60, 2.40, 5, now()),
    ('mtl-bq', 1, 93, 31.90, 1.60, 4, now())
  ON CONFLICT (zone_id, day_of_week, hour_block) DO UPDATE SET
    ema_earnings_per_hour = EXCLUDED.ema_earnings_per_hour,
    ema_ride_count = EXCLUDED.ema_ride_count,
    observation_count = EXCLUDED.observation_count,
    last_updated = EXCLUDED.last_updated;

  INSERT INTO public.zone_beliefs (
    zone_id,
    day_of_week,
    hour_block,
    prior_mean,
    prior_variance,
    observation_count,
    last_updated
  ) VALUES
    ('mtl-cb', 1, 84, 49.25, 24.5000, 5, now()),
    ('mtl-bq', 1, 93, 32.75, 28.0000, 4, now())
  ON CONFLICT (zone_id, day_of_week, hour_block) DO UPDATE SET
    prior_mean = EXCLUDED.prior_mean,
    prior_variance = EXCLUDED.prior_variance,
    observation_count = EXCLUDED.observation_count,
    last_updated = EXCLUDED.last_updated;

  UPDATE public.demand_patterns
  SET actual_earnings_per_hour = 52.60
  WHERE zone_id = 'mtl-cb'
    AND context_vector = '[0.5,0.866025,0.781831,0.62349,0.876,0.425,0.3,0.2,1,0,0,0,0.25,1,1,0.88]'::vector;

  INSERT INTO public.demand_patterns (
    zone_id,
    context_vector,
    actual_earnings_per_hour
  )
  SELECT
    'mtl-cb',
    '[0.5,0.866025,0.781831,0.62349,0.876,0.425,0.3,0.2,1,0,0,0,0.25,1,1,0.88]',
    52.60
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.demand_patterns dp
    WHERE dp.zone_id = 'mtl-cb'
      AND dp.context_vector = '[0.5,0.866025,0.781831,0.62349,0.876,0.425,0.3,0.2,1,0,0,0,0.25,1,1,0.88]'::vector
  );

  UPDATE public.demand_patterns
  SET actual_earnings_per_hour = 48.10
  WHERE zone_id = 'mtl-cb'
    AND context_vector = '[0.258819,0.965926,0.781831,0.62349,0.812,0.39,0.28,0.16,0,1,0,0,0.25,1,1,0.84]'::vector;

  INSERT INTO public.demand_patterns (
    zone_id,
    context_vector,
    actual_earnings_per_hour
  )
  SELECT
    'mtl-cb',
    '[0.258819,0.965926,0.781831,0.62349,0.812,0.39,0.28,0.16,0,1,0,0,0.25,1,1,0.84]',
    48.10
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.demand_patterns dp
    WHERE dp.zone_id = 'mtl-cb'
      AND dp.context_vector = '[0.258819,0.965926,0.781831,0.62349,0.812,0.39,0.28,0.16,0,1,0,0,0.25,1,1,0.84]'::vector
  );

  UPDATE public.demand_patterns
  SET actual_earnings_per_hour = 31.90
  WHERE zone_id = 'mtl-bq'
    AND context_vector = '[-0.258819,-0.965926,0.781831,0.62349,0.532,0.24,0.25,0.08,1,0,0,0,0.25,1,0,0.53]'::vector;

  INSERT INTO public.demand_patterns (
    zone_id,
    context_vector,
    actual_earnings_per_hour
  )
  SELECT
    'mtl-bq',
    '[-0.258819,-0.965926,0.781831,0.62349,0.532,0.24,0.25,0.08,1,0,0,0,0.25,1,0,0.53]',
    31.90
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.demand_patterns dp
    WHERE dp.zone_id = 'mtl-bq'
      AND dp.context_vector = '[-0.258819,-0.965926,0.781831,0.62349,0.532,0.24,0.25,0.08,1,0,0,0,0.25,1,0,0.53]'::vector
  );
END $$;

-- ── Observabilité IA / Hallucination Firewall (seed démo) ───────────────
-- Données récentes pour alimenter le panneau Admin > Apprentissage IA.
DO $$
BEGIN
  PERFORM upsert_score(
    'mtl-cb', 68.00, 4.00, 10.00, 79.50, '2026-03-22 19:00:00+00');
  PERFORM upsert_score(
    'mtl-bq', 54.00, 2.00, 1.50, 50.00, '2026-03-22 19:00:00+00');
  PERFORM upsert_score(
    'mtl-yul', 82.00, 3.00, 0.00, 90.00, '2026-03-22 19:30:00+00');
  PERFORM upsert_score(
    'lvl-cp', 61.00, 1.00, 6.00, 74.00, '2026-03-22 19:45:00+00');
  PERFORM upsert_score(
    'lng-us', 58.00, 0.50, 0.00, 55.50, '2026-03-22 20:00:00+00');
  PERFORM upsert_score(
    'trb-vt', 47.00, 0.00, 3.00, 62.00, '2026-03-22 20:15:00+00');
  PERFORM upsert_prediction(
    'mtl-yul',
    '2026-03-19 17:00:00+00',
    88,
    jsonb_build_object('source', 'seed_observability', 'platform', 'lyft'),
    61.20,
    6.5000
  );

  INSERT INTO public.predictions (
    zone_id,
    predicted_at,
    predicted_score,
    factors_snapshot,
    actual_earnings_per_hour,
    prediction_error
  )
  SELECT
    'mtl-yul',
    '2026-03-19 17:00:00+00',
    88,
    jsonb_build_object('source', 'seed_observability', 'platform', 'lyft'),
    61.20,
    6.5000
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.predictions p
    WHERE p.zone_id = 'mtl-yul'
      AND p.predicted_at = '2026-03-19 17:00:00+00'
      AND p.predicted_score = 88
  );

  PERFORM upsert_prediction(
    'lvl-cp',
    '2026-03-20 16:00:00+00',
    72,
    jsonb_build_object('source', 'seed_observability', 'platform', 'uber'),
    45.80,
    -4.2500
  );

  INSERT INTO public.predictions (
    zone_id,
    predicted_at,
    predicted_score,
    factors_snapshot,
    actual_earnings_per_hour,
    prediction_error
  )
  SELECT
    'lvl-cp',
    '2026-03-20 16:00:00+00',
    72,
    jsonb_build_object('source', 'seed_observability', 'platform', 'uber'),
    45.80,
    -4.2500
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.predictions p
    WHERE p.zone_id = 'lvl-cp'
      AND p.predicted_at = '2026-03-20 16:00:00+00'
      AND p.predicted_score = 72
  );

  PERFORM upsert_prediction(
    'lng-us',
    '2026-03-21 08:00:00+00',
    59,
    jsonb_build_object('source', 'seed_observability', 'platform', 'lyft'),
    34.30,
    2.7500
  );

  INSERT INTO public.predictions (
    zone_id,
    predicted_at,
    predicted_score,
    factors_snapshot,
    actual_earnings_per_hour,
    prediction_error
  )
  SELECT
    'lng-us',
    '2026-03-21 08:00:00+00',
    59,
    jsonb_build_object('source', 'seed_observability', 'platform', 'lyft'),
    34.30,
    2.7500
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.predictions p
    WHERE p.zone_id = 'lng-us'
      AND p.predicted_at = '2026-03-21 08:00:00+00'
      AND p.predicted_score = 59
  );

  PERFORM upsert_weight_history(
    jsonb_build_object(
      'timeOfDay', 0.26,
      'dayOfWeek', 0.15,
      'weather', 0.17,
      'events', 0.19,
      'historicalEarnings', 0.10,
      'transitDisruption', 0.07,
      'trafficCongestion', 0.04,
      'winterConditions', 0.02
    ),
    7.40,
    'seed_observability',
    '2026-03-19 18:00:00+00'
  );

  INSERT INTO public.ema_patterns (
    zone_id,
    day_of_week,
    hour_block,
    ema_earnings_per_hour,
    ema_ride_count,
    observation_count,
    last_updated
  ) VALUES
    ('mtl-cb', 1, 84, 52.60, 2.40, 5, now()),
    ('mtl-bq', 1, 93, 31.90, 1.60, 4, now())
  ON CONFLICT (zone_id, day_of_week, hour_block) DO UPDATE SET
    ema_earnings_per_hour = EXCLUDED.ema_earnings_per_hour,
    ema_ride_count = EXCLUDED.ema_ride_count,
    observation_count = EXCLUDED.observation_count,
    last_updated = EXCLUDED.last_updated;

  INSERT INTO public.zone_beliefs (
    zone_id,
    day_of_week,
    hour_block,
    prior_mean,
    prior_variance,
    observation_count,
    last_updated
  ) VALUES
    ('mtl-cb', 1, 84, 49.25, 24.5000, 5, now()),
    ('mtl-bq', 1, 93, 32.75, 28.0000, 4, now())
  ON CONFLICT (zone_id, day_of_week, hour_block) DO UPDATE SET
    prior_mean = EXCLUDED.prior_mean,
    prior_variance = EXCLUDED.prior_variance,
    observation_count = EXCLUDED.observation_count,
    last_updated = EXCLUDED.last_updated;

  UPDATE public.demand_patterns
  SET actual_earnings_per_hour = 52.60
  WHERE zone_id = 'mtl-cb'
    AND context_vector = '[0.5,0.866025,0.781831,0.62349,0.876,0.425,0.3,0.2,1,0,0,0,0.25,1,1,0.88]'::vector;

  INSERT INTO public.demand_patterns (
    zone_id,
    context_vector,
    actual_earnings_per_hour
  )
  SELECT
    'mtl-cb',
    '[0.5,0.866025,0.781831,0.62349,0.876,0.425,0.3,0.2,1,0,0,0,0.25,1,1,0.88]',
    52.60
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.demand_patterns dp
    WHERE dp.zone_id = 'mtl-cb'
      AND dp.context_vector = '[0.5,0.866025,0.781831,0.62349,0.876,0.425,0.3,0.2,1,0,0,0,0.25,1,1,0.88]'::vector
  );

  UPDATE public.demand_patterns
  SET actual_earnings_per_hour = 48.10
  WHERE zone_id = 'mtl-cb'
    AND context_vector = '[0.258819,0.965926,0.781831,0.62349,0.812,0.39,0.28,0.16,0,1,0,0,0.25,1,1,0.84]'::vector;

  INSERT INTO public.demand_patterns (
    zone_id,
    context_vector,
    actual_earnings_per_hour
  )
  SELECT
    'mtl-cb',
    '[0.258819,0.965926,0.781831,0.62349,0.812,0.39,0.28,0.16,0,1,0,0,0.25,1,1,0.84]',
    48.10
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.demand_patterns dp
    WHERE dp.zone_id = 'mtl-cb'
      AND dp.context_vector = '[0.258819,0.965926,0.781831,0.62349,0.812,0.39,0.28,0.16,0,1,0,0,0.25,1,1,0.84]'::vector
  );

  UPDATE public.demand_patterns
  SET actual_earnings_per_hour = 31.90
  WHERE zone_id = 'mtl-bq'
    AND context_vector = '[-0.258819,-0.965926,0.781831,0.62349,0.532,0.24,0.25,0.08,1,0,0,0,0.25,1,0,0.53]'::vector;

  INSERT INTO public.demand_patterns (
    zone_id,
    context_vector,
    actual_earnings_per_hour
  )
  SELECT
    'mtl-bq',
    '[-0.258819,-0.965926,0.781831,0.62349,0.532,0.24,0.25,0.08,1,0,0,0,0.25,1,0,0.53]',
    31.90
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.demand_patterns dp
    WHERE dp.zone_id = 'mtl-bq'
      AND dp.context_vector = '[-0.258819,-0.965926,0.781831,0.62349,0.532,0.24,0.25,0.08,1,0,0,0,0.25,1,0,0.53]'::vector
  );
END $$;

-- ── Vérification post-seed (optionnel) ─────────────────────────────────
-- Décommente ces requêtes si tu veux valider l'injection visuellement.
-- SELECT COUNT(*) AS cities_count FROM public.cities;
-- SELECT COUNT(*) AS zones_count FROM public.zones;
-- SELECT COUNT(*) AS reports_count FROM public.daily_reports;
-- SELECT COUNT(*) AS events_count FROM public.events;
-- SELECT COUNT(*) AS scores_observability_count
-- FROM public.scores
-- WHERE calculated_at >= '2026-03-22 19:00:00+00';
-- SELECT COUNT(*) AS predictions_seed_count
-- FROM public.predictions
-- WHERE factors_snapshot->>'source' IN ('seed', 'seed_observability');
-- SELECT triggered_by, COUNT(*)
-- FROM public.weight_history
-- WHERE triggered_by IN ('seed_demo', 'seed_observability')
-- GROUP BY triggered_by
-- ORDER BY triggered_by;
