// Market Radar: crowdsourced nearby-driver density via Supabase Realtime
// Presence. No new table — presence is ephemeral, in-memory on Supabase's
// side, gone the moment a driver disconnects. Positions are rounded to a
// ~500 m grid before ever leaving the device, so no exact location is
// broadcast to other drivers.

import { supabase } from '@/integrations/supabase/client';
import { haversineKm } from '@/hooks/useUserLocation';
import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

const PRIVACY_GRID_METERS = 500;

/** Rounds lat/lng to a ~500 m grid so a broadcast position never pins an
 * exact driver location. */
export function roundToPrivacyGrid(
  lat: number,
  lng: number,
  gridMeters: number = PRIVACY_GRID_METERS
): { lat: number; lng: number } {
  const latStep = gridMeters / 110_574;
  const roundedLat = Math.round(lat / latStep) * latStep;
  // Derive lngStep from the *rounded* lat, not the raw input -- otherwise
  // two nearby points with slightly different raw lat get slightly
  // different lngStep sizes and can round to different grid cells even
  // though they land in the same lat cell.
  const lngStep = gridMeters / (111_320 * Math.cos((roundedLat * Math.PI) / 180));
  return {
    lat: roundedLat,
    lng: Math.round(lng / lngStep) * lngStep,
  };
}

export interface NearbyDriverPosition {
  lat: number;
  lng: number;
  updatedAt: string;
}

/** Joins the per-city presence channel; caller tracks its own position via
 * the returned channel and must supabase.removeChannel() it on cleanup. */
export function joinNearbyDriversChannel(
  cityId: string,
  driverKey: string,
  onSync: (positions: NearbyDriverPosition[]) => void
): RealtimeChannel {
  const channel = supabase.channel(`nearby-drivers:${cityId}`, {
    config: { presence: { key: driverKey } },
  });

  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState<NearbyDriverPosition>();
    onSync(Object.values(state).flatMap((entries) => entries));
  });

  channel.subscribe();
  return channel;
}

export function trackNearbyDriverPosition(
  channel: RealtimeChannel,
  lat: number,
  lng: number
): void {
  const rounded = roundToPrivacyGrid(lat, lng);
  void channel.track({
    lat: rounded.lat,
    lng: rounded.lng,
    updatedAt: new Date().toISOString(),
  });
}

/** Buckets each (already-rounded) driver position into its nearest zone,
 * within `matchRadiusKm` — positions too far from any zone are dropped. */
export function countDriversPerZone(
  positions: NearbyDriverPosition[],
  zones: { id: string; latitude: number; longitude: number }[],
  matchRadiusKm = 1.5
): Map<string, number> {
  const counts = new Map<string, number>(zones.map((z) => [z.id, 0]));

  for (const pos of positions) {
    let nearestZoneId: string | null = null;
    let nearestDist = Infinity;
    for (const zone of zones) {
      const dist = haversineKm(pos.lat, pos.lng, zone.latitude, zone.longitude);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestZoneId = zone.id;
      }
    }
    if (nearestZoneId !== null && nearestDist <= matchRadiusKm) {
      counts.set(nearestZoneId, (counts.get(nearestZoneId) ?? 0) + 1);
    }
  }

  return counts;
}

/** Above this, the zone is flagged "saturée" and its score gets nudged down. */
export const SATURATION_ALERT_THRESHOLD = 1.5;

/** SaturationFactor = ActiveDriversInZone / BaseDemandScore. */
export function computeSaturationFactor(
  activeDriversInZone: number,
  baseDemandScore: number
): number {
  if (baseDemandScore <= 0) return activeDriversInZone > 0 ? Infinity : 0;
  return activeDriversInZone / baseDemandScore;
}

/**
 * A saturated zone is still worth knowing about, just less of a sure thing
 * -- degrade rather than hide it, capped at -30% so one crowded moment
 * can't zero out an otherwise-solid recommendation.
 */
export function applySaturationDegradation(
  score: number,
  saturationFactor: number
): number {
  if (saturationFactor <= SATURATION_ALERT_THRESHOLD) return score;
  const excess = saturationFactor - SATURATION_ALERT_THRESHOLD;
  const penalty = Math.min(0.3, excess * 0.1);
  return Math.round(score * (1 - penalty));
}

export interface UseNearbyDriversResult {
  /** Per-zone active driver count, from the latest presence sync. */
  driversByZone: Map<string, number>;
  /** Zone ids currently past SATURATION_ALERT_THRESHOLD. */
  saturatedZoneIds: Set<string>;
}

/**
 * Joins the city's presence channel, tracks this driver's rounded position,
 * and buckets everyone's positions into zones. Returns empty results until
 * the first presence sync (or if cityId/location is unavailable) --
 * callers should treat this as "no data yet", not "zone confirmed quiet".
 */
export function useNearbyDrivers(
  cityId: string | undefined,
  location: { latitude: number; longitude: number } | null,
  zones: { id: string; latitude: number; longitude: number; score: number }[],
  driverKey: string
): UseNearbyDriversResult {
  const [positions, setPositions] = useState<NearbyDriverPosition[]>([]);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!cityId) return;
    const newChannel = joinNearbyDriversChannel(cityId, driverKey, setPositions);
    setChannel(newChannel);
    return () => {
      supabase.removeChannel(newChannel);
      setChannel(null);
      setPositions([]);
    };
  }, [cityId, driverKey]);

  useEffect(() => {
    if (!channel || !location) return;
    trackNearbyDriverPosition(channel, location.latitude, location.longitude);
  }, [channel, location?.latitude, location?.longitude]);

  const driversByZone = countDriversPerZone(positions, zones);
  const saturatedZoneIds = new Set(
    zones
      .filter(
        (zone) =>
          computeSaturationFactor(driversByZone.get(zone.id) ?? 0, zone.score) >
          SATURATION_ALERT_THRESHOLD
      )
      .map((zone) => zone.id)
  );

  return { driversByZone, saturatedZoneIds };
}
