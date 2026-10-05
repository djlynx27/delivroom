-- Persists the live YUL arrivals signal that score-calculator fetches from
-- Aviationstack (AVIATIONSTACK_API_KEY secret, set 2026-09-20) each run, so
-- the client can display it without a second live API call and so the
-- signal has a visible history. Single-row table (id fixed to 'yul') --
-- mirrors the "board" snapshot pattern already used elsewhere in this
-- project (e.g. gas_board), not a time series.

CREATE TABLE IF NOT EXISTS public.yul_flight_stats (
  id                     text PRIMARY KEY DEFAULT 'yul',
  incoming_flights_count integer,
  fetched_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.yul_flight_stats ENABLE ROW LEVEL SECURITY;

-- Public read (same as zone_discoveries_public_read / zones) -- this is a
-- coarse demand signal, not personal data.
CREATE POLICY yul_flight_stats_select_all ON public.yul_flight_stats
  FOR SELECT
  USING (true);

-- Writes happen exclusively from score-calculator (service_role) --
-- deliberately no INSERT/UPDATE policy for anon/authenticated.
