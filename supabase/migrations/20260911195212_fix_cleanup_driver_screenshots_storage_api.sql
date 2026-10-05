-- ============================================================
-- Fix: cleanup-driver-screenshots must go through the Storage API
-- ============================================================
-- 20260911170000's plpgsql DELETE FROM storage.objects fails at runtime:
-- storage.protect_delete() raises 42501 ("Use the Storage API instead") on
-- this project. Replaces it with an Edge Function (same as
-- event-sync/surge-detector/gtfs-alerts-sync) that calls
-- supabase.storage.from('driver-screenshots').remove(paths) -- the only
-- path that actually deletes both the storage.objects row and the S3-backed
-- bytes. The screenshot_uploads row itself is untouched either way.
--
-- Also adds storage_purged_at: file_path is NOT NULL (can't null it out to
-- mark "already purged"), and without some marker a re-run of the same
-- WHERE analyzed_at < now()-48h clause keeps re-selecting the same oldest
-- batch forever (calling remove() on objects already gone, never reaching
-- newer purgeable rows) -- caught this manually clearing today's 1253-row
-- backlog: batch 2 reported candidates:500, deleted:0.

ALTER TABLE public.screenshot_uploads
  ADD COLUMN IF NOT EXISTS storage_purged_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_screenshot_uploads_purge_candidates
  ON public.screenshot_uploads (analyzed_at)
  WHERE storage_purged_at IS NULL;

DO $screenshot_cleanup_fix$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-driver-screenshots') THEN
      PERFORM cron.unschedule('cleanup-driver-screenshots');
    END IF;

    PERFORM cron.schedule(
      'cleanup-driver-screenshots',
      '0 4 * * *',  -- Daily at 04:00, after cleanup-context-vectors (03:00)
      $$
        SELECT net.http_post(
          url     := 'https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/cleanup-driver-screenshots',
          body    := '{}'::jsonb,
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (
              SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
            ),
            'Content-Type', 'application/json'
          ),
          timeout_milliseconds := 20000
        )
      $$
    );
  END IF;
END $screenshot_cleanup_fix$;

-- The plpgsql function never worked (blocked by protect_delete before it
-- could delete anything) -- drop it rather than leave dead code behind.
DROP FUNCTION IF EXISTS public.cleanup_old_screenshot_uploads();
