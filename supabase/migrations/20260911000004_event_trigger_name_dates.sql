-- supabase/migrations/20260911000004_event_trigger_name_dates.sql
--
-- Extends create_event_zone_trg's watched columns to also fire on
-- name, start_at, and end_at changes, so renaming an event or editing
-- its schedule keeps the ephemeral zone's row (and cleanup_expired_
-- event_zones' end_at-based expiry, which reads events.end_at live on
-- every run rather than a snapshot) in sync. Function body unchanged.

DROP TRIGGER IF EXISTS create_event_zone_trg ON public.events;

CREATE TRIGGER create_event_zone_trg
AFTER INSERT OR UPDATE OF name, latitude, longitude, capacity, demand_impact, boost_radius_km, boost_multiplier, start_at, end_at
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.create_event_zone();
