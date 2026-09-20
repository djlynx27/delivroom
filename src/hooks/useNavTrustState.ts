import { useEffect, useState } from 'react';

export type NavTrustState = 'confirming' | 'live' | 'offline';

// How long to wait for a live GPS fix + a live score fetch before assuming
// the driver is offline and unblocking NAVIGUER on cache alone. Below this,
// NAVIGUER stays blocked — see feedback_stale_cache_nav_risk memory: a
// driver must never be sent toward a zone computed from a stale cached fix
// without at least an explicit "this is cache, not confirmed" warning.
export const OFFLINE_GRACE_MS = 8_000;

export function computeNavTrustState(
  isLocationLive: boolean,
  hasLiveScores: boolean,
  offlineGraceElapsed: boolean
): NavTrustState {
  if (isLocationLive && hasLiveScores) return 'live';
  return offlineGraceElapsed ? 'offline' : 'confirming';
}

export function getNavTrustBadge(state: NavTrustState): string | null {
  switch (state) {
    case 'confirming':
      return 'Localisation / mise à jour en cours…';
    case 'offline':
      return 'Mode hors-ligne (cache local)';
    case 'live':
      return null;
  }
}

/** Whether NAVIGUER may fire: blocked only while still waiting on a first
 * live confirmation and the offline grace period hasn't elapsed yet. */
export function canNavigate(state: NavTrustState): boolean {
  return state !== 'confirming';
}

/**
 * Tracks whether the driver-facing NAVIGUER action can trust the current
 * hero zone: confirmed live data, or — after `OFFLINE_GRACE_MS` with no
 * live confirmation — an explicit offline fallback so the driver isn't
 * paralyzed by a dead network.
 */
export function useNavTrustState(
  isLocationLive: boolean,
  hasLiveScores: boolean
) {
  const [offlineGraceElapsed, setOfflineGraceElapsed] = useState(false);

  useEffect(() => {
    if (isLocationLive && hasLiveScores) return;
    const timer = setTimeout(
      () => setOfflineGraceElapsed(true),
      OFFLINE_GRACE_MS
    );
    return () => clearTimeout(timer);
  }, [isLocationLive, hasLiveScores]);

  const state = computeNavTrustState(
    isLocationLive,
    hasLiveScores,
    offlineGraceElapsed
  );

  return { state, canNavigate: canNavigate(state), badge: getNavTrustBadge(state) };
}
