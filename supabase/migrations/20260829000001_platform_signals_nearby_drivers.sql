-- ============================================================
-- Migration: platform_signals_nearby_drivers
-- Delivroom (hibzhsjgipybfihhzpxr)
--
-- Lyft screenshot ingestion (ingest-lyft-screenshots Edge Function) needs
-- one more field than platform_signals already has: the rival-vehicle count
-- visible on the "nearby drivers" screenshot. Everything else it captures
-- (demand_score -> demand_level, wait_time_min -> estimated_wait_min,
-- platform='lyft', source='screenshot') already exists on this table and
-- is already read by useDemandScores.ts -- adding a new lyft_live_snapshots
-- table would duplicate that shape and orphan the data from the scoring
-- pipeline that already consumes platform_signals.
-- ============================================================

ALTER TABLE public.platform_signals
  ADD COLUMN IF NOT EXISTS nearby_drivers_count integer CHECK (nearby_drivers_count >= 0);
