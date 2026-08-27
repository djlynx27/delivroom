import { openGoogleMapsNav, openWazeNav } from '@/lib/hotspots';
import { logger } from '@/lib/logger';
import {
  getDriveRoute,
  type DriveRouteResult,
  type NavigationMode,
  type RouteCandidateZone,
} from '@/services/routing';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Marker, Source, type MapRef } from 'react-map-gl';
import type { UserLocationResult } from '@/hooks/useUserLocation';
import { X } from 'lucide-react';
import { GoogleMapsIcon, WazeIcon } from '@/components/NavIcons';
import { useUserLocation } from '@/hooks/useUserLocation';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

interface CustomNavigationMapProps {
  destination: RouteCandidateZone;
  candidateZones: RouteCandidateZone[];
  onClose: () => void;
}

function DriverPuck({ heading }: { heading: number | null | undefined }) {
  return (
    <div className="relative flex items-center justify-center">
      <span className="absolute w-9 h-9 rounded-full bg-blue-500/25 animate-ping" />
      <span
        style={{
          fontSize: '28px',
          lineHeight: 1,
          filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.9))',
          transform: `rotate(${heading ?? 0}deg)`,
        }}
        role="img"
        aria-label="Ma position"
      >
        🚗
      </span>
    </div>
  );
}

function WaypointPin({ zone, order }: { zone: RouteCandidateZone; order: number }) {
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-full bg-amber-500 text-black text-[11px] font-bold w-6 h-6 flex items-center justify-center border-2 border-white shadow-lg">
        {order}
      </div>
      <span className="mt-0.5 text-[10px] font-medium text-white bg-black/60 rounded px-1 max-w-[90px] truncate">
        {zone.name}
      </span>
    </div>
  );
}

/**
 * Locks the routing origin to the first GPS fix — recomputing on every
 * location tick would flicker the route and burn Directions API calls for
 * no benefit; the driver's live position is still shown by the puck.
 */
function useLockedOrigin(location: UserLocationResult['location']) {
  const originRef = useRef<{ lat: number; lng: number } | null>(null);
  if (!originRef.current && location) {
    originRef.current = { lat: location.latitude, lng: location.longitude };
  }
  return originRef.current;
}

function RouteMapLayers({
  routeGeojson,
  mode,
  location,
  destination,
  waypointsUsed,
}: {
  routeGeojson: GeoJSON.Feature | null;
  mode: NavigationMode;
  location: UserLocationResult['location'];
  destination: RouteCandidateZone;
  waypointsUsed: RouteCandidateZone[];
}) {
  return (
    <>
      {routeGeojson && (
        <Source id="drive-route" type="geojson" data={routeGeojson}>
          <Layer
            id="drive-route-line"
            type="line"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{
              'line-color': mode === 'prospection' ? '#f59e0b' : '#3b82f6',
              'line-width': 5,
            }}
          />
        </Source>
      )}

      {location && (
        <Marker longitude={location.longitude} latitude={location.latitude} anchor="center">
          <DriverPuck heading={location.heading} />
        </Marker>
      )}

      <Marker longitude={destination.longitude} latitude={destination.latitude} anchor="bottom">
        <span style={{ fontSize: '30px' }} role="img" aria-label="Destination">
          🏁
        </span>
      </Marker>

      {waypointsUsed.map((zone, i) => (
        <Marker key={zone.id} longitude={zone.longitude} latitude={zone.latitude} anchor="bottom">
          <WaypointPin zone={zone} order={i + 1} />
        </Marker>
      ))}
    </>
  );
}

function RouteOverlays({
  destination,
  route,
  mode,
  isLoadingRoute,
  routeError,
  locationStatus,
}: {
  destination: RouteCandidateZone;
  route: DriveRouteResult | null;
  mode: NavigationMode;
  isLoadingRoute: boolean;
  routeError: string | null;
  locationStatus: UserLocationResult['status'];
}) {
  return (
    <>
      {locationStatus === 'error' && <GpsUnavailableBanner />}
      {routeError && <RouteErrorBanner destination={destination} />}
      {route && !routeError && (
        <RouteInfoBar
          destination={destination}
          route={route}
          mode={mode}
          isLoading={isLoadingRoute}
        />
      )}
    </>
  );
}

function NavTopBar({
  mode,
  onModeChange,
  onClose,
}: {
  mode: NavigationMode;
  onModeChange: (mode: NavigationMode) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      <button
        onClick={onClose}
        className="rounded-full bg-black/60 backdrop-blur w-10 h-10 flex items-center justify-center text-white"
        aria-label="Fermer la navigation"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="flex rounded-full bg-black/60 backdrop-blur p-1 text-sm font-display font-bold">
        <button
          onClick={() => onModeChange('direct')}
          className={`px-4 py-1.5 rounded-full transition-colors ${mode === 'direct' ? 'bg-primary text-primary-foreground' : 'text-white/80'}`}
        >
          Trajet Direct
        </button>
        <button
          onClick={() => onModeChange('prospection')}
          className={`px-4 py-1.5 rounded-full transition-colors ${mode === 'prospection' ? 'bg-amber-500 text-black' : 'text-white/80'}`}
        >
          Prospection
        </button>
      </div>

      <div className="w-10" />
    </div>
  );
}

