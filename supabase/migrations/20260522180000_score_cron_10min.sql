-- Tighten the zone-score refresh cadence from every 30 min to every 10 min.
--
-- Why: the driver-facing "best zone right now" felt stale because the
-- underlying scores only moved every half hour. 10 min is the sweet spot —
-- captures rush-hour swings + event boosts without burning Supabase's
-- pg_cron quota.
--
-- The Edge Function score-calculator still runs lazily on top to layer in
-- weather + AI; useZoneScores's Realtime subscription means the UI updates
-- the same second the new row lands.

DO $$
BEGIN
  -- Drop the existing 30-min job before re-scheduling
  BEGIN
    PERFORM cron.unschedule('recalculate-zone-scores');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'recalculate-zone-scores',
    '*/10 * * * *',
    $cron$SELECT public.recalculate_zone_scores()$cron$
  );

  RAISE NOTICE 'pg_cron job "recalculate-zone-scores" rescheduled every 10 min';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available — falling back to Edge Function only. Error: %', SQLERRM;
END;
$$;
