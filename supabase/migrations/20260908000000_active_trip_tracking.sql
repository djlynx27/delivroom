-- Live Maxymo Trip Tracking overlay captures (payout / remaining time / remaining
-- distance read off the floating widget during an active ride), so DriveScreen
-- can show real-time $/h and $/km while a trip is in progress instead of only
-- after the fact from a completed-trip screenshot.
CREATE TABLE active_trip_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  payout_cad float4,
  distance_remaining_km float4,
  distance_total_km float4,
  time_remaining_min float4,
  time_total_min float4,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE active_trip_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver own active trip tracking" ON active_trip_tracking
  FOR ALL USING (auth.uid() = driver_id);

CREATE INDEX active_trip_tracking_driver_captured ON active_trip_tracking (driver_id, captured_at DESC);
