import { useActivityDetection } from '@/hooks/useActivityDetection';
import { triggerZoneIdlePush } from '@/lib/zoneIdlePush';
import { AlertTriangle, Pause, Timer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// Above this, `elapsed` is untrustworthy (a stale timestamp survived a bad
// state transition) rather than a real dead-time streak — clamp to 00:00
// instead of showing a five-figure minute count.
const MAX_DEAD_TIME_MS = 24 * 60 * 60 * 1000;

// Separate, higher bar than the in-app yellow warning (10 min) — a push
// notification reaches the driver even with Delivroom backgrounded, so it
// warrants more certainty that this isn't just a red light or a quick stop.
const PUSH_ALERT_THRESHOLD_MINS = 15;

interface TimerState {
  startedAt: number | null;
  accumulated: number; // ms accumulated before the current running segment
  paused: boolean;
}

function initialState(libreMode: boolean): TimerState {
  return libreMode
    ? { startedAt: Date.now(), accumulated: 0, paused: false }
    : { startedAt: null, accumulated: 0, paused: true };
}

/**
 * Central guard for the mm:ss display — any negative, non-finite, or >24h
 * elapsed value renders as 00:00 instead of computing garbage minutes.
 * Returns `mins` too so the "warning" threshold below reads the same
 * clamped number the display shows, instead of risking a second unclamped
 * computation drifting from what's on screen.
 */
export function formatMinutes(elapsedMs: number): { display: string; mins: number } {
  const safeMs =
    Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= MAX_DEAD_TIME_MS
      ? elapsedMs
      : 0;
  const seconds = Math.floor(safeMs / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return {
    display: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    mins,
  };
}

function getTimerAppearance(paused: boolean, warning: boolean) {
  if (paused) {
    return {
      containerClass: 'bg-muted/30 border-border',
      icon: <Pause className="w-4 h-4 text-muted-foreground" />,
      label: 'Temps mort (en pause)',
      valueClass: 'text-foreground',
    };
  }

  if (warning) {
    return {
      containerClass: 'bg-yellow-500/15 border-yellow-500/40',
      icon: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
      label: 'Temps mort',
      valueClass: 'text-yellow-500',
    };
  }

  return {
    containerClass: 'bg-card border-border',
    icon: <Timer className="w-4 h-4 text-muted-foreground" />,
    label: 'Temps mort',
    valueClass: 'text-foreground',
  };
}

interface Props {
  nearestZoneName?: string | null;
  /** Real Libre/Occupé status from the Drive tab. Defaults to true (always counting) for screens with no such toggle. */
  libreMode?: boolean;
}

export function DeadTimeTimer({ nearestZoneName, libreMode = true }: Props) {
  const [state, setState] = useState<TimerState>(() => initialState(libreMode));
  const [elapsed, setElapsed] = useState(0);
  const { activity } = useActivityDetection();
  const prevLibreRef = useRef(libreMode);
  // Tracks whether the push already fired for the CURRENT dead-time streak —
  // cleared alongside state so a fresh streak (new libre period) can alert
  // again, but a single long streak never spams more than one push.
  const pushSentRef = useRef(false);

  // Reset to exactly 0 the instant libreMode flips true; hide (and drop any
  // running segment) the instant it flips false — no cross-status carryover.
  useEffect(() => {
    if (libreMode === prevLibreRef.current) return;
    prevLibreRef.current = libreMode;
    setState(initialState(libreMode));
    pushSentRef.current = false;
  }, [libreMode]);

  // Pause or resume based on detected movement, only while actually libre —
  // a status flip already reset/hid the timer above, this just handles
  // walking/driving within an ongoing libre streak.
  useEffect(() => {
    if (!libreMode) return;
    if (activity === 'walking' || activity === 'in_vehicle') {
      setState((prev) => {
        if (prev.paused) return prev;
        const now = Date.now();
        const totalAccum =
          prev.accumulated + (prev.startedAt ? now - prev.startedAt : 0);
        return { startedAt: null, accumulated: totalAccum, paused: true };
      });
    } else if (activity === 'stationary' || activity === 'unknown') {
      setState((prev) => {
        if (!prev.paused) return prev;
        return { startedAt: Date.now(), accumulated: prev.accumulated, paused: false };
      });
    }
  }, [activity, libreMode]);

  // Tick every second while running.
  useEffect(() => {
    if (!libreMode || state.paused) {
      setElapsed(state.accumulated);
      return;
    }
    const tick = () => {
      const now = Date.now();
      setElapsed(state.accumulated + (state.startedAt ? now - state.startedAt : 0));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state, libreMode]);

  // Fires the background-reachable push once per streak, the instant this
  // tab is foregrounded and observes the threshold crossed — it can't detect
  // the crossing while itself backgrounded (Chrome throttles timers in a
  // hidden tab), so this covers "glanced away, comes back 5 min later" not
  // "never reopened the app during the idle window."
  useEffect(() => {
    if (!libreMode || state.paused || pushSentRef.current) return;
    if (formatMinutes(elapsed).mins < PUSH_ALERT_THRESHOLD_MINS) return;
    pushSentRef.current = true;
    void triggerZoneIdlePush(nearestZoneName ?? null);
  }, [elapsed, libreMode, state.paused, nearestZoneName]);

  if (!libreMode) return null;

  const { display, mins } = formatMinutes(elapsed);
  const isWarning = mins >= 10;
  const appearance = getTimerAppearance(state.paused, isWarning);

  return (
    <div className={`rounded-xl border px-4 py-3 ${appearance.containerClass}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {appearance.icon}
          <span className="text-[14px] font-body text-muted-foreground">
            {appearance.label}
          </span>
        </div>
        <span
          className={`text-[24px] font-display font-bold tabular-nums ${appearance.valueClass}`}
        >
          {display}
        </span>
      </div>
      {isWarning && !state.paused && nearestZoneName && (
        <p className="text-[13px] text-yellow-500 font-body mt-1">
          ⚠️ +10 min d'inactivité — Dirige-toi vers {nearestZoneName}
        </p>
      )}
    </div>
  );
}
