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

-- Trigger: create (or refresh) an ephemeral "virtual" zone whenever a
-- qualifying event (big crowd, far from every real zone's boost radius) is
-- inserted or has its location/impact fields updated.

CREATE OR REPLACE FUNCTION public.create_event_zone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_zone_id    text;
  v_nearest_km double precision;
  v_score      numeric;
BEGIN
  -- Meaningful-crowd gate — skip minor/local events.
  IF NOT (NEW.capacity >= 500 OR NEW.demand_impact >= 3) THEN
    RETURN NEW;
  END IF;

  -- Distance to the nearest REAL zone (never another event's virtual zone).
  SELECT MIN(public.haversine_km(NEW.latitude, NEW.longitude, z.latitude, z.longitude))
  INTO v_nearest_km
  FROM public.zones z
  WHERE z.event_id IS NULL;

  -- Already inside an existing zone's own boost radius — nothing to do.
  IF v_nearest_km IS NOT NULL AND v_nearest_km <= NEW.boost_radius_km THEN
    RETURN NEW;
  END IF;

  v_zone_id := 'evt-' || substr(md5(NEW.id::text), 1, 10);
  v_score := LEAST(100, 40 + (NEW.boost_multiplier - 1) * 25 + LEAST(NEW.demand_impact, 5) * 6);

  INSERT INTO public.zones (id, city_id, name, type, latitude, longitude, base_score, current_score, event_id)
  VALUES (
    v_zone_id, NEW.city_id, NEW.name, 'événements',
    NEW.latitude, NEW.longitude, v_score, v_score, NEW.id
  )
  ON CONFLICT (id) DO UPDATE SET
    name          = EXCLUDED.name,
    latitude      = EXCLUDED.latitude,
    longitude     = EXCLUDED.longitude,
    base_score    = EXCLUDED.base_score,
    current_score = EXCLUDED.current_score,
    updated_at    = now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS create_event_zone_trg ON public.events;

CREATE TRIGGER create_event_zone_trg
AFTER INSERT OR UPDATE OF latitude, longitude, capacity, demand_impact, boost_radius_km
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.create_event_zone();

REVOKE EXECUTE ON FUNCTION public.create_event_zone() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_zone() TO service_role;