function GpsUnavailableBanner() {
  return (
    <div className="absolute top-[calc(env(safe-area-inset-top)+4.25rem)] left-3 right-3 z-10 rounded-lg bg-red-600/90 text-white text-[12px] px-3 py-2 text-center">
      GPS indisponible — impossible de calculer l'itinéraire.
    </div>
  );
}

function RouteErrorBanner({ destination }: { destination: RouteCandidateZone }) {
  return (
    <div className="absolute bottom-24 left-3 right-3 z-10 rounded-xl bg-red-600/90 backdrop-blur text-white text-[13px] px-4 py-3 flex items-center justify-between gap-3">
      <span>Itinéraire indisponible.</span>
      <button
        onClick={() =>
          openGoogleMapsNav(
            destination.name,
            destination.latitude,
            destination.longitude
          )
        }
        className="flex-shrink-0 rounded-lg bg-white text-black text-[12px] font-bold px-3 py-1.5"
      >
        Google Maps
      </button>
    </div>
  );
}

function RouteInfoBar({
  destination,
  route,
  mode,
  isLoading,
}: {
  destination: RouteCandidateZone;
  route: DriveRouteResult;
  mode: NavigationMode;
  isLoading: boolean;
}) {
  const waypointCount = route.waypointsUsed.length;
  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 bg-card border-t border-border px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <p className="text-[16px] font-display font-bold text-foreground truncate">
        {destination.name}
      </p>
      <p className="text-[14px] text-muted-foreground font-body">
        {route.distanceKm.toFixed(1)} km · {Math.round(route.durationMin)} min
        {mode === 'prospection' && waypointCount > 0 && (
          <span>
            {' '}
            · {waypointCount} zone{waypointCount > 1 ? 's' : ''} chaude
            {waypointCount > 1 ? 's' : ''}
          </span>
        )}
        {isLoading && <span> · Recalcul…</span>}
      </p>
    </div>
  );
}

export function CustomNavigationMap({
  destination,
  candidateZones,
  onClose,
}: CustomNavigationMapProps) {
  const mapRef = useRef<MapRef>(null);
  const { location, status: locationStatus } = useUserLocation();
  const origin = useLockedOrigin(location);

  const [mode, setMode] = useState<NavigationMode>('direct');
  const [route, setRoute] = useState<DriveRouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);

  useEffect(() => {
    if (!origin || !MAPBOX_TOKEN) return;
    const ctrl = new AbortController();
    setIsLoadingRoute(true);
    setRouteError(null);

    getDriveRoute(origin, destination, candidateZones, mode, {
      signal: ctrl.signal,
    })
      .then((result) => {
        if (ctrl.signal.aborted) return;
        setRoute(result);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : 'Itinéraire indisponible';
        logger.error('CustomNavigationMap route fetch failed', {
          mode,
          zoneId: destination.id,
          message,
        });
        setRouteError(message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setIsLoadingRoute(false);
      });

    return () => ctrl.abort();
  }, [origin, mode, destination, candidateZones]);

  // Follow mode: recenter + rotate to heading on every GPS update.
  useEffect(() => {
    if (!location || !mapRef.current) return;
    mapRef.current.easeTo({
      center: [location.longitude, location.latitude],
      bearing: location.heading ?? undefined,
      duration: 500,
    });
  }, [location]);

  const routeGeojson: GeoJSON.Feature | null = useMemo(() => {
    if (!route) return null;
    return { type: 'Feature', properties: {}, geometry: route.geometry };
  }, [route]);

  if (!MAPBOX_TOKEN) {
    return (
      <NavFallback
        title="Mapbox non configuré"
        message="VITE_MAPBOX_TOKEN manquant — utilise une app externe pour naviguer."
        destination={destination}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: origin?.lng ?? destination.longitude,
          latitude: origin?.lat ?? destination.latitude,
          zoom: 15,
          pitch: 45,
        }}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        reuseMaps
      >
        <RouteMapLayers
          routeGeojson={routeGeojson}
          mode={mode}
          location={location}
          destination={destination}
          waypointsUsed={route?.waypointsUsed ?? []}
        />
      </Map>

      <NavTopBar mode={mode} onModeChange={setMode} onClose={onClose} />

      <RouteOverlays
        destination={destination}
        route={route}
        mode={mode}
        isLoadingRoute={isLoadingRoute}
        routeError={routeError}
        locationStatus={locationStatus}
      />
    </div>
  );
}

function NavFallback({
  title,
  message,
  destination,
  onClose,
}: {
  title: string;
  message: string;
  destination: RouteCandidateZone;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
      <div>
        <h2 className="text-lg font-display font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{message}</p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          onClick={() =>
            openGoogleMapsNav(
              destination.name,
              destination.latitude,
              destination.longitude
            )
          }
          className="w-full gap-2.5 flex items-center justify-center text-[16px] font-display font-bold h-14 rounded-xl bg-primary text-primary-foreground"
        >
          <GoogleMapsIcon className="w-5 h-5 flex-shrink-0" /> Google Maps
        </button>
        <button
          onClick={() =>
            openWazeNav(
              destination.name,
              destination.latitude,
              destination.longitude
            )
          }
          className="w-full gap-2.5 flex items-center justify-center text-[16px] font-display font-bold h-14 rounded-xl bg-secondary text-secondary-foreground"
        >
          <WazeIcon className="w-5 h-5 flex-shrink-0" /> Waze
        </button>
        <button
          onClick={onClose}
          className="w-full h-12 rounded-xl border border-border text-muted-foreground font-display"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
