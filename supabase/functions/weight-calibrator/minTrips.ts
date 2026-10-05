// supabase/functions/weight-calibrator/minTrips.ts
//
// Server-side floor on the sample size a calibration may run on. `min_trips` is
// caller-controlled (the function is deployed --no-verify-jwt), so without a floor
// a single poisoned trip_predictions row could steer the weights via
// {"min_trips":1}. The default stays 10; callers may only ask for MORE.

export const MIN_TRIPS_FLOOR = 10;

export function enforceMinTripsFloor(requested: number): number {
  return Math.max(MIN_TRIPS_FLOOR, requested);
}
