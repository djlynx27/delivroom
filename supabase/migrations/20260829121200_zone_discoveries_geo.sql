-- ingest-lyft-screenshots now flags "emerging hotspots" -- GPS positions
-- where demand reads high but the driver is far from every known zone --
-- into zone_discoveries (context='other'), reusing the existing
-- upsert/occurrence_count/promotion workflow instead of a new table. Unlike
-- the pickup/dropoff discoveries already logged there, these come with a
-- known GPS position at detection time, so keep it for a later promote
-- (skips a manual geocoding step in the "Zones découvertes" admin screen).

ALTER TABLE public.zone_discoveries
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;
