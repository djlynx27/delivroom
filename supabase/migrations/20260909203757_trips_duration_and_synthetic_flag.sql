-- Unblocks the $/h metric: duration_minutes is populated from the
-- screenshot analysis (pickup_time_minutes + ride_time_minutes) so
-- ended_at = started_at + duration_minutes becomes computable.
-- is_synthetic mirrors source = 'synthetic' as a real boolean so analytics
-- queries can filter with `is_synthetic = false` without duplicating the
-- source string.

alter table public.trips
  add column if not exists duration_minutes numeric,
  add column if not exists is_synthetic boolean generated always as (source = 'synthetic') stored;

comment on column public.trips.duration_minutes is
  'Ride duration in minutes, derived from the screenshot analysis (pickup_time_minutes + ride_time_minutes) — used with started_at to compute ended_at.';
comment on column public.trips.is_synthetic is
  'Generated column mirroring source = ''synthetic''; lets analytics filter with is_synthetic = false.';
