-- One-off cleanup: retire the "Boulevard Chomedey & Boulevard Notre-Dame"
-- zone -- promoted from the driver's own home address (3x dropoff), not
-- real external demand. Turned out to be a MANUAL promotion via
-- AdminZoneDiscoveriesScreen (id 'lvl-chomedey-notre', not the trigger's
-- 'disc-<md5>' scheme fixed in
-- 20260919120000_gate_zone_discovery_auto_promote_on_performance.sql) --
-- matched by name here so this cleanup isn't tied to either promotion path's
-- id scheme.
--
-- Safe to re-run: every statement is conditional on a matching zone
-- actually existing.

DO $$
DECLARE
  v_zone_id text;
BEGIN
  SELECT id INTO v_zone_id
  FROM public.zones
  WHERE name ILIKE '%Chomedey%Notre-Dame%';

  IF v_zone_id IS NULL THEN
    RAISE NOTICE 'No auto-promoted Chomedey/Notre-Dame zone found -- nothing to clean up.';
    RETURN;
  END IF;

  -- Un-link any trips already attached before the zone disappears, so they
  -- fall back to unmatched rather than dangling on a deleted zone_id.
  UPDATE public.trips SET zone_id = NULL WHERE zone_id = v_zone_id;

  -- Revert the discovery to 'pending' (re-eligible for the now-gated
  -- trigger, or manual review) instead of leaving it 'promoted' with a
  -- dangling promoted_zone_id.
  UPDATE public.zone_discoveries
  SET status = 'pending',
      promoted_zone_id = NULL,
      notes = coalesce(notes || ' / ', '') || 'Auto-promotion revertie 2026-09-19 (pas de signal de demande reel, juste l''adresse domicile du chauffeur)'
  WHERE promoted_zone_id = v_zone_id;

  DELETE FROM public.zones WHERE id = v_zone_id;

  RAISE NOTICE 'Cleaned up zone %', v_zone_id;
END $$;
