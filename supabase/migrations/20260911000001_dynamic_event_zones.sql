-- supabase/migrations/20260911000001_dynamic_event_zones.sql
--
-- Dynamic Event Zones: an event that falls outside every fixed zone's own
-- boost radius currently produces zero demand signal anywhere (see
-- docs/superpowers/specs/2026-09-10-dynamic-event-zones-design.md). This
-- adds the data model and the trigger that creates an ephemeral zone for
-- a qualifying event.
--
-- No Haversine function exists anywhere in this database today (checked
-- via pg_proc — only unrelated geometry-type and pgvector distance
-- functions exist), so the trigger needs its own.

CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 6371 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) *
    sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$;

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_zones_event_id ON public.zones (event_id) WHERE event_id IS NOT NULL;
