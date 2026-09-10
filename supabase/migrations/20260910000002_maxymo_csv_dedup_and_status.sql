-- Maxymo CSV import robustness:
-- 1. content_hash lets the importer skip a row it already saved (re-dropping
--    the same export previously double-counted revenue — no way to detect
--    a repeat import existed before this).
-- 2. offer_status gains 'unknown' — an unrecognized/blank status now fails
--    closed (excluded from trips, kept in trips_raw) instead of silently
--    defaulting to 'accepted' with fabricated earnings.

ALTER TABLE public.trips_raw
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS trips_raw_driver_content_hash_unique
  ON public.trips_raw (driver_id, content_hash)
  WHERE content_hash IS NOT NULL;

ALTER TABLE public.trips_raw
  DROP CONSTRAINT IF EXISTS trips_raw_offer_status_check;

ALTER TABLE public.trips_raw
  ADD CONSTRAINT trips_raw_offer_status_check
    CHECK (offer_status IN ('accepted', 'rejected', 'unknown'));
