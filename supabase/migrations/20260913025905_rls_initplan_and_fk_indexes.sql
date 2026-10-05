-- Fix auth_rls_initplan advisor warnings: wrap auth.uid() in (select ...) so
-- Postgres evaluates it once per query instead of once per row.
drop policy if exists "driver own active trip tracking" on public.active_trip_tracking;
create policy "driver own active trip tracking" on public.active_trip_tracking
  for all
  using ((select auth.uid()) = driver_id);

drop policy if exists "driver own nav events" on public.nav_events;
create policy "driver own nav events" on public.nav_events
  for all
  using ((select auth.uid()) = driver_id);

drop policy if exists "sessions_user_isolation" on public.sessions;
create policy "sessions_user_isolation" on public.sessions
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "session_zones_user_isolation" on public.session_zones;
create policy "session_zones_user_isolation" on public.session_zones
  for all
  using (session_id in (
    select sessions.id from public.sessions
    where (select auth.uid()) = sessions.user_id
  ));

-- Fix unindexed_foreign_keys advisor warnings.
create index if not exists idx_content_pipeline_user_id on public.content_pipeline (user_id);
create index if not exists idx_demand_patterns_zone_id on public.demand_patterns (zone_id);
create index if not exists idx_events_city_id on public.events (city_id);
create index if not exists idx_nav_events_dest_zone_id on public.nav_events (dest_zone_id);
create index if not exists idx_predictions_zone_id on public.predictions (zone_id);
create index if not exists idx_screenshot_uploads_trip_id on public.screenshot_uploads (trip_id);
create index if not exists idx_session_zones_session_id on public.session_zones (session_id);
create index if not exists idx_session_zones_zone_id on public.session_zones (zone_id);
create index if not exists idx_sessions_active_zone_id on public.sessions (active_zone_id);
create index if not exists idx_user_pings_zone_id on public.user_pings (zone_id);
create index if not exists idx_zone_discoveries_city_hint on public.zone_discoveries (city_hint);
create index if not exists idx_zone_discoveries_user_id on public.zone_discoveries (user_id);
create index if not exists idx_zone_discoveries_promoted_zone_id on public.zone_discoveries (promoted_zone_id);
create index if not exists idx_zones_city_id on public.zones (city_id);
