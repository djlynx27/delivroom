CREATE TABLE trips_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES auth.users(id),
  platform text CHECK (platform IN ('lyft','imoove','hypra')),
  started_at timestamptz NOT NULL,
  pickup_lat float8, pickup_lng float8,
  dropoff_lat float8, dropoff_lng float8,
  distance_km float4,
  duration_min int2,
  fare_cad float4,
  tip_cad float4 DEFAULT 0,
  bonus_cad float4 DEFAULT 0,
  wait_min int2,
  zone_id text REFERENCES zones(id),
  raw_data jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE trips_raw ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver own trips" ON trips_raw
  FOR ALL USING (auth.uid() = driver_id);

CREATE INDEX trips_raw_driver_started ON trips_raw (driver_id, started_at DESC);
CREATE INDEX trips_raw_zone ON trips_raw (zone_id, started_at DESC);

CREATE TABLE zone_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id text REFERENCES zones(id),
  hour_of_day int2 CHECK (hour_of_day BETWEEN 0 AND 23),
  day_of_week int2 CHECK (day_of_week BETWEEN 0 AND 6),
  platform text CHECK (platform IN ('lyft','imoove','hypra','all')),
  avg_fare_cad float4,
  avg_wait_min float4,
  avg_distance_km float4,
  trip_count int4 DEFAULT 0,
  demand_score float4,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE zone_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read zone perf" ON zone_performance
  FOR SELECT USING (true);

CREATE INDEX zone_performance_lookup ON zone_performance (hour_of_day, day_of_week, platform);
CREATE UNIQUE INDEX zone_performance_unique ON zone_performance (zone_id, hour_of_day, day_of_week, platform);
