import type { Database } from '@/integrations/supabase/types';

type TripRow = Database['public']['Tables']['trips']['Row'];

/** Columns added to `trips` after most existing test fixtures were written
 * — spread first in a fixture literal so explicit fields in the literal
 * still override these neutral defaults. */
export const TRIP_DEFAULTS: Pick<
  TripRow,
  | 'drive_time_min'
  | 'duration_minutes'
  | 'is_synthetic'
  | 'pickup_distance_km'
  | 'pickup_time_min'
  | 'trip_distance_km'
> = {
  drive_time_min: null,
  duration_minutes: null,
  is_synthetic: null,
  pickup_distance_km: null,
  pickup_time_min: null,
  trip_distance_km: null,
};

type SessionRow = Database['public']['Tables']['sessions']['Row'];

/** Columns added to `sessions` after most existing test fixtures were
 * written — same spread-first pattern as TRIP_DEFAULTS. */
export const SESSION_DEFAULTS: Pick<
  SessionRow,
  'active_zone_id' | 'last_heartbeat_at' | 'last_lat' | 'last_lng'
> = {
  active_zone_id: null,
  last_heartbeat_at: null,
  last_lat: null,
  last_lng: null,
};
