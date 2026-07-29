/**
 * useAutoShift — détection automatique du démarrage/arrêt du shift
 *
 * Détecte la vitesse GPS pour inférer si le chauffeur est en train de rouler.
 * Impossible de lire directement le statut Lyft Driver (app sandboxée), mais
 * le mouvement véhicule est une bonne approximation du statut "en ligne".
 *
 * Comportement :
 * - Auto-START  : roulage détecté (>15 km/h) pendant 30 s → démarre le shift
 * - Auto-SUGGEST : immobilisation > 15 min pendant un shift → toast "Terminer ?"
 *
 * Événements DOM émis (communique avec ShiftTracker) :
 * - `delivroom:shift-changed`   → ShiftTracker doit recharger son état LS
 * - `delivroom:auto-end-shift`  → ShiftTracker doit terminer le shift
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ACTIVE_SHIFT_KEY,
  isShiftActive,
  readAutoShiftEnabled,
  writeAutoShiftEnabled,
} from '@/lib/activeShift';
import { useActivityDetection } from './useActivityDetection';

// Durée en véhicule avant démarrage auto (ms)
const VEHICLE_START_DELAY_MS = 30_000;
// Durée d'immobilisation avant suggestion d'arrêt (ms)
const STATIONARY_SUGGEST_MS = 15 * 60 * 1000;
// Délai minimal entre deux suggestions (ms) — évite le spam
const SUGGESTION_COOLDOWN_MS = 30 * 60 * 1000;
// Fréquence de vérification des timers
const CHECK_INTERVAL_MS = 10_000;

function startShiftInStorage() {
  try {
    const shift = { startedAt: new Date().toISOString() };
    localStorage.setItem(ACTIVE_SHIFT_KEY, JSON.stringify(shift));
  } catch {
    // ignore
  }
}

export interface UseAutoShiftResult {
  /** Auto-shift activé ou non */
  enabled: boolean;
  /** Active ou désactive l'auto-shift */
  toggleEnabled: (val: boolean) => void;
}

/**
 * Lightweight hook exposing ONLY the enabled toggle — no GPS watch, no interval.
 * ShiftTracker uses this for its switch so it doesn't spin up a second detection
 * loop on top of the global AutoShiftMonitor (which runs the full useAutoShift).
 */
export function useAutoShiftEnabled(): UseAutoShiftResult {
  const [enabled, setEnabled] = useState<boolean>(readAutoShiftEnabled);
  const toggleEnabled = useCallback((val: boolean) => {
    writeAutoShiftEnabled(val);
    setEnabled(val);
  }, []);
  return { enabled, toggleEnabled };
}

export function useAutoShift(): UseAutoShiftResult {
  const { enabled, toggleEnabled } = useAutoShiftEnabled();
  const { activity } = useActivityDetection();

  // Timestamps des transitions d'état
  const vehicleStartAtRef = useRef<number | null>(null);
  const stationaryStartAtRef = useRef<number | null>(null);
  const lastSuggestionAtRef = useRef<number | null>(null);
  // Guard : shift auto-démarré dans cette session (évite boucle)
  const autoStartedRef = useRef(false);

  // Mise à jour des timestamps selon l'activité GPS
  useEffect(() => {
    if (activity === 'in_vehicle') {
      stationaryStartAtRef.current = null;
      autoStartedRef.current = false; // prêt à redémarrer si nécessaire
      if (vehicleStartAtRef.current === null) {
        vehicleStartAtRef.current = Date.now();
      }
    } else if (activity === 'stationary') {
      vehicleStartAtRef.current = null;
      if (stationaryStartAtRef.current === null) {
        stationaryStartAtRef.current = Date.now();
      }
    } else {
      // walking ou unknown
      vehicleStartAtRef.current = null;
      stationaryStartAtRef.current = null;
    }
  }, [activity]);

  // Intervalle de vérification : auto-start et suggestion d'arrêt
  useEffect(() => {
    if (!enabled) return;

    const intervalId = window.setInterval(() => {
      const now = Date.now();

      // ── Auto-START ────────────────────────────────────────────────────────
      if (
        vehicleStartAtRef.current !== null &&
        now - vehicleStartAtRef.current >= VEHICLE_START_DELAY_MS &&
        !isShiftActive()
      ) {
        vehicleStartAtRef.current = null; // reset pour pas re-déclencher
        startShiftInStorage();
        window.dispatchEvent(new CustomEvent('delivroom:shift-changed'));
        toast.success('Shift démarré automatiquement', {
          description: 'Mouvement véhicule détecté — bon shift !',
          duration: 5_000,
        });
      }

      // ── Suggestion d'ARRÊT ────────────────────────────────────────────────
      if (
        stationaryStartAtRef.current !== null &&
        now - stationaryStartAtRef.current >= STATIONARY_SUGGEST_MS &&
        isShiftActive() &&
        (lastSuggestionAtRef.current === null ||
          now - lastSuggestionAtRef.current >= SUGGESTION_COOLDOWN_MS)
      ) {
        lastSuggestionAtRef.current = now;
        stationaryStartAtRef.current = now; // reset pour éviter le spam

        toast.info('Tu sembles arrêté depuis 15 min', {
          description: 'Es-tu passé hors ligne sur Lyft / DoorDash ?',
          duration: 60_000,
          action: {
            label: 'Terminer le shift',
            onClick: () => {
              window.dispatchEvent(new CustomEvent('delivroom:auto-end-shift'));
            },
          },
        });
      }
    }, CHECK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [enabled]);

  return { enabled, toggleEnabled };
}
