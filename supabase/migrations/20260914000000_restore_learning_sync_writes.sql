-- 20260826000001_close_rls_gaps.sql correctly closed the wide-open "FOR ALL"
-- policy on ema_patterns/zone_beliefs/weight_history (any signed-in user
-- could overwrite OR DELETE the shared ML model state), but left these
-- tables completely unwritable from the client — no Edge Function ever
-- replaced the write path. The only code that ever populates these tables
-- is client-side (learningSync.ts's syncLearningAggregates, wired to the
-- "Sync Supabase" button in LearningInsightsPanel.tsx), so since that
-- migration the button has failed on every click with a swallowed RLS
-- error ("Sync Supabase impossible.").
--
-- Restore INSERT/UPDATE (never DELETE — that part of the closed gap stays
-- closed) scoped to authenticated users, matching the auth.uid() IS NOT
-- NULL + (select ...) initplan pattern already used elsewhere in this
-- schema (see 20260913050000).

DROP POLICY IF EXISTS "ema_patterns_insert" ON public.ema_patterns;
CREATE POLICY "ema_patterns_insert" ON public.ema_patterns
  FOR INSERT
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "ema_patterns_update" ON public.ema_patterns;
CREATE POLICY "ema_patterns_update" ON public.ema_patterns
  FOR UPDATE
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "zone_beliefs_insert" ON public.zone_beliefs;
CREATE POLICY "zone_beliefs_insert" ON public.zone_beliefs
  FOR INSERT
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "zone_beliefs_update" ON public.zone_beliefs;
CREATE POLICY "zone_beliefs_update" ON public.zone_beliefs
  FOR UPDATE
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

-- weight_history is insert-only from the client (syncLearningAggregates
-- never updates an existing row), so no UPDATE policy is added here.
DROP POLICY IF EXISTS "weight_history_insert" ON public.weight_history;
CREATE POLICY "weight_history_insert" ON public.weight_history
  FOR INSERT
  WITH CHECK ((select auth.uid()) IS NOT NULL);
