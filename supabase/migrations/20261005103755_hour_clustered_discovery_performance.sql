-- Hour-clustered variant of get_discovery_performance / get_major_zone_benchmark
-- (migration 20260910015912_zone_discovery_performance.sql).
--
-- Policy (confirmed 2026-09-19, "Algorithm Alignment"): a discovered
-- micro-zone must NEVER outrank a major hub on raw occurrence count alone.
-- It may only do so when BOTH hold for the SAME hour window and day-type as
-- right now:
--   1. Hour-clustered recurrence: >= 3 real trips at that address inside the
--      window (not 3 occurrences ever, at any time of day).
--   2. Financial threshold: its $/km AND $/h at that window beat the major
--      zones' own $/km and $/h at that same window (not the all-day average
--      -- a spot that's only good at 7-8h30 shouldn't be judged against a
--      hub's evening numbers).
-- Without both, the discovery stays 'pending' / secondary and must never
-- become a Hero Zone recommendation. This mirrors the safeguard already
-- enforced for zone_discoveries auto-promotion (20260919120000) -- same
-- failure mode (a personal/one-off coordinate looking like a hotspot) can
-- otherwise resurface through the scoring path instead of the promotion path.

create or replace function public.get_discovery_performance_at_hour(
  p_address text,
  p_hour_start int,   -- inclusive, 0-23
  p_hour_end int,     -- exclusive, 0-23; wraps past midnight if < p_hour_start
  p_weekend boolean   -- true = Sat/Sun, false = Mon-Fri
)
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
      and (extract(dow from t.started_at) in (0, 6)) = p_weekend
      and (
        case
          when p_hour_start <= p_hour_end then
            extract(hour from t.started_at) >= p_hour_start
            and extract(hour from t.started_at) < p_hour_end
          else -- window wraps past midnight (e.g. 22h-02h)
            extract(hour from t.started_at) >= p_hour_start
            or extract(hour from t.started_at) < p_hour_end
        end
      )
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

create or replace function public.get_major_zone_benchmark_at_hour(
  p_hour_start int,
  p_hour_end int,
  p_weekend boolean,
  p_top_n int default 5
)
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
    where is_synthetic = false
      and earnings is not null
      and zone_id is not null
      and (extract(dow from started_at) in (0, 6)) = p_weekend
      and (
        case
          when p_hour_start <= p_hour_end then
            extract(hour from started_at) >= p_hour_start
            and extract(hour from started_at) < p_hour_end
          else
            extract(hour from started_at) >= p_hour_start
            or extract(hour from started_at) < p_hour_end
        end
      )
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
