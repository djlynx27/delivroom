/**
 * ShiftGeoWatcherMonitor — composant sans rendering qui active
 * useShiftGeoWatcher globalement (monté dans App.tsx, même pattern que
 * AutoShiftMonitor).
 */
import { useShiftGeoWatcher } from '@/hooks/useShiftGeoWatcher';

export function ShiftGeoWatcherMonitor() {
  useShiftGeoWatcher();
  return null;
}
