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
import { useActivityDetection } from './useActivityDetection';

const ACTIVE_SHIFT_KEY = 'delivroom_active_shift';
const AUTO_SHIFT_ENABLED_KEY = 'delivroom_auto_shift_enabled';

// Durée en véhicule avant démarrage auto (ms)
const VEHICLE_START_DELAY_MS = 30_000;
// Durée d'immobilisation avant suggestion d'arrêt (ms)
const STATIONARY_SUGGEST_MS = 15 * 60 * 1000;
// Délai minimal entre deux suggestions (ms) — évite le spam
const SUGGESTION_COOLDOWN_MS = 30 * 60 * 1000;
// Fréquence de vérification des timers
const CHECK_INTERVAL_MS = 10_000;

function readEnabled(): boolean {
  try {
    const val = localStorage.getItem(AUTO_SHIFT_ENABLED_KEY);
    return val !== 'false'; // activé par défaut
  } catch {
    return true;
  }
}

function writeEnabled(val: boolean) {
  try {
    localStorage.setItem(AUTO_SHIFT_ENABLED_KEY, val ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

function isShiftActive(): boolean {
  try {
    return !!localStorage.getItem(ACTIVE_SHIFT_KEY);
  } catch {
    return false;
  }
}

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

export function useAutoShift(): UseAutoShiftResult {
  const [enabled, setEnabled] = useState<boolean>(readEnabled);
  const { activity } = useActivityDetection();

  // Timestamps des transitions d'état
  const vehicleStartAtRef = useRef<number | null>(null);
  const stationaryStartAtRef = useRef<number | null>(null);
  const lastSuggestionAtRef = useRef<number | null>(null);
  // Guard : shift auto-démarré dans cette session (évite boucle)
  const autoStartedRef = useRef(false);

  const toggleEnabled = useCallback((val: boolean) => {
    writeEnabled(val);
    setEnabled(val);
  }, []);

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
