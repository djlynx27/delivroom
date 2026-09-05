-- ============================================================
-- Migration: platform_signals_nearby_drivers_grid
-- Delivroom (hibzhsjgipybfihhzpxr)
--
-- Inverse Proximity Spotter needs the spatial distribution behind
-- nearby_drivers_count, not just the total: a row-major 3x3 grid over the
-- "Nearby drivers" screenshot's visible map (see ingest-lyft-screenshots'
-- Gemini prompt), consumed by src/lib/spotter.ts to steer the driver toward
-- the sparsest cell. Same platform_signals table as nearby_drivers_count
-- (added in 20260828234446) for the same reason: it's already the table
-- useDemandScores.ts reads for the Lyft realtime signal.
-- ============================================================

-- Non-negativity of each cell is enforced at the application layer
-- (ingest-lyft-screenshots' parseDriverGrid) -- a CHECK constraint can't
-- express "every element >= 0" without a subquery, which Postgres disallows
-- in CHECK clauses. The shape check (exactly 9 cells) still catches a
-- malformed insert at the DB layer.
ALTER TABLE public.platform_signals
  ADD COLUMN IF NOT EXISTS nearby_drivers_grid integer[]
    CHECK (nearby_drivers_grid IS NULL OR array_length(nearby_drivers_grid, 1) = 9);
