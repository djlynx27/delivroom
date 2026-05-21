import { useI18n } from '@/contexts/I18nContext';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Map, { Layer, Marker, Source, type MapRef } from 'react-map-gl';
import { LeafletMap } from './LeafletMap';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

function logMapGeolocationIssue(...args: unknown[]) {
  if (import.meta.env.DEV) {
    console.warn(...args);
  }
}

export interface HeatmapZone {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  demandScore?: number;
  learningBoostPoints?: number;
}

interface MapboxHeatmapProps {
  center: [number, number];
  zoom?: number;
  markers: HeatmapZone[];
  onZoneClick?: (zone: HeatmapZone) => void;
  className?: string;
  driverMode?: 'rideshare' | 'delivery' | 'all';
  driverPosition?: {
    latitude: number;
    longitude: number;
  } | null;
}

class MapErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('MapboxHeatmap crashed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground text-xs px-2 text-center">
          Carte temporairement indisponible
        </div>
      );
    }
    return this.props.children;
  }
}

function DriverDot() {
  return (
    <div className="relative flex items-center justify-center">
      <span className="absolute w-9 h-9 rounded-full bg-blue-500/20 animate-ping" />
      <span
        style={{
          fontSize: '26px',
          lineHeight: 1,
          filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.9))',
        }}
        role="img"
        aria-label="Ma position"
      >
        🚗
      </span>
    </div>
  );
}

