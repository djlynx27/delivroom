-- Maxymo CSV import: pickup vs. trip distance/time split, needed by
-- learningEngine.ts to compute deadhead_ratio (pickup_distance_km /
-- total_distance_km) per zone. Added to trips (accepted/driven rides,
-- used for earnings + zone scoring) and to trips_raw (accepted AND
-- rejected offers, kept as raw market history).

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS pickup_distance_km numeric(8,2),
  ADD COLUMN IF NOT EXISTS pickup_time_min numeric(6,2),
  ADD COLUMN IF NOT EXISTS trip_distance_km numeric(8,2),
  ADD COLUMN IF NOT EXISTS drive_time_min numeric(6,2);

ALTER TABLE public.trips_raw
  ADD COLUMN IF NOT EXISTS pickup_distance_km float4,
  ADD COLUMN IF NOT EXISTS pickup_time_min float4,
  ADD COLUMN IF NOT EXISTS trip_distance_km float4,
  ADD COLUMN IF NOT EXISTS drive_time_min float4,
  ADD COLUMN IF NOT EXISTS offer_status text NOT NULL DEFAULT 'accepted';

ALTER TABLE public.trips_raw
  ADD CONSTRAINT trips_raw_offer_status_check
    CHECK (offer_status IN ('accepted', 'rejected'));

ALTER TABLE public.trips_raw
  DROP CONSTRAINT IF EXISTS trips_raw_platform_check;

ALTER TABLE public.trips_raw
  ADD CONSTRAINT trips_raw_platform_check
    CHECK (platform IN ('lyft', 'imoove', 'hypra', 'maxymo'));
