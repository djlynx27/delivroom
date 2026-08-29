import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { forwardGeocode, guessCityIdFromText } from '@/lib/geocoding';
import { requestCurrentPreciseLocation } from '@/hooks/useUserLocation';
import { useZones } from '@/hooks/useSupabase';
import {
  handleNavigationLaunch,
  type NavigationMode,
  type RouteCandidateZone,
  type RoutePoint,
} from '@/services/routing';

// Deep-link landing page for external address capture (MacroDroid/Tasker
// reading the Lyft app / rideshare shortcuts) — see
// docs/navigate-deeplink-macrodroid.md. Reachable at /navigate and
// /app/launch-gps (same page, alias for external tools that expect that
// path). ?address=...&type=pickup|dropoff&mode=direct|prospection geocodes
// the address then hands off to Google Maps — `mode=direct` skips corridor
// waypoint injection entirely (pure origin→destination, for a rideshare app
// address where a detour would be wrong), `mode=prospection` (default, same
// as before this param existed) keeps the strategic-detour behavior.
// `type` never changes the routing math — only the loading label.

export default function NavigateScreen() {
  const [searchParams] = useSearchParams();
  const address = searchParams.get('address')?.trim() ?? '';
  const type = searchParams.get('type') === 'pickup' ? 'pickup' : 'dropoff';
  const mode: NavigationMode = searchParams.get('mode') === 'direct' ? 'direct' : 'prospection';

  const [error, setError] = useState<string | null>(null);
  const [cityId, setCityId] = useState('mtl');
  const [destination, setDestination] = useState<RouteCandidateZone | null>(null);
  const [origin, setOrigin] = useState<RoutePoint | null>(null);
  const [originResolved, setOriginResolved] = useState(false);

  // Direct mode never looks at candidate zones — skip the fetch entirely
  // (useZones disables its query on an empty cityId).
  const { data: zones, isLoading: zonesLoading } = useZones(mode === 'direct' ? '' : cityId);

  useEffect(() => {
    if (!address) {
      setError('Adresse manquante dans le lien (?address=...)');
      return;
    }
    let cancelled = false;
    forwardGeocode(address).then((result) => {
      if (cancelled) return;
      if (!result) {
        setError(`Adresse introuvable : ${address}`);
        return;
      }
      setCityId(guessCityIdFromText(result.matchedAddress) ?? 'mtl');
      setDestination({
        id: 'navigate-target',
        name: result.matchedAddress,
        latitude: result.latitude,
        longitude: result.longitude,
        score: 0,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    requestCurrentPreciseLocation()
      .then((loc) => {
        if (!cancelled) setOrigin({ lat: loc.latitude, lng: loc.longitude });
      })
      .catch(() => {
        // No GPS fix — buildOneTapNavigationUrl falls back to a plain
        // destination link when origin is null.
      })
      .finally(() => {
        if (!cancelled) setOriginResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!destination || !originResolved || zonesLoading) return;
    const candidates: RouteCandidateZone[] = (zones ?? []).map((z) => ({
      id: z.id,
      name: z.name,
      latitude: z.latitude,
      longitude: z.longitude,
      score: z.current_score ?? 0,
      type: z.type,
    }));
    window.location.href = handleNavigationLaunch(origin, destination, candidates, mode);
  }, [destination, origin, originResolved, zones, zonesLoading, mode]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background text-foreground px-6 text-center pt-[env(safe-area-inset-top)]">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background text-foreground pt-[env(safe-area-inset-top)]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">
        {type === 'pickup' ? 'Localisation du pickup…' : 'Calcul de la route…'}
      </p>
    </div>
  );
}
