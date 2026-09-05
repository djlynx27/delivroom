-- Auto-promotion engine for zone_discoveries.
--
-- A discovered address (pickup/dropoff Gemini couldn't match to the zones
-- catalog) is currently only promotable by hand from the admin "Zones
-- découvertes" screen (promote-discovery Edge Function). That's fine for a
-- one-off, but a recurring unmapped address is a real signal — the driver
-- keeps getting offers there and the scoring engine never learns it exists.
--
-- Rule: once a pending discovery's `count` reaches 3+, auto-create a zone
-- for it instead of waiting for a human to notice. We don't have lat/lng for
-- a discovery (only the address text + a guessed city), so we place the new
-- zone at that city's best-known zone location with a small deterministic
-- jitter (seeded from the address) so repeated auto-promotions in the same
-- city don't all stack on the exact same point — a coarse "neighborhood
-- cluster" approximation, same idea analyze-screenshot already uses to place
-- unmatched rides on the city's representative zone.
--
-- ponytail: jitter/placement is a heuristic, not real geocoding — upgrade to
-- a geocoding API call if false positions become a problem.

CREATE OR REPLACE FUNCTION public.zone_discoveries_auto_promote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_city_id   text;
  v_base_lat  double precision;
  v_base_lng  double precision;
  v_seed      double precision;
  v_zone_id   text;
BEGIN
  v_city_id := NEW.city_hint;
  IF v_city_id IS NULL THEN
    RETURN NEW; -- no city guess, nothing to anchor the new zone to
  END IF;

  SELECT latitude, longitude INTO v_base_lat, v_base_lng
  FROM public.zones
  WHERE city_id = v_city_id
  ORDER BY base_score DESC NULLS LAST
  LIMIT 1;

  IF v_base_lat IS NULL THEN
    RETURN NEW; -- unknown city, can't place it
  END IF;

  -- Deterministic pseudo-random offset in [-0.004, 0.004] degrees (~±400m)
  -- from the address text, so re-running this trigger for the same address
  -- always lands the same place.
  v_seed := (hashtext(lower(NEW.address)) % 1000) / 1000.0; -- [-1, 1)
  v_zone_id := 'disc-' || substr(md5(lower(NEW.address) || NEW.context), 1, 10);

  INSERT INTO public.zones (id, city_id, name, type, latitude, longitude, base_score, current_score, address)
  VALUES (
    v_zone_id,
    v_city_id,
    NEW.address,
    'résidentiel',
    v_base_lat + v_seed * 0.004,
    v_base_lng + v_seed * 0.004,
    40,
    40,
    NEW.address
  )
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.zone_discoveries
  SET status = 'promoted',
      promoted_zone_id = v_zone_id,
      notes = coalesce(notes || ' / ', '') || 'Auto-promue après ' || NEW.count || ' occurrences'
  WHERE id = NEW.id;

  INSERT INTO public.notifications (type, title, message, metadata)
  VALUES (
    'other',
    'Zone auto-promue',
    NEW.address || ' promue après ' || NEW.count || ' occurrences',
    jsonb_build_object('zone_id', v_zone_id, 'discovery_id', NEW.id, 'count', NEW.count, 'context', NEW.context)
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zone_discoveries_auto_promote_trg ON public.zone_discoveries;

CREATE TRIGGER zone_discoveries_auto_promote_trg
AFTER INSERT OR UPDATE OF count, status ON public.zone_discoveries
FOR EACH ROW
WHEN (NEW.status = 'pending' AND NEW.count >= 3)
EXECUTE FUNCTION public.zone_discoveries_auto_promote();
