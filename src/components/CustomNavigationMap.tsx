import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PitStopLayer } from '@/components/map/PitStopLayer';
import { hasFiniteCoordinates } from '@/lib/demandUtils';
import { useGasBoard } from '@/hooks/useGasBoard';
import type { GasBoard, RankedStation } from '@/lib/gasRanking';
import { openGoogleMapsNav, openWazeNav } from '@/lib/hotspots';
import { logger } from '@/lib/logger';
import { type PitStop } from '@/lib/pitStops';
import {
  buildGoogleMapsProspectingUrl,
  getDriveRoute,
  type DriveRouteResult,
  type NavigationMode,
  type RouteCandidateZone,
  type RoutePoint,
} from '@/services/routing';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Marker, Source, type MapRef } from 'react-map-gl';
import type { UserLocationResult } from '@/hooks/useUserLocation';
import { Compass, Navigation2, X } from 'lucide-react';
import { GoogleMapsIcon, WazeIcon } from '@/components/NavIcons';
import { useUserLocation } from '@/hooks/useUserLocation';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

// "Drive Navigation" camera: close and tilted like Google/Waze turn-by-turn,
// vs. a flat top-down overview when the driver toggles to north-up.
const FOLLOW_PITCH = 60;
const FOLLOW_ZOOM = 17.5;
const NORTH_UP_PITCH = 0;
const NORTH_UP_ZOOM = 15;

type OrientationMode = 'follow' | 'north-up';

interface CustomNavigationMapProps {
  destination: RouteCandidateZone;
  candidateZones: RouteCandidateZone[];
  onClose: () => void;
}

type RouteByMode = Partial<Record<NavigationMode, DriveRouteResult>>;

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
  if (!originRef.current && location && hasFiniteCoordinates(location)) {
    originRef.current = { lat: location.latitude, lng: location.longitude };
  }
  return originRef.current;
}

/**
 * True once we know the Directions API failed for the active mode and there's
 * no cached route to fall back on — the signal to draw a straight fallback
 * line instead of leaving the map blank.
 */
function shouldShowFallbackLine(
  routeError: string | null,
  activeRoute: DriveRouteResult | null,
  origin: { lat: number; lng: number } | null,
  destinationValid: boolean
): boolean {
  return !!routeError && !activeRoute && !!origin && destinationValid;
}

function findBestGasStation(gasBoard: GasBoard | null): RankedStation | null {
  return gasBoard?.slots.find((s) => s.kind === 'nearest-cheapest')?.station ?? null;
}

