-- supabase/migrations/20260911000003_event_zone_polish.sql
--
-- Resolves two deferred minor findings from the Dynamic Event Zones
-- feature review (Tasks 2 and 3). Migrations are not edited after
-- being applied to prod, so both fixes land as new statements here
-- instead of modifying 20260911000001/20260911000002 in place.

-- Task 2 finding: create_event_zone_trg's UPDATE OF column list omitted
-- boost_multiplier even though it feeds the zone's base_score formula --
-- updating only boost_multiplier on an existing event didn't re-fire the
-- trigger, so the zone's base_score went stale. Function body is
-- unchanged; only the trigger's watched-column list grows.
DROP TRIGGER IF EXISTS create_event_zone_trg ON public.events;

CREATE TRIGGER create_event_zone_trg
AFTER INSERT OR UPDATE OF latitude, longitude, capacity, demand_impact, boost_radius_km, boost_multiplier
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.create_event_zone();

-- Task 3 finding: the pg_cron scheduling block's EXCEPTION handler
-- reported a fixed "pg_cron not available" notice for ANY failure inside
-- the block, which would mask an unrelated cron.schedule error (e.g. a
-- permissions issue) behind a misleading message. Re-running this
-- idempotent unschedule/reschedule block is harmless (same job, same
-- schedule) -- only the exception message changes.
DO $event_zones_cleanup_polish$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-event-zones') THEN
      PERFORM cron.unschedule('cleanup-event-zones');
    END IF;

    PERFORM cron.schedule(
      'cleanup-event-zones',
      '0 * * * *', -- hourly
      $$SELECT public.cleanup_expired_event_zones()$$
    );

    RAISE NOTICE 'pg_cron job "cleanup-event-zones" scheduled hourly.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron setup skipped or failed: %', SQLERRM;
END;
$event_zones_cleanup_polish$;
