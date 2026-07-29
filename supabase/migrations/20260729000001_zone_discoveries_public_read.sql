-- Fix: "Zones découvertes" admin screen was always empty.
--
-- The analyze-screenshot Edge Function inserts discoveries via service_role
-- WITHOUT a user_id (rows land with user_id = NULL). The old SELECT policy
-- required `user_id = auth.uid()`, so the admin screen (authenticated client,
-- subject to RLS) could never see any row — even the ones that were correctly
-- logged. Delivroom is single-driver and `trips` is already public-read, so
-- make discoveries readable the same way.

DROP POLICY IF EXISTS zone_discoveries_select_own ON public.zone_discoveries;

CREATE POLICY zone_discoveries_select_all ON public.zone_discoveries
  FOR SELECT
  USING (true);
