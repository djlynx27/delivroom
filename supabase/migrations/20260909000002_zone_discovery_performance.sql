-- Feeds the zone-discovery auto-promotion algorithm (src/lib/zonePromotion.ts):
-- a "pépite" (opportunistic micro-zone) only auto-promotes once it clears
-- BOTH a repetition threshold (zone_discoveries.count) and a real-earnings
-- bar set by the major zones' own $/km and $/h. Both functions are
-- SECURITY INVOKER — they read trips/screenshot_uploads through the calling
-- user's own RLS, same as every other client-facing read in this project.

-- Average $/km and $/h across the top N zones by real trip volume — the
-- performance bar an opportunistic discovery must meet or beat.
create or replace function public.get_major_zone_benchmark(p_top_n int default 5)
returns table(avg_per_km numeric, avg_per_h numeric)
language sql
security invoker
stable
set search_path = public
as $$
  with base as (
    select
      zone_id,
      (earnings + coalesce(tips, 0)) as revenue,
      distance_km,
      coalesce(extract(epoch from (ended_at - started_at)) / 3600.0, duration_minutes / 60.0) as hours
    from trips
    where is_synthetic = false and earnings is not null and zone_id is not null
  ),
  per_zone as (
    select
      zone_id,
      count(*) as n,
      avg(revenue / nullif(distance_km, 0)) filter (where distance_km is not null and distance_km > 0) as z_per_km,
      avg(revenue / nullif(hours, 0)) filter (where hours is not null and hours > 0) as z_per_h
    from base
    group by zone_id
  ),
  top_zones as (
    select * from per_zone order by n desc limit p_top_n
  )
  select avg(z_per_km), avg(z_per_h) from top_zones;
$$;

-- A discovered address never gets its own zone_id until promoted — its
-- trips land on the city-fallback zone instead, so the only way back to
-- "how did THIS specific spot actually perform" is through the screenshot
-- that named it: match zone_discoveries.address against the pickup/dropoff
-- address Gemini extracted, joined to trips via the filename embedded in
-- notes (same join used by the duration_minutes/ended_at backfill).
create or replace function public.get_discovery_performance(p_address text)
returns table(sample_size int, avg_per_km numeric, avg_per_h numeric)
language sql
security invoker
stable
set search_path = public
as $$
  with matched as (
    select
      (t.earnings + coalesce(t.tips, 0)) as revenue,
      t.distance_km,
      coalesce(extract(epoch from (t.ended_at - t.started_at)) / 3600.0, t.duration_minutes / 60.0) as hours
    from trips t
    join screenshot_uploads su
      on su.file_name = substring(t.notes from length('Import bulk — ') + 1)
    where t.is_synthetic = false
      and t.earnings is not null
      and t.notes like 'Import bulk — %'
      and (
        su.analysis_result->'extracted_data'->>'pickup_address' ilike p_address
        or su.analysis_result->'extracted_data'->>'dropoff_address' ilike p_address
      )
  )
  select
    count(*)::int,
    avg(revenue / nullif(distance_km, 0)) filter (where distance_km is not null and distance_km > 0),
    avg(revenue / nullif(hours, 0)) filter (where hours is not null and hours > 0)
  from matched;
$$;
