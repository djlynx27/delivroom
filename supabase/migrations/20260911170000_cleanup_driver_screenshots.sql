-- ============================================================
-- Cron cleanup: driver-screenshots Storage bucket
-- ============================================================
-- 726 MB / 1381 objects accumulated since 2026-05-22 with zero cleanup —
-- every screenshot_uploads row already carries the structured Gemini
-- output in analysis_result, so the raw image is pure redundant storage
-- once analyzed. Deletes storage.objects (not the screenshot_uploads row
-- itself, which stays as the historical/audit record) 48h after
-- analyzed_at, mirroring cleanup_old_platform_signals'/
-- cleanup_expired_event_zones' pg_cron pattern.

CREATE OR REPLACE FUNCTION public.cleanup_old_screenshot_uploads()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM storage.objects
  WHERE bucket_id = 'driver-screenshots'
    AND name IN (
      SELECT file_path FROM public.screenshot_uploads
      WHERE analyzed_at IS NOT NULL
        AND analyzed_at < now() - INTERVAL '48 hours'
    );
$$;

DO $screenshot_cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-driver-screenshots') THEN
      PERFORM cron.unschedule('cleanup-driver-screenshots');
    END IF;

    PERFORM cron.schedule(
      'cleanup-driver-screenshots',
      '0 4 * * *',  -- Daily at 04:00, after cleanup-context-vectors (03:00)
      $$SELECT public.cleanup_old_screenshot_uploads()$$
    );
  END IF;
END $screenshot_cleanup$;

-- Lock down like every other cleanup SECURITY DEFINER function in this
-- project (see security_definer_audit.sql) — only pg_cron's service_role
-- context should ever invoke this, not a public RPC call.
REVOKE EXECUTE ON FUNCTION public.cleanup_old_screenshot_uploads() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_screenshot_uploads() TO service_role;
