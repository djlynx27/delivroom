-- ============================================================
-- trips.source: distinguishes real driver trips from the synthetic
-- data-bootstrap prior (see src/scripts/seedSyntheticTrips.ts).
--
-- Existing 125 rows all have user_id = NULL (useAddTrip never set it,
-- predating the trips_user_isolation RLS policy) -- they stay 'real'
-- but remain invisible to auth.uid()-scoped reads. Fixed going forward
-- in useTrips.ts (this migration does not backfill user_id: there is
-- no way to know which anonymous driver owned each historical row).
-- ============================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'real'
    CHECK (source IN ('real', 'synthetic'));

CREATE INDEX IF NOT EXISTS idx_trips_source ON public.trips(source);

-- Synthetic rows have no owner (user_id NULL) and are meant as a shared
-- read-only baseline for the scoring/learning engine -- additional
-- permissive SELECT policy, OR'd with trips_user_isolation.
DROP POLICY IF EXISTS trips_synthetic_read ON public.trips;
CREATE POLICY trips_synthetic_read
  ON public.trips
  AS PERMISSIVE
  FOR SELECT
  USING (source = 'synthetic');
