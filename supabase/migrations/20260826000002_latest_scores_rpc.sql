-- useZoneScores fetched the entire scores history for a city (up to ~144
-- cron runs/day x zones-in-city rows) just to keep the newest row per zone
-- in JS. idx_scores_zone_time (zone_id, calculated_at DESC) already exists
-- for exactly this access pattern — do the dedup server-side instead.

CREATE OR REPLACE FUNCTION public.get_latest_scores(p_city_id TEXT)
RETURNS SETOF public.scores
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT DISTINCT ON (s.zone_id) s.*
  FROM public.scores s
  JOIN public.zones z ON z.id = s.zone_id
  WHERE z.city_id = p_city_id
  ORDER BY s.zone_id, s.calculated_at DESC;
$$;
