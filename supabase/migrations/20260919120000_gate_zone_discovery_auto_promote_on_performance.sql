-- Fix: zone_discoveries_auto_promote_trg promoted any address seen 3+ times
-- with NO earnings check, unlike the manual admin flow
-- (zonePromotion.ts::evaluatePromotionCandidate) which requires the address
-- to also out-earn the major zones' own $/km and $/h benchmark
-- (get_discovery_performance / get_major_zone_benchmark, migration
-- 20260910015912_zone_discovery_performance.sql).
--
-- Real-world case (2026-09-19): a driver's own home address, logged 3x as a
-- Lyft dropoff, auto-promoted into a 'résidentiel' zone (flat score 40) that
-- then out-ranked a real hub (Station Montmorency) in
-- rankByProximityPenalizedScore purely because it was 0 km away at home --
-- repetition alone is not a demand signal.
--
-- Fix: the trigger now runs the same performance gate as the manual flow
-- before promoting. A discovery that clears the occurrence threshold but not
-- the earnings bar stays 'pending' (still visible in the admin "Zones
-- découvertes" screen for manual review) instead of silently becoming a real
-- zone; it re-evaluates on every future count bump, so a genuinely recurring
-- and profitable spot still auto-promotes once real trips back it.

CREATE OR REPLACE FUNCTION public.zone_discoveries_auto_promote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_city_id       text;
  v_base_lat      double precision;
  v_base_lng      double precision;
  v_seed          double precision;
  v_zone_id       text;
  v_sample_size   int;
  v_disc_per_km   numeric;
  v_disc_per_h    numeric;
  v_bench_per_km  numeric;
  v_bench_per_h   numeric;
BEGIN
  v_city_id := NEW.city_hint;
  IF v_city_id IS NULL THEN
    RETURN NEW; -- no city guess, nothing to anchor the new zone to
  END IF;

  -- Same earnings gate as the manual admin flow
  -- (zonePromotion.ts::evaluatePromotionCandidate) -- occurrence count alone
  -- (already gated by this trigger's WHEN clause, count >= 3) is not a
  -- demand signal; the address must also out-earn the major zones.
  SELECT sample_size, avg_per_km, avg_per_h
  INTO v_sample_size, v_disc_per_km, v_disc_per_h
  FROM public.get_discovery_performance(NEW.address);

  SELECT avg_per_km, avg_per_h
  INTO v_bench_per_km, v_bench_per_h
  FROM public.get_major_zone_benchmark();

  IF v_sample_size IS NULL OR v_sample_size < 3
     OR v_disc_per_km IS NULL OR v_disc_per_h IS NULL
     OR v_bench_per_km IS NULL OR v_bench_per_h IS NULL
     OR v_disc_per_km < v_bench_per_km
     OR v_disc_per_h < v_bench_per_h
  THEN
    RETURN NEW; -- stays 'pending' for manual review, re-checked on next count bump
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
      notes = coalesce(notes || ' / ', '') || 'Auto-promue après ' || NEW.count ||
              ' occurrences ($/km ' || round(v_disc_per_km, 2) || ' vs benchmark ' || round(v_bench_per_km, 2) ||
              ', $/h ' || round(v_disc_per_h, 2) || ' vs benchmark ' || round(v_bench_per_h, 2) || ')'
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
