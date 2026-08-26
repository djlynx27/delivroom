-- ============================================================
-- Migration: fix_rls_performance_advisors
-- Delivroom (hibzhsjgipybfihhzpxr) — postgres checkup 2026-08-26
--
-- 1. auth_rls_initplan (23 policies) : wrap auth.uid() en (select auth.uid())
--    pour éviter la ré-évaluation par ligne (perf sur scores/time_slots).
-- 2. multiple_permissive_policies sur content_pipeline : drop du doublon,
--    la policy restante reçoit aussi le fix initplan.
--
-- Aucune fonction SECURITY DEFINER créée/modifiée ici -> la règle
-- SET search_path='' / SECURITY INVOKER (CLAUDE.md §4) ne s'applique pas
-- à cette migration (RLS policies only, pas de function body).
-- ============================================================

-- ------------------------------------------------------------
-- 1) content_pipeline : dedupe des policies permissives dupliquées
--    Garde "Users can manage their own content pipeline", drop le doublon.
-- ------------------------------------------------------------
drop policy if exists "Users can manage their own content" on public.content_pipeline;

drop policy if exists "Users can manage their own content pipeline" on public.content_pipeline;
create policy "Users can manage their own content pipeline"
  on public.content_pipeline
  as permissive
  for all
  using ((select auth.uid()) = user_id);

-- ------------------------------------------------------------
-- 2) auth_rls_initplan : wrap auth.uid() dans chaque policy affectée
-- ------------------------------------------------------------

-- trips
drop policy if exists trips_user_isolation on public.trips;
create policy trips_user_isolation
  on public.trips
  as permissive
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- sessions
drop policy if exists sessions_user_isolation on public.sessions;
create policy sessions_user_isolation
  on public.sessions
  as permissive
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- notifications
drop policy if exists notifications_user_isolation on public.notifications;
create policy notifications_user_isolation
  on public.notifications
  as permissive
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- user_profiles
drop policy if exists user_profiles_self_access on public.user_profiles;
create policy user_profiles_self_access
  on public.user_profiles
  as permissive
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- time_slots
drop policy if exists time_slots_user_isolation on public.time_slots;
create policy time_slots_user_isolation
  on public.time_slots
  as permissive
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- trips_raw
drop policy if exists "driver own trips" on public.trips_raw;
create policy "driver own trips"
  on public.trips_raw
  as permissive
  for all
  using ((select auth.uid()) = driver_id);

-- session_zones (sous-requête imbriquée)
drop policy if exists session_zones_user_isolation on public.session_zones;
create policy session_zones_user_isolation
  on public.session_zones
  as permissive
  for all
  using (session_id in (select sessions.id from public.sessions where sessions.user_id = (select auth.uid())))
  with check (session_id in (select sessions.id from public.sessions where sessions.user_id = (select auth.uid())));

-- screenshot_uploads (4 policies)
drop policy if exists screenshot_uploads_select_own on public.screenshot_uploads;
create policy screenshot_uploads_select_own
  on public.screenshot_uploads
  as permissive
  for select
  using (user_id = (select auth.uid()));

drop policy if exists screenshot_uploads_insert_own on public.screenshot_uploads;
create policy screenshot_uploads_insert_own
  on public.screenshot_uploads
  as permissive
  for insert
  with check (user_id = (select auth.uid()));

drop policy if exists screenshot_uploads_update_own on public.screenshot_uploads;
create policy screenshot_uploads_update_own
  on public.screenshot_uploads
  as permissive
  for update
  using (user_id = (select auth.uid()));

drop policy if exists screenshot_uploads_delete_own on public.screenshot_uploads;
create policy screenshot_uploads_delete_own
  on public.screenshot_uploads
  as permissive
  for delete
  using (user_id = (select auth.uid()));

-- driver_quests (4 policies)
drop policy if exists driver_quests_select_own on public.driver_quests;
create policy driver_quests_select_own
  on public.driver_quests
  as permissive
  for select
  using (user_id = (select auth.uid()));

drop policy if exists driver_quests_insert_own on public.driver_quests;
create policy driver_quests_insert_own
  on public.driver_quests
  as permissive
  for insert
  with check (user_id = (select auth.uid()));

drop policy if exists driver_quests_update_own on public.driver_quests;
create policy driver_quests_update_own
  on public.driver_quests
  as permissive
  for update
  using (user_id = (select auth.uid()));

drop policy if exists driver_quests_delete_own on public.driver_quests;
create policy driver_quests_delete_own
  on public.driver_quests
  as permissive
  for delete
  using (user_id = (select auth.uid()));

-- driver_metrics (4 policies)
drop policy if exists driver_metrics_select_own on public.driver_metrics;
create policy driver_metrics_select_own
  on public.driver_metrics
  as permissive
  for select
  using (user_id = (select auth.uid()));

drop policy if exists driver_metrics_insert_own on public.driver_metrics;
create policy driver_metrics_insert_own
  on public.driver_metrics
  as permissive
  for insert
  with check (user_id = (select auth.uid()));

drop policy if exists driver_metrics_update_own on public.driver_metrics;
create policy driver_metrics_update_own
  on public.driver_metrics
  as permissive
  for update
  using (user_id = (select auth.uid()));

drop policy if exists driver_metrics_delete_own on public.driver_metrics;
create policy driver_metrics_delete_own
  on public.driver_metrics
  as permissive
  for delete
  using (user_id = (select auth.uid()));

-- push_subscriptions (2 des 3 policies sont affectées ;
-- allow_insert_own_subscription a with_check = true, pas d'auth.uid() -> pas touchée)
drop policy if exists allow_read_own_subscription on public.push_subscriptions;
create policy allow_read_own_subscription
  on public.push_subscriptions
  as permissive
  for select
  using (driver_id is null or driver_id = (select auth.uid())::text);

drop policy if exists allow_delete_own_subscription on public.push_subscriptions;
create policy allow_delete_own_subscription
  on public.push_subscriptions
  as permissive
  for delete
  using (driver_id is null or driver_id = (select auth.uid())::text);
