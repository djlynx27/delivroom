-- 20260826000001_close_rls_gaps.sql dropped trip_predictions_insert/update (they
-- were USING(true) "service" policies) but, unlike ema_patterns/zone_beliefs/
-- weight_history (restored by 20260914000000), nothing replaced the client write
-- path. usePostTripFeedback (called from useTrips.ts after every saved trip) inserts
-- into trip_predictions from the PWA, so every insert has been rejected by RLS:
-- the table is empty on prod and weight-calibrator always answers "Not enough data".
--
-- Restore INSERT only (the hook never updates; no UPDATE/DELETE policy is added),
-- scoped to a signed-in user (incl. anonymous sessions) — same pattern/decision as
-- the other learning tables (see memory project_learning_rls_scoping_decision).
DROP POLICY IF EXISTS "trip_predictions_insert" ON public.trip_predictions;
CREATE POLICY "trip_predictions_insert" ON public.trip_predictions
  FOR INSERT
  WITH CHECK ((select auth.uid()) IS NOT NULL);

COMMENT ON POLICY "trip_predictions_insert" ON public.trip_predictions IS 'TODO(multi-tenant): any authenticated (incl. anonymous) user can insert; rows are not owner-scoped. Scope before DailyVroom has other users.';
