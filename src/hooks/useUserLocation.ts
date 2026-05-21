import { useCallback, useEffect, useRef, useState } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import type { Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

interface UserLocation {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  timestamp?: number;
}

export type UserLocationStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UserLocationResult {
  location: UserLocation | null;
  status: UserLocationStatus;
  error: string | null;
  refresh: () => Promise<UserLocation | null>;
}

function getGeolocationErrorMessage(error: any) {
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  return 'Impossible de récupérer la position actuelle';
}

function normalizePosition(pos: Position | GeolocationPosition): UserLocation {
  // Capacitor Position vs Web GeolocationPosition
  const coords = pos.coords;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    heading: typeof coords.heading === 'number' ? coords.heading : null,
    speed: typeof coords.speed === 'number' ? coords.speed : null,
    accuracy: typeof coords.accuracy === 'number' ? coords.accuracy : null,
    timestamp: pos.timestamp,
  };
}

export async function requestCurrentPreciseLocation(
  options?: PositionOptions
): Promise<UserLocation> {
  if (Capacitor.isNativePlatform()) {
    try {
      const permissions = await Geolocation.checkPermissions();
      if (permissions.location !== 'granted') {
        const request = await Geolocation.requestPermissions();
        if (request.location !== 'granted') {
          throw new Error('Permission de localisation refusée');
        }
      }

      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        ...options,
      });
      return normalizePosition(pos);
    } catch (err) {
      throw new Error(getGeolocationErrorMessage(err));
    }
  }

  // Fallback to Web API
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(normalizePosition(pos)),
      (error) => reject(new Error(getGeolocationErrorMessage(error))),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
        ...options,
      }
    );
  });
}

export function useUserLocation(intervalMs = 10000): UserLocationResult {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [status, setStatus] = useState<UserLocationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const latestLocationRef = useRef<UserLocation | null>(null);

  const applyLocation = useCallback((nextLocation: UserLocation) => {
    const now = Date.now();
    const previousLocation = latestLocationRef.current;

    // Throttle updates to avoid UI flicker, but keep it responsive for driving
    if (now - lastUpdateRef.current < 1000 && lastUpdateRef.current !== 0) {
      return;
    }

    // Ensure we don't process stale updates
    if (
      previousLocation?.timestamp != null &&
      nextLocation.timestamp != null &&
      nextLocation.timestamp < previousLocation.timestamp
    ) {
      return;
    }

    lastUpdateRef.current = now;
    latestLocationRef.current = nextLocation;
    setLocation(nextLocation);
    setStatus('success');
    setError(null);
  }, []);

  const update = useCallback(async () => {
    setStatus((prev) => (prev === 'success' ? prev : 'loading'));

    try {
      const nextLocation = await requestCurrentPreciseLocation();
      applyLocation(nextLocation);
      return nextLocation;
    } catch (err) {
      const message = getGeolocationErrorMessage(err);
      if (!latestLocationRef.current) {
        setStatus('error');
      }
      setError(message);
      return null;
    }
  }, [applyLocation]);

  useEffect(() => {
    void update();
    const id = setInterval(update, intervalMs);

    let watchId: string | number | null = null;

    const startWatching = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          watchId = await Geolocation.watchPosition(
            {
              enableHighAccuracy: true,
              requestDaylightSavingsTime: true, // Not relevant but showing usage
            },
            (pos, err) => {
              if (err) {
                setError(getGeolocationErrorMessage(err));
              } else if (pos) {
                applyLocation(normalizePosition(pos));
              }
            }
          );
        } catch (err) {
          setError(getGeolocationErrorMessage(err));
        }
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
          (pos) => applyLocation(normalizePosition(pos)),
          (watchError) => {
            setError(getGeolocationErrorMessage(watchError));
          },
          {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000,
          }
        );
      }
    };

    void startWatching();

    return () => {
      clearInterval(id);
      if (watchId !== null) {
        if (Capacitor.isNativePlatform()) {
          void Geolocation.clearWatch({ id: watchId as string });
        } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.clearWatch(watchId as number);
        }
      }
    };
  }, [applyLocation, update, intervalMs]);

  return { location, status, error, refresh: update };
}

/** Haversine distance in km */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