const LS_POS_KEY = 'geohustle_last_pos';
function getCachedPos(): { lat: number; lng: number } | null {
  try {
    const raw = localStorage.getItem(LS_POS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function MapboxHeatmap({
  center,
  zoom = 11,
  markers,
  onZoneClick,
  className = '',
  driverMode = 'all',
  driverPosition = null,
}: MapboxHeatmapProps) {
  const { t } = useI18n();
  const mapRef = useRef<MapRef>(null);
  const [driverPos, setDriverPos] = useState<{
    lat: number;
    lng: number;
  } | null>(() => getCachedPos());
  const [locationError, setLocationError] = useState<string | null>(null);
  const hasAutoFocused = useRef(false);

  const applyPos = useCallback((lat: number, lng: number) => {
    const pos = { lat, lng };
    setDriverPos(pos);
    try {
      localStorage.setItem(LS_POS_KEY, JSON.stringify(pos));
    } catch {
      // localStorage unavailable; skip position persistence.
    }
    // Auto-fly to user position only on first fix
    if (!hasAutoFocused.current && mapRef.current) {
      hasAutoFocused.current = true;
      mapRef.current.flyTo({ center: [lng, lat], zoom: 14, duration: 800 });
    }
  }, []);

  useEffect(() => {
    if (!driverPosition) return;
    setLocationError(null);
    applyPos(driverPosition.latitude, driverPosition.longitude);
  }, [applyPos, driverPosition]);

  // GPS: immediate fix via Geolocation + continuous via watchPosition
  useEffect(() => {
    if (driverPosition) return;

    let watchId: string | number | null = null;

    const startWatching = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 6000,
          });
          applyPos(pos.coords.latitude, pos.coords.longitude);

          watchId = await Geolocation.watchPosition(
            { enableHighAccuracy: true, timeout: 10000 },
            (p, err) => {
              if (err) {
                logMapGeolocationIssue('Capacitor watch error:', err.message);
                setLocationError(err.message);
              } else if (p) {
                applyPos(p.coords.latitude, p.coords.longitude);
              }
            }
          );
        } catch (err: any) {
          logMapGeolocationIssue('Capacitor location error:', err.message);
        }
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => applyPos(pos.coords.latitude, pos.coords.longitude),
          () => {},
          { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
        );
        watchId = navigator.geolocation.watchPosition(
          (pos) => applyPos(pos.coords.latitude, pos.coords.longitude),
          (error) => {
            logMapGeolocationIssue('Web Geolocation watch error:', error.message);
            setLocationError(error.message);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
        );
      }
    };

    void startWatching();

    return () => {
      if (watchId !== null) {
        if (Capacitor.isNativePlatform()) {
          void Geolocation.clearWatch({ id: watchId as string });
        } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.clearWatch(watchId as number);
        }
      }
    };
  }, [applyPos, driverPosition]);

  // Fly to center on change
  const onLoad = useCallback(() => {
    mapRef.current?.flyTo({
      center: [center[1], center[0]],
      zoom,
      duration: 800,
    });
  }, [center, zoom]);

  useEffect(() => {
    mapRef.current?.flyTo({
      center: [center[1], center[0]],
      zoom,
      duration: 800,
    });
  }, [center, zoom]);

  // GeoJSON for heatmap
  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: markers.map((m) => ({
      type: 'Feature',
      properties: { intensity: (m.demandScore ?? 50) / 100 },
      geometry: { type: 'Point', coordinates: [m.longitude, m.latitude] },
    })),
  };

  if (!MAPBOX_TOKEN) {
    return (
      <div className={`w-full h-full ${className}`}>
        <div className="p-3 text-xs text-muted-foreground bg-muted border border-border rounded-lg text-center">
          Mapbox API key not configured (VITE_MAPBOX_TOKEN). Utilisation de
          Leaflet en secours.
        </div>
        <LeafletMap
          center={center}
          zoom={zoom}
          markers={markers.map((m) => ({
            id: m.id,
            name: m.name,
            type: m.type,
            latitude: m.latitude,
            longitude: m.longitude,
            demandScore: m.demandScore,
          }))}
          driverPosition={driverPos ?? undefined}
          className="mt-2 h-[calc(100%-2.125rem)]"
        />
      </div>
    );
  }

  const goToMyLocation = () => {
    if (!driverPos) return;
    mapRef.current?.flyTo({
      center: [driverPos.lng, driverPos.lat],
      zoom: 15,
      duration: 600,
    });
  };

  const getTypeStyle = (type: string) => {
    const t = type.toLowerCase();
    // In delivery mode: commercial (restaurant pickup) + résidentiel (drop-off) are priority
    if (driverMode === 'delivery') {
      if (t === 'commercial' || t === 'résidentiel')
        return {
          borderColor: '#facc15',
          backgroundColor: 'rgba(250,204,21,0.9)',
        };
      return {
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.45)',
      };
    }
    // In rideshare mode: nightlife, events, tourism, airport, commercial are priority
    if (driverMode === 'rideshare') {
      if (
        [
          'nightlife',
          'événements',
          'tourisme',
          'aéroport',
          'commercial',
          'transport',
          'université',
        ].includes(t)
      )
        return {
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.9)',
        };
      return {
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.45)',
      };
    }
    // All mode: color by category
    if (['nightlife', 'événements', 'tourisme', 'aéroport'].includes(t))
      return {
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.85)',
      }; // green = passenger hotspots
    if (['commercial', 'résidentiel'].includes(t))
      return {
        borderColor: '#facc15',
        backgroundColor: 'rgba(250,204,21,0.85)',
      }; // yellow = commercial/delivery
    return { borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.85)' }; // blue = transport/other
  };

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div className="absolute z-20 left-2 top-2 flex flex-col gap-1.5">
        <button
          onClick={goToMyLocation}
          disabled={!driverPos}
          title="Me localiser"
          className="rounded-full border border-white/30 bg-black/50 w-8 h-8 flex items-center justify-center text-sm backdrop-blur transition hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-40"
        >
          📍
        </button>
        <div className="rounded-md border border-white/15 bg-black/40 px-1.5 py-1 text-[10px] text-white/80 backdrop-blur flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: '#22c55e' }}
            />
            <span>Pass.</span>
          </div>
          <div className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: '#facc15' }}
            />
            <span>Livr.</span>
          </div>
          <div className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: '#60a5fa' }}
            />
            <span>Transp.</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full flex-shrink-0 border border-fuchsia-300 bg-fuchsia-500/80" />
            <span>IA+</span>
          </div>
        </div>
      </div>

      <MapErrorBoundary>
        {locationError && (
          <div className="absolute z-10 top-2 right-2 px-3 py-1 rounded-lg bg-red-600/90 text-white text-[11px]">
            ⚠ {t('locationPermissionTip')}
          </div>
        )}
        <Map
          ref={mapRef}
          initialViewState={{
            longitude: center[1],
            latitude: center[0],
            zoom,
          }}
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          style={{ width: '100%', height: '100%' }}
          onLoad={onLoad}
          attributionControl={false}
          reuseMaps
        >
          {/* Heatmap layer */}
          <Source id="zones-heat" type="geojson" data={geojson}>
            <Layer
              id="heatmap-layer"
              type="heatmap"
              paint={{
                'heatmap-weight': ['get', 'intensity'],
                'heatmap-intensity': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  8,
                  1,
                  15,
                  3,
                ],
                'heatmap-radius': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  8,
                  20,
                  15,
                  40,
                ],
                'heatmap-opacity': 0.7,
                'heatmap-color': [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0,
                  'rgba(0,0,0,0)',
                  0.2,
                  'hsl(220, 90%, 55%)',
                  0.4,
                  'hsl(190, 90%, 50%)',
                  0.6,
                  'hsl(55, 95%, 55%)',
                  0.8,
                  'hsl(30, 95%, 55%)',
                  1.0,
                  'hsl(0, 85%, 55%)',
                ],
              }}
            />
          </Source>

          {/* Zone circle markers */}
          {markers.map((m) => {
            const learningBoost = Math.max(
              0,
              Number(m.learningBoostPoints ?? 0)
            );
            const hasLearningBoost = learningBoost > 0;
            return (
              <Marker
                key={m.id}
                longitude={m.longitude}
                latitude={m.latitude}
                anchor="center"
              >
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onZoneClick?.(m);
                    }}
                    className="rounded-full border-2 shadow-md transition-transform hover:scale-125 focus:outline-none"
                    style={{
                      width: 18,
                      height: 18,
                      boxShadow: hasLearningBoost
                        ? '0 0 0 3px rgba(217, 70, 239, 0.45)'
                        : undefined,
                      ...getTypeStyle(m.type),
                    }}
                    aria-label={m.name}
                    title={
                      hasLearningBoost
                        ? `${m.name} · IA +${learningBoost}`
                        : m.name
                    }
                  />
                  {hasLearningBoost && (
                    <span className="absolute -top-2 -right-3 min-w-4 h-4 px-1 rounded-full border border-fuchsia-300 bg-fuchsia-500 text-white text-[9px] leading-4 text-center font-semibold shadow-sm">
                      +{learningBoost}
                    </span>
                  )}
                </div>
              </Marker>
            );
          })}

          {/* Driver pulsing blue dot */}
          {driverPos && (
            <Marker
              longitude={driverPos.lng}
              latitude={driverPos.lat}
              anchor="center"
            >
              <DriverDot />
            </Marker>
          )}
        </Map>
      </MapErrorBoundary>
    </div>
  );
}

export default MapboxHeatmap;
