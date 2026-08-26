-- ============================================================
-- Close RLS gaps: several earlier migrations added a user-scoped
-- or "service" policy but never dropped the original USING(true)/
-- auth.uid()-is-not-null policy. Postgres OR's all permissive
-- policies for the same command together, so the old wide-open
-- policy stayed fully active alongside the new one.
--
-- Verified live on prod before this migration:
--   trips, notifications          -> old public policies never dropped
--   sessions                      -> old "any authenticated user" policy never dropped
--   session_zones                 -> never scoped to a user at all
--   scores, platform_signals,
--   weight_history, trip_predictions,
--   zone_context_vectors          -> "service" policies actually USING(true),
--                                    writable by the anon key shipped in the PWA.
--                                    Edge Functions use the service_role key,
--                                    which bypasses RLS entirely — these
--                                    anon/authenticated write policies are
--                                    unnecessary as well as dangerous.
--   ema_patterns, zone_beliefs,
--   predictions, demand_patterns  -> single FOR ALL policy let any signed-in
--                                    user overwrite the shared ML model state
-- ============================================================

-- ── trips ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "trips_public_read" ON public.trips;
DROP POLICY IF EXISTS "trips_insert" ON public.trips;
DROP POLICY IF EXISTS "trips_update" ON public.trips;
DROP POLICY IF EXISTS "trips_delete" ON public.trips;

-- ── notifications ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications_public_read" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;

-- ── sessions ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated read sessions" ON public.sessions;

-- ── session_zones: never had user scoping, only a session_id FK ────────────
DROP POLICY IF EXISTS "authenticated read session_zones" ON public.session_zones;

CREATE POLICY "session_zones_user_isolation" ON public.session_zones
  FOR ALL
  USING (session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid()))
  WITH CHECK (session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid()));

-- ── shared ML/scoring state: read stays open, writes are service-role only ─
DROP POLICY IF EXISTS "authenticated read ema_patterns" ON public.ema_patterns;
CREATE POLICY "ema_patterns_read" ON public.ema_patterns FOR SELECT USING (true);

DROP POLICY IF EXISTS "authenticated read zone_beliefs" ON public.zone_beliefs;
CREATE POLICY "zone_beliefs_read" ON public.zone_beliefs FOR SELECT USING (true);

DROP POLICY IF EXISTS "authenticated read predictions" ON public.predictions;
CREATE POLICY "predictions_read" ON public.predictions FOR SELECT USING (true);

DROP POLICY IF EXISTS "authenticated read demand_patterns" ON public.demand_patterns;
CREATE POLICY "demand_patterns_read" ON public.demand_patterns FOR SELECT USING (true);

DROP POLICY IF EXISTS "authenticated read weight_history" ON public.weight_history;
DROP POLICY IF EXISTS "weight_history_public_read" ON public.weight_history;
DROP POLICY IF EXISTS "weight_history_insert" ON public.weight_history;
CREATE POLICY "weight_history_read" ON public.weight_history FOR SELECT USING (true);

-- ── scores: read is genuinely public (heatmap), writes go via service_role ─
DROP POLICY IF EXISTS "scores_service_write" ON public.scores;
DROP POLICY IF EXISTS "scores_service_update" ON public.scores;
DROP POLICY IF EXISTS "scores_service_delete" ON public.scores;

-- ── platform_signals ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "platform_signals_insert" ON public.platform_signals;
DROP POLICY IF EXISTS "platform_signals_update" ON public.platform_signals;

-- ── trip_predictions ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "trip_predictions_insert" ON public.trip_predictions;
DROP POLICY IF EXISTS "trip_predictions_update" ON public.trip_predictions;

-- ── zone_context_vectors ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "context vectors service insert" ON public.zone_context_vectors;
DROP POLICY IF EXISTS "context vectors service update" ON public.zone_context_vectors;

-- ── time_slots: user-planned shift slots, never got user scoping ───────────
DROP POLICY IF EXISTS "time_slots_public_read" ON public.time_slots;
DROP POLICY IF EXISTS "time_slots_insert" ON public.time_slots;
DROP POLICY IF EXISTS "time_slots_update" ON public.time_slots;
DROP POLICY IF EXISTS "time_slots_delete" ON public.time_slots;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'time_slots' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.time_slots ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_time_slots_user_id ON public.time_slots(user_id);

CREATE POLICY "time_slots_user_isolation" ON public.time_slots
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
