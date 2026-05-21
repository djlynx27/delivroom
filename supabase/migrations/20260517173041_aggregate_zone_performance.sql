-- 1. Fonction d'agrégation principale
CREATE OR REPLACE FUNCTION aggregate_zone_performance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO zone_performance (
    id, zone_id, hour_of_day, day_of_week, platform,
    avg_fare_cad, avg_wait_min, avg_distance_km, trip_count, demand_score, updated_at
  )
  SELECT
    gen_random_uuid(),
    tr.zone_id,
    EXTRACT(HOUR FROM tr.started_at)::smallint,
    EXTRACT(DOW  FROM tr.started_at)::smallint,
    COALESCE(tr.platform, 'unknown'),
    AVG(tr.fare_cad)::real,
    AVG(tr.wait_min)::real,
    AVG(tr.distance_km)::real,
    COUNT(*)::integer,
    LEAST(
      100.0,
      (COUNT(*) * 100.0 / NULLIF(
        MAX(COUNT(*)) OVER (
          PARTITION BY EXTRACT(HOUR FROM tr.started_at),
                       EXTRACT(DOW  FROM tr.started_at)
        ), 0
      ))
    )::real,
    NOW()
  FROM trips_raw tr
  WHERE tr.zone_id IS NOT NULL
  GROUP BY
    tr.zone_id,
    EXTRACT(HOUR FROM tr.started_at),
    EXTRACT(DOW  FROM tr.started_at),
    COALESCE(tr.platform, 'unknown')
  ON CONFLICT (zone_id, hour_of_day, day_of_week, platform)
  DO UPDATE SET
    avg_fare_cad    = EXCLUDED.avg_fare_cad,
    avg_wait_min    = EXCLUDED.avg_wait_min,
    avg_distance_km = EXCLUDED.avg_distance_km,
    trip_count      = EXCLUDED.trip_count,
    demand_score    = EXCLUDED.demand_score,
    updated_at      = NOW();
END;
$$;

-- 2. Contrainte UNIQUE (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'zone_performance_zone_hour_dow_platform_key'
  ) THEN
    ALTER TABLE zone_performance
      ADD CONSTRAINT zone_performance_zone_hour_dow_platform_key
      UNIQUE (zone_id, hour_of_day, day_of_week, platform);
  END IF;
END;
$$;

-- 3. Trigger incrémental sur INSERT trips_raw
CREATE OR REPLACE FUNCTION trg_trips_raw_aggregate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO zone_performance (
    id, zone_id, hour_of_day, day_of_week, platform,
    avg_fare_cad, avg_wait_min, avg_distance_km, trip_count, demand_score, updated_at
  )
  SELECT
    gen_random_uuid(),
    NEW.zone_id,
    EXTRACT(HOUR FROM NEW.started_at)::smallint,
    EXTRACT(DOW  FROM NEW.started_at)::smallint,
    COALESCE(NEW.platform, 'unknown'),
    AVG(fare_cad)::real,
    AVG(wait_min)::real,
    AVG(distance_km)::real,
    COUNT(*)::integer,
    LEAST(100.0, COUNT(*) * 2.0)::real,
    NOW()
  FROM trips_raw
  WHERE zone_id   = NEW.zone_id
    AND EXTRACT(HOUR FROM started_at) = EXTRACT(HOUR FROM NEW.started_at)
    AND EXTRACT(DOW  FROM started_at) = EXTRACT(DOW  FROM NEW.started_at)
    AND COALESCE(platform, 'unknown')  = COALESCE(NEW.platform, 'unknown')
  GROUP BY zone_id
  ON CONFLICT (zone_id, hour_of_day, day_of_week, platform)
  DO UPDATE SET
    avg_fare_cad    = EXCLUDED.avg_fare_cad,
    avg_wait_min    = EXCLUDED.avg_wait_min,
    avg_distance_km = EXCLUDED.avg_distance_km,
    trip_count      = EXCLUDED.trip_count,
    demand_score    = EXCLUDED.demand_score,
    updated_at      = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aggregate_on_trip_insert ON trips_raw;
CREATE TRIGGER trg_aggregate_on_trip_insert
  AFTER INSERT ON trips_raw
  FOR EACH ROW
  EXECUTE FUNCTION trg_trips_raw_aggregate();
