-- ============================================================
-- Migration: events_boost_multiplier_by_capacity
-- Delivroom (hibzhsjgipybfihhzpxr)
--
-- Event Scoring Booster: auto-computes events.boost_multiplier from
-- events.capacity (expected attendance) on insert/update, per the tiers:
--   <2 000    -> 1.15
--   2 000-8 000 -> 1.30
--   >8 000    -> 1.45
--   0/unknown -> 1.0 (no boost)
--
-- Deliberately NOT a new zone_events table: the existing events table
-- already boosts scoring.ts's zone-radius logic (boost_radius_km,
-- boost_zone_types) for events spanning multiple zones (Osheaga, Fierté,
-- Nuit Blanche, etc.) -- a strict zone_id FK would regress that. This only
-- adds the missing piece: auto-tiering the multiplier by attendance so a
-- curator (or a future "add event" admin form) doesn't have to hand-pick
-- boost_multiplier for the common case.
--
-- Only fires when the caller leaves boost_multiplier at its column default
-- (1.0) -- the 2026 events seed (20260319000001_events_2026.sql) hand-tunes
-- every value (2.8, 3.5, etc. for radius-wide festivals) and must never be
-- silently overwritten.
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_event_boost_multiplier(p_capacity int)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_capacity IS NULL OR p_capacity <= 0 THEN 1.0
    WHEN p_capacity < 2000 THEN 1.15
    WHEN p_capacity <= 8000 THEN 1.30
    ELSE 1.45
  END;
$$;

CREATE OR REPLACE FUNCTION public.events_set_boost_multiplier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.boost_multiplier = 1.0 THEN
    NEW.boost_multiplier := public.compute_event_boost_multiplier(NEW.capacity);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_set_boost_multiplier ON public.events;
CREATE TRIGGER trg_events_set_boost_multiplier
  BEFORE INSERT OR UPDATE OF capacity, boost_multiplier ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_set_boost_multiplier();
