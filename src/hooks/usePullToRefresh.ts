import { useEffect, useRef } from 'react';

/**
 * Hook: usePullToRefresh
 *
 * Adds pull-to-refresh gesture support for PWA/standalone apps.
 * Usage: Call usePullToRefresh(() => window.location.reload()) in your top-level screen.
 *
 * @param onRefresh Callback to trigger on pull-down gesture
 * @param thresholdPx Minimum pull distance to trigger refresh (default: 60)
 */
export function usePullToRefresh(onRefresh: () => void, thresholdPx = 60) {
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);

  useEffect(() => {
    // Only activate on touch devices
    if (!('ontouchstart' in window)) return;
    // Only activate in standalone/PWA mode
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone;
    if (!isStandalone) return;

    const el = document.scrollingElement || document.body;
    let lastY = 0;

    function onTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (touch && el.scrollTop === 0 && !pulling.current) {
        startY.current = touch.clientY;
        pulling.current = true;
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (!pulling.current || startY.current == null) return;
      const touch = e.touches[0];
      if (!touch) return;
      const deltaY = touch.clientY - startY.current;
      lastY = deltaY;
      // Optionally: show a visual indicator here
    }
    function onTouchEnd() {
      if (pulling.current && startY.current != null && lastY > thresholdPx) {
        onRefresh();
      }
      startY.current = null;
      pulling.current = false;
      lastY = 0;
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [onRefresh, thresholdPx]);
}
