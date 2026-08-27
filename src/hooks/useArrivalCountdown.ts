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

  // Keep the latest targetZone reachable from cancel() below without making
  // it a dependency (cancel must stay referentially stable).
  const targetZoneRef = useRef(targetZone);
  targetZoneRef.current = targetZone;

  // A zone the driver explicitly dismissed (X / cancel) while still parked
  // inside it — without this, dismissing does nothing observable: cancel()
  // clears countdownState, which re-runs the arrival-detection effect below,
  // which immediately sees "still within 300 m" and re-arms the exact same
  // countdown, making the modal look stuck. Cleared once the driver actually
  // leaves the radius, so a genuine later arrival still counts.
  const dismissedZoneIdRef = useRef<string | null>(null);

  // Persist countdown state on every change
  useEffect(() => {
    saveCountdownState(countdownState);
  }, [countdownState]);

  // Arrival detection — only fires when not already counting down
  useEffect(() => {
    if (!targetZone || !userLocation) return;

    const distKm = haversineKm(
      userLocation.latitude,
      userLocation.longitude,
      targetZone.latitude,
      targetZone.longitude
    );

    if (distKm > ARRIVAL_RADIUS_KM) {
      if (dismissedZoneIdRef.current === targetZone.id) {
        dismissedZoneIdRef.current = null;
      }
      return;
    }

    if (countdownState || dismissedZoneIdRef.current === targetZone.id) return;

    setCountdownState({
      zoneId: targetZone.id,
      zoneName: targetZone.name,
      arrivedAt: Date.now(),
    });
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
    dismissedZoneIdRef.current = targetZoneRef.current?.id ?? null;
    setCountdownState(null);
    setSecondsRemaining(COUNTDOWN_SECONDS);
  }, []);

  const launchNow = useCallback(() => {
    dismissedZoneIdRef.current = targetZoneRef.current?.id ?? null;
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
