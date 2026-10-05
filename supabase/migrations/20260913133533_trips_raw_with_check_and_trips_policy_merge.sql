-- 1. trips_raw."driver own trips" relied on USING doubling as WITH CHECK
--    (Postgres default when WITH CHECK is omitted on a FOR ALL policy).
--    Make it explicit, and wrap auth.uid() in a subselect so it's evaluated
--    once per statement instead of once per row (same auth_rls_initplan
--    fix already applied to other tables in 20260913030000, missed here).
DROP POLICY IF EXISTS "driver own trips" ON public.trips_raw;
CREATE POLICY "driver own trips" ON public.trips_raw
  FOR ALL
  USING ((select auth.uid()) = driver_id)
  WITH CHECK ((select auth.uid()) = driver_id);

-- 2. trips: trips_user_isolation (FOR ALL) and trips_synthetic_read
--    (FOR SELECT) are both permissive and both apply on every SELECT,
--    so Postgres evaluates two policies per row instead of one
--    (multiple_permissive_policies advisor). Split ownership into a
--    write-only policy and fold the synthetic-read condition into a
--    single merged SELECT policy.
DROP POLICY IF EXISTS trips_user_isolation ON public.trips;
DROP POLICY IF EXISTS trips_synthetic_read ON public.trips;

CREATE POLICY trips_owner_write
  ON public.trips
  AS PERMISSIVE
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY trips_owner_update
  ON public.trips
  AS PERMISSIVE
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY trips_owner_delete
  ON public.trips
  AS PERMISSIVE
  FOR DELETE
  USING ((select auth.uid()) = user_id);

CREATE POLICY trips_select
  ON public.trips
  AS PERMISSIVE
  FOR SELECT
  USING (source = 'synthetic' OR (select auth.uid()) = user_id);
