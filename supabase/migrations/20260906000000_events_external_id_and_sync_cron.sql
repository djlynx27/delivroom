-- ============================================================
-- Migration: events_external_id_and_sync_cron
-- Delivroom (hibzhsjgipybfihhzpxr)
--
-- Adds external_id to public.events so the new event-sync Edge Function
-- (Ticketmaster Discovery API -> events table) can upsert idempotently
-- without colliding with the hand-seeded 2026 calendar (20260319000001_
-- events_2026.sql), which has no external_id and is never touched by
-- the sync job's on-conflict target.
--
-- Schedules event-sync via pg_cron every 6h -- event schedules don't
-- change minute to minute, unlike surge-detector's 5-min cadence.
-- ============================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS events_external_id_idx
  ON public.events (external_id)
  WHERE external_id IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('event-sync');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'event-sync',
    '0 */6 * * *',
    $cron$
      SELECT net.http_post(
        url     := 'https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/event-sync',
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

  RAISE NOTICE 'pg_cron job "event-sync" scheduled every 6h';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available — event-sync stays unscheduled. Error: %', SQLERRM;
END;
$$;
