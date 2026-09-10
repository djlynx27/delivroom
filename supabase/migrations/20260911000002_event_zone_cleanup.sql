-- supabase/migrations/20260911000002_event_zone_cleanup.sql
--
-- Deletes ephemeral event zones (public.zones.event_id IS NOT NULL) once
-- their triggering event is more than 2 hours past end_at. Same
-- REVOKE/GRANT lockdown pattern as cleanup_old_platform_signals (see
-- 20260320000002_platform_signals.sql) and the same pg_cron
-- availability guard as its scheduling block.

CREATE OR REPLACE FUNCTION public.cleanup_expired_event_zones()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.zones
  WHERE event_id IS NOT NULL
    AND event_id IN (
      SELECT id FROM public.events WHERE end_at < now() - interval '2 hours'
    );
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_event_zones() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_event_zones() TO service_role;

DO $event_zones_cleanup$
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
    RAISE NOTICE 'pg_cron not available — cleanup_expired_event_zones() must be triggered manually. Error: %', SQLERRM;
END;
$event_zones_cleanup$;
