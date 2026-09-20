// useShiftGeoWatcher — keeps the background geofencing foreground service
// (shiftGeoWatcher.ts) in the right mode ('shift' when active, 'idle'
// otherwise — never stopped, see ensureWatcherMode), and wires the "GO →"
// notification tap handler once per app launch.
//
// "Active" has two independent sources, and both must be watched:
// - Local (activeShift.ts / 'delivroom:shift-changed'): manual "Démarrer un
//   shift" button, GPS auto-start (useAutoShift), ScreenshotAnalyzer.
// - Server (useShift.ts / shift-tracker Edge Function): MacroDroid flipping
//   Lyft Driver Online/Offline. This is the ONLY source for that path —
//   ShiftTracker.tsx's own server->local sync (useEffectiveShift) writes
//   straight to localStorage without dispatching 'delivroom:shift-changed',
//   and it only runs at all while ShiftTracker is mounted. A watcher keyed
//   solely on the local echo/event never learns about a MacroDroid-driven
//   shift. useShift() is polled/re-rendered independently of any of that,
//   so it's the one source guaranteed to reflect a MacroDroid start.
import { useEffect } from 'react';
import { useShift } from '@/hooks/useShift';
import { isShiftActive } from '@/lib/activeShift';
import {
  ensureWatcherMode,
  registerShiftGeoTapHandler,
} from '@/lib/shiftGeoWatcher';

export function useShiftGeoWatcher(): void {
  const { session: serverSession } = useShift();
  const serverActive = serverSession != null;

  useEffect(() => {
    registerShiftGeoTapHandler();
  }, []);

  useEffect(() => {
    const sync = () => {
      const active = serverActive || isShiftActive();
      // No shift: idle mode keeps a low-frequency foreground service alive
      // for the whole app session (cold-start prevention), not stopped —
      // see docs/superpowers/specs/2026-09-20-idle-foreground-service-design.md.
      void ensureWatcherMode(active ? 'shift' : 'idle');
    };

    sync();
    window.addEventListener('delivroom:shift-changed', sync);
    return () => window.removeEventListener('delivroom:shift-changed', sync);
  }, [serverActive]);
}
