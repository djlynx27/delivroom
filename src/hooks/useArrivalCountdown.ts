import { haversineKm } from '@/hooks/useUserLocation';
import { useCallback, useEffect, useRef, useState } from 'react';

const ARRIVAL_RADIUS_KM = 0.3; // 300 m
const COUNTDOWN_SECONDS = 15 * 60; // 15 minutes
const STORAGE_KEY = 'delivroom_arrival_countdown';

interface CountdownState {
  zoneId: string;
  zoneName: string;
  arrivedAt: number; // epoch ms
}

function loadCountdownState(): CountdownState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CountdownState) : null;
  } catch {
    return null;
  }
}

function saveCountdownState(state: CountdownState | null) {
  try {
    if (state) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // quota exceeded or private-mode restriction — ignore
  }
}

export interface TargetZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface ArrivalCountdownResult {
  isCountingDown: boolean;
  arrivedZoneName: string | null;
  secondsRemaining: number;
  cancel: () => void;
  launchNow: () => void;
}

/**
 * Monitors user GPS position against the current target zone.
 * When the driver is within 300 m, a 15-minute countdown begins.
 * On expiry, `onComplete` is called so the caller can navigate to
 * the next best zone.
 */
export function useArrivalCountdown(
  targetZone: TargetZone | null,
  userLocation: { latitude: number; longitude: number } | null,
  onComplete: () => void
): ArrivalCountdownResult {
  const [countdownState, setCountdownState] = useState<CountdownState | null>(
    () => loadCountdownState()
  );
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    const saved = loadCountdownState();
    if (!saved) return COUNTDOWN_SECONDS;
    const elapsed = Math.floor((Date.now() - saved.arrivedAt) / 1000);
    return Math.max(0, COUNTDOWN_SECONDS - elapsed);
  });

  // Keep onComplete stable via ref to avoid restarting the timer effect
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Persist countdown state on every change
  useEffect(() => {
    saveCountdownState(countdownState);
  }, [countdownState]);

  // Arrival detection — only fires when not already counting down
  useEffect(() => {
    if (!targetZone || !userLocation || countdownState) return;

    const distKm = haversineKm(
      userLocation.latitude,
      userLocation.longitude,
      targetZone.latitude,
      targetZone.longitude
    );

    if (distKm <= ARRIVAL_RADIUS_KM) {
      setCountdownState({
        zoneId: targetZone.id,
        zoneName: targetZone.name,
        arrivedAt: Date.now(),
      });
    }
  }, [targetZone, userLocation, countdownState]);

  // Countdown timer — ticks every second while active
  useEffect(() => {
    if (!countdownState) {
      setSecondsRemaining(COUNTDOWN_SECONDS);
      return;
    }

    const tick = () => {
      const elapsed = Math.floor(
        (Date.now() - countdownState.arrivedAt) / 1000
      );
      const remaining = COUNTDOWN_SECONDS - elapsed;

      if (remaining <= 0) {
        setCountdownState(null);
        setSecondsRemaining(COUNTDOWN_SECONDS);
        onCompleteRef.current();
      } else {
        setSecondsRemaining(remaining);
      }
    };

    tick(); // immediate first tick
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [countdownState]);

  const cancel = useCallback(() => {
    setCountdownState(null);
    setSecondsRemaining(COUNTDOWN_SECONDS);
  }, []);

  const launchNow = useCallback(() => {
    setCountdownState(null);
    setSecondsRemaining(COUNTDOWN_SECONDS);
    onCompleteRef.current();
  }, []);

  return {
    isCountingDown: countdownState !== null,
    arrivedZoneName: countdownState?.zoneName ?? null,
    secondsRemaining,
    cancel,
    launchNow,
  };
}
