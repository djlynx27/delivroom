-- Phase 1 of Google Maps trajet ingestion: logs every "Naviguer" tap
-- (handleNavigationLaunch) so a future matching pass can enrich trips
-- with real Google Maps duration/distance. No matching logic yet —
-- this table only captures the launch event.
CREATE TABLE nav_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES auth.users(id),
  launched_at timestamptz NOT NULL DEFAULT now(),
  mode text CHECK (mode IN ('direct', 'prospection')),
  origin_lat float8,
  origin_lng float8,
  dest_lat float8 NOT NULL,
  dest_lng float8 NOT NULL,
  dest_zone_id text REFERENCES zones(id),
  dest_label text
);

ALTER TABLE nav_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "driver own nav events" ON nav_events
  FOR ALL USING (auth.uid() = driver_id);

CREATE INDEX nav_events_driver_launched ON nav_events (driver_id, launched_at DESC);