function RouteMapLayers({
  routeGeojson,
  mode,
  location,
  destination,
  waypointsUsed,
  isFallbackLine,
}: {
  routeGeojson: GeoJSON.Feature | null;
  mode: NavigationMode;
  location: UserLocationResult['location'];
  destination: RouteCandidateZone;
  waypointsUsed: RouteCandidateZone[];
  isFallbackLine: boolean;
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
              'line-width': isFallbackLine ? 4 : 5,
              ...(isFallbackLine ? { 'line-dasharray': [2, 2] } : {}),
            }}
          />
        </Source>
      )}

      {location && hasFiniteCoordinates(location) && (
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
  routes,
  mode,
  isLoadingRoute,
  routeError,
  locationStatus,
  showFallbackLine,
  origin,
}: {
  destination: RouteCandidateZone;
  routes: RouteByMode;
  mode: NavigationMode;
  isLoadingRoute: boolean;
  routeError: string | null;
  locationStatus: UserLocationResult['status'];
  showFallbackLine: boolean;
  origin: RoutePoint | null;
}) {
  const activeRoute = routes[mode];
  const otherMode: NavigationMode = mode === 'direct' ? 'prospection' : 'direct';
  return (
    <>
      {locationStatus === 'error' && <GpsUnavailableBanner />}
      {routeError && !activeRoute && (
        <RouteErrorBanner destination={destination} showFallbackLine={showFallbackLine} />
      )}
      {activeRoute && (
        <RouteInfoBar
          destination={destination}
          activeRoute={activeRoute}
          otherRoute={routes[otherMode] ?? null}
          mode={mode}
          isLoading={isLoadingRoute}
          origin={origin}
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

function OrientationToggle({
  mode,
  onToggle,
}: {
  mode: OrientationMode;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="absolute right-3 bottom-28 z-10 rounded-full bg-black/60 backdrop-blur w-11 h-11 flex items-center justify-center text-white"
      aria-label={
        mode === 'follow' ? 'Passer en vue Nord en haut' : 'Suivre la route (3D)'
      }
    >
      {mode === 'follow' ? (
        <Navigation2 className="w-5 h-5" />
      ) : (
        <Compass className="w-5 h-5" />
      )}
    </button>
  );
}

function PitStopToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`absolute right-3 bottom-44 z-10 rounded-full backdrop-blur w-11 h-11 flex items-center justify-center text-white ${
        visible ? 'bg-primary' : 'bg-black/60'
      }`}
      aria-label={visible ? 'Masquer les pit-stops' : 'Afficher les pit-stops'}
    >
      <span style={{ fontSize: '18px' }}>🚻</span>
    </button>
  );
}

function GpsUnavailableBanner() {
  return (
    <div className="absolute top-[calc(env(safe-area-inset-top)+4.25rem)] left-3 right-3 z-10 rounded-lg bg-red-600/90 text-white text-[12px] px-3 py-2 text-center">
      GPS indisponible — impossible de calculer l'itinéraire.
    </div>
  );
}

function RouteErrorBanner({
  destination,
  showFallbackLine,
}: {
  destination: RouteCandidateZone;
  showFallbackLine: boolean;
}) {
  return (
    <div className="absolute bottom-24 left-3 right-3 z-10 rounded-xl bg-red-600/90 backdrop-blur text-white text-[13px] px-4 py-3 flex items-center justify-between gap-3">
      <span>
        {showFallbackLine
          ? 'Calcul de route alternatif… ligne directe affichée en attendant.'
          : 'Itinéraire indisponible.'}
      </span>
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

function RouteComparisonLine({
  activeRoute,
  otherRoute,
}: {
  activeRoute: DriveRouteResult;
  otherRoute: DriveRouteResult;
}) {
  const deltaMin = Math.round(activeRoute.durationMin - otherRoute.durationMin);
  const deltaKm = activeRoute.distanceKm - otherRoute.distanceKm;
  return (
    <p className="text-[12px] text-amber-500 font-body mt-0.5">
      vs direct : {deltaMin >= 0 ? '+' : ''}
      {deltaMin} min · {deltaKm >= 0 ? '+' : ''}
      {deltaKm.toFixed(1)} km
    </p>
  );
}

function formatHotZonesLabel(mode: NavigationMode, waypointCount: number): string | null {
  if (mode !== 'prospection' || waypointCount === 0) return null;
  const plural = waypointCount > 1 ? 's' : '';
  return `${waypointCount} zone${plural} chaude${plural}`;
}

function resolveExportOrigin(
  mode: NavigationMode,
  waypointCount: number,
  origin: RoutePoint | null
): RoutePoint | null {
  if (mode !== 'prospection' || waypointCount === 0) return null;
  return origin;
}

function ExportProspectionButton({
  origin,
  destination,
  waypoints,
}: {
  origin: RoutePoint;
  destination: RouteCandidateZone;
  waypoints: RouteCandidateZone[];
}) {
  return (
    <button
      onClick={() =>
        window.open(buildGoogleMapsProspectingUrl(origin, destination, waypoints), '_system')
      }
      className="mt-3 w-full gap-2.5 flex items-center justify-center text-[15px] font-display font-bold h-12 rounded-xl bg-primary text-primary-foreground"
    >
      <GoogleMapsIcon className="w-5 h-5 flex-shrink-0" />
      Ouvrir dans Google Maps (Route optimisée)
    </button>
  );
}

function RouteInfoBar({
  destination,
  activeRoute,
  otherRoute,
  mode,
  isLoading,
  origin,
}: {
  destination: RouteCandidateZone;
  activeRoute: DriveRouteResult;
  otherRoute: DriveRouteResult | null;
  mode: NavigationMode;
  isLoading: boolean;
  origin: RoutePoint | null;
}) {
  const waypointCount = activeRoute.waypointsUsed.length;
  const hotZonesLabel = formatHotZonesLabel(mode, waypointCount);
  const exportOrigin = resolveExportOrigin(mode, waypointCount, origin);
  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 bg-card border-t border-border px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <p className="text-[16px] font-display font-bold text-foreground truncate">
        {destination.name}
      </p>
      <p className="text-[14px] text-muted-foreground font-body">
        {activeRoute.distanceKm.toFixed(1)} km · {Math.round(activeRoute.durationMin)} min
        {hotZonesLabel && <span> · {hotZonesLabel}</span>}
        {isLoading && <span> · Recalcul…</span>}
      </p>
      {mode === 'prospection' && otherRoute && (
        <RouteComparisonLine activeRoute={activeRoute} otherRoute={otherRoute} />
      )}
      {exportOrigin && (
        <ExportProspectionButton
          origin={exportOrigin}
          destination={destination}
          waypoints={activeRoute.waypointsUsed}
        />
      )}
    </div>
  );
}

function CustomNavigationMapInner({
  destination,
  candidateZones,
  onClose,
}: CustomNavigationMapProps) {
  const mapRef = useRef<MapRef>(null);
  const { location, status: locationStatus } = useUserLocation();
  const origin = useLockedOrigin(location);

  const [mode, setMode] = useState<NavigationMode>('direct');
  const [routes, setRoutes] = useState<RouteByMode>({});
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [orientationMode, setOrientationMode] = useState<OrientationMode>('follow');
  const [mapCrashed, setMapCrashed] = useState(false);
  const [showPitStops, setShowPitStops] = useState(false);

  // Pit-Stop layer: 24/7 restrooms (curated list) + best-priced nearby gas
  // (live, via the same board the Gas tab uses) — reused, not refetched.
  const { board: gasBoard } = useGasBoard('regular', location, new Date());
  const bestGasStation = findBestGasStation(gasBoard);

  function navigateViaPitStop(waypoint: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }) {
    if (!origin) return;
    window.location.href = buildGoogleMapsProspectingUrl(origin, destination, [
      { ...waypoint, score: 0 },
    ]);
  }

  function handleSelectRestroom(stop: PitStop) {
    navigateViaPitStop(stop);
  }

  function handleSelectGas(station: RankedStation) {
    navigateViaPitStop({
      id: station.key,
      name: station.name,
      latitude: station.lat,
      longitude: station.lng,
    });
  }

  const destinationValid = hasFiniteCoordinates(destination);
  const haveActiveRoute = !!routes[mode];

  // Primary fetch: the mode the driver is currently viewing. Cached per mode
  // so toggling Direct ⇄ Prospection is instant after the first computation
  // instead of re-hitting the Directions API and flickering the route.
  useEffect(() => {
    if (!origin || !MAPBOX_TOKEN || !destinationValid || haveActiveRoute) return;
    const ctrl = new AbortController();
    setIsLoadingRoute(true);
    setRouteError(null);

    getDriveRoute(origin, destination, candidateZones, mode, {
      signal: ctrl.signal,
    })
      .then((result) => {
        if (ctrl.signal.aborted) return;
        setRoutes((prev) => ({ ...prev, [mode]: result }));
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
  }, [origin, mode, destination, candidateZones, destinationValid, haveActiveRoute]);

  // Background fetch of the other mode, best-effort, so the info bar can show
  // a real Direct-vs-Prospection delta as soon as the driver opens the map —
  // failures here are silent, the primary mode above already handles errors.
  const otherMode: NavigationMode = mode === 'direct' ? 'prospection' : 'direct';
  const haveOtherRoute = !!routes[otherMode];
  useEffect(() => {
    if (!origin || !MAPBOX_TOKEN || !destinationValid || haveOtherRoute) return;
    const ctrl = new AbortController();
    getDriveRoute(origin, destination, candidateZones, otherMode, {
      signal: ctrl.signal,
    })
      .then((result) => {
        if (ctrl.signal.aborted) return;
        setRoutes((prev) => ({ ...prev, [otherMode]: result }));
      })
      .catch(() => {
        // Comparison data only — the visible mode's own fetch surfaces errors.
      });
    return () => ctrl.abort();
  }, [origin, otherMode, destination, candidateZones, destinationValid, haveOtherRoute]);

  // Follow mode: recenter + rotate to heading on every GPS update, tilted
  // in close like Google/Waze turn-by-turn. North-up mode recenters flat
  // with bearing locked to 0, for a classic overview instead.
  useEffect(() => {
    if (!location || !hasFiniteCoordinates(location) || !mapRef.current) return;
    const isFollow = orientationMode === 'follow';
    mapRef.current.easeTo({
      center: [location.longitude, location.latitude],
      bearing: isFollow ? location.heading ?? undefined : 0,
      pitch: isFollow ? FOLLOW_PITCH : NORTH_UP_PITCH,
      zoom: isFollow ? FOLLOW_ZOOM : NORTH_UP_ZOOM,
      duration: 500,
    });
  }, [location, orientationMode]);

  const activeRoute = routes[mode] ?? null;

  // Directions API down/rate-limited and no cached route for this mode: draw
  // a straight origin→destination line so the driver still sees a heading to
  // follow instead of a blank map with just an error banner.
  const showFallbackLine = shouldShowFallbackLine(
    routeError,
    activeRoute,
    origin,
    destinationValid
  );
  const routeGeojson: GeoJSON.Feature | null = useMemo(() => {
    if (activeRoute) {
      return { type: 'Feature', properties: {}, geometry: activeRoute.geometry };
    }
    if (showFallbackLine && origin) {
      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [origin.lng, origin.lat],
            [destination.longitude, destination.latitude],
          ],
        },
      };
    }
    return null;
  }, [activeRoute, showFallbackLine, origin, destination]);

  if (!destinationValid) {
    return (
      <NavFallback
        title="Coordonnées de zone invalides"
        message="Cette zone n'a pas de position GPS valide — impossible de calculer un itinéraire."
        destination={destination}
        onClose={onClose}
      />
    );
  }

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
      <ErrorBoundary
        fallback={<MapCanvasFallback destination={destination} onClose={onClose} />}
        onError={() => setMapCrashed(true)}
      >
        <Map
          ref={mapRef}
          initialViewState={{
            longitude: origin?.lng ?? destination.longitude,
            latitude: origin?.lat ?? destination.latitude,
            zoom: FOLLOW_ZOOM,
            pitch: FOLLOW_PITCH,
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
            waypointsUsed={activeRoute?.waypointsUsed ?? []}
            isFallbackLine={showFallbackLine}
          />
          <PitStopLayer
            visible={showPitStops}
            bestGasStation={bestGasStation}
            onSelectRestroom={handleSelectRestroom}
            onSelectGas={handleSelectGas}
          />
        </Map>
      </ErrorBoundary>

      {/* The Mapbox canvas crashing leaves nothing for these overlays to
          describe (no route line, no camera to orient) — MapCanvasFallback
          is a clean, self-contained recovery screen with its own close
          button instead of stale chrome piling on top of it. */}
      {!mapCrashed && (
        <>
          <NavTopBar mode={mode} onModeChange={setMode} onClose={onClose} />

          <OrientationToggle
            mode={orientationMode}
            onToggle={() =>
              setOrientationMode((prev) => (prev === 'follow' ? 'north-up' : 'follow'))
            }
          />

          <PitStopToggle
            visible={showPitStops}
            onToggle={() => setShowPitStops((v) => !v)}
          />

          <RouteOverlays
            destination={destination}
            routes={routes}
            mode={mode}
            isLoadingRoute={isLoadingRoute}
            routeError={routeError}
            locationStatus={locationStatus}
            showFallbackLine={showFallbackLine}
            origin={origin}
          />
        </>
      )}
    </div>
  );
}

export function CustomNavigationMap(props: CustomNavigationMapProps) {
  return (
    <ErrorBoundary
      fallback={
        <NavFallback
          title="Erreur de navigation"
          message="La carte a rencontré un problème inattendu — utilise une app externe pour cette course."
          destination={props.destination}
          onClose={props.onClose}
        />
      }
    >
      <CustomNavigationMapInner {...props} />
    </ErrorBoundary>
  );
}

/**
 * Shown when the Mapbox WebGL canvas itself throws (GPU context loss on some
 * Android devices, driver crash, etc.). The rest of the nav chrome (top bar,
 * route banners, orientation toggle) is hidden while this is up — see
 * `mapCrashed` in CustomNavigationMapInner — so this owns its own close
 * button and is the only thing on screen instead of stale overlays piling
 * on top of a dead canvas.
 */
function MapCanvasFallback({
  destination,
  onClose,
}: {
  destination: RouteCandidateZone;
  onClose: () => void;
}) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 px-6 text-center bg-background relative">
      <button
        onClick={onClose}
        className="absolute top-[calc(env(safe-area-inset-top)+0.75rem)] left-3 rounded-full bg-black/60 backdrop-blur w-10 h-10 flex items-center justify-center text-white"
        aria-label="Fermer la navigation"
      >
        <X className="w-5 h-5" />
      </button>
      <div>
        <h2 className="text-base font-display font-bold text-foreground">
          Carte indisponible
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          L'affichage de la carte a rencontré un problème sur cet appareil.
        </p>
      </div>
      {hasFiniteCoordinates(destination) && (
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <button
            onClick={() =>
              openGoogleMapsNav(
                destination.name,
                destination.latitude,
                destination.longitude
              )
            }
            className="w-full gap-2.5 flex items-center justify-center text-[15px] font-display font-bold h-12 rounded-xl bg-primary text-primary-foreground"
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
            className="w-full gap-2.5 flex items-center justify-center text-[15px] font-display font-bold h-12 rounded-xl bg-secondary text-secondary-foreground"
          >
            <WazeIcon className="w-5 h-5 flex-shrink-0" /> Waze
          </button>
        </div>
      )}
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
        {hasFiniteCoordinates(destination) && (
          <>
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
          </>
        )}
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
