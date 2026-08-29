-- ============================================================
-- Migration: schedule_surge_detector
-- Delivroom (hibzhsjgipybfihhzpxr)
--
-- surge-detector (the Edge Function that detects peak-surge zones and
-- fires the "zone à fort potentiel" Web Push alert via push-notifier) has
-- never actually been scheduled — the pg_cron block was written as a
-- commented-out "run this yourself in the SQL editor" instruction in
-- 20260320000002_platform_signals.sql and nobody ever ran it. Result: the
-- whole push-alert pipeline (SW push handler, push-notifier, surge-detector's
-- own logic) was built but dormant — nothing ever invoked it, on a client or
-- off. This migration finishes that setup so it actually runs, every 5 min,
-- independent of any driver having the PWA open.
--
-- The service_role key itself is NOT embedded here — it must already exist
-- in Supabase Vault under the name 'SUPABASE_SERVICE_ROLE_KEY' (set via
-- `select vault.create_secret(<key>, 'SUPABASE_SERVICE_ROLE_KEY')` once,
-- outside of version control). If the secret is missing, the cron job's
-- net.http_post call will fail loudly in cron.job_run_details rather than
-- silently no-op.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('surge-detector');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 61 zones, each needing its own get_surge_baseline() round-trip inside
  -- surge-detector's loop, routinely runs past pg_net's 5s default
  -- net.http_post timeout — the Edge Function still completes and does its
  -- work either way (fire-and-forget cron, nothing awaits the response),
  -- but a short timeout pollutes net._http_response with false-negative
  -- `timed_out` rows. 20s covers the observed ~6-8s real runtime with room
  -- to spare.
  PERFORM cron.schedule(
    'surge-detector',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url     := 'https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/surge-detector',
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
    $cron$
  );

  RAISE NOTICE 'pg_cron job "surge-detector" scheduled every 5 min';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available — surge-detector stays unscheduled. Error: %', SQLERRM;
END;
$$;
