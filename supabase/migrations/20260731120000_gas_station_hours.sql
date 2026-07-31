-- Cache des horaires d'ouverture des stations-service.
--
-- La source de prix (Régie de l'énergie via essencequebec.com) ne publie aucun
-- horaire. L'onglet Essence doit pourtant ne proposer que des stations encore
-- ouvertes. On résout les horaires via Mapbox Search Box côté Edge Function et
-- on les met en cache ici : les horaires réguliers bougent très peu, et ça
-- évite de rappeler l'API à chaque ouverture de l'app.
--
-- `periods` suit la convention Google Places / Mapbox :
--   [{ "open": {"day": 0-6, "time": "HHMM"}, "close": {...} | null }]
--   NULL  = résolution tentée mais aucun horaire publié pour cette station
--           (on l'affiche alors avec un badge « horaire inconnu »).

CREATE TABLE IF NOT EXISTS public.gas_station_hours (
  station_key       text PRIMARY KEY,
  lat               double precision NOT NULL,
  lng               double precision NOT NULL,
  address           text,
  brand             text,
  city              text,
  periods           jsonb,
  matched_name      text,
  match_distance_m  numeric,
  source            text NOT NULL DEFAULT 'mapbox',
  resolved_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gas_station_hours IS
  'Horaires d''ouverture des stations-service, résolus via Mapbox et mis en cache. periods NULL = horaire inconnu.';
COMMENT ON COLUMN public.gas_station_hours.station_key IS
  'lat/lng arrondis à 5 décimales ("45.55994,-73.72726"), identique à stationKey() côté client.';
COMMENT ON COLUMN public.gas_station_hours.match_distance_m IS
  'Distance entre la station EQC et le POI Mapbox retenu — sert à auditer les mauvais appariements.';

CREATE INDEX IF NOT EXISTS gas_station_hours_resolved_at_idx
  ON public.gas_station_hours (resolved_at);

ALTER TABLE public.gas_station_hours ENABLE ROW LEVEL SECURITY;

-- Lecture publique : données non personnelles, même traitement que `zones`.
-- Les écritures passent exclusivement par l'Edge Function `gas-hours`
-- (service_role, qui contourne RLS) — aucune policy INSERT/UPDATE ici.
DROP POLICY IF EXISTS gas_station_hours_select_all ON public.gas_station_hours;
CREATE POLICY gas_station_hours_select_all ON public.gas_station_hours
  FOR SELECT
  USING (true);
