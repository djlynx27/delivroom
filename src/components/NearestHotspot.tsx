import { GoogleMapsIcon } from '@/components/NavIcons';
import { useZones } from '@/hooks/useSupabase';
import { haversineKm, useUserLocation } from '@/hooks/useUserLocation';
import { useWeather } from '@/hooks/useWeather';
import { getDemandLevel } from '@/lib/demandUtils';
import { scoreAllZones, type WeatherCondition } from '@/lib/scoringEngine';
import { getGoogleMapsNavUrl } from '@/lib/hotspots';
import { useMemo } from 'react';

function getBorderClass(level: ReturnType<typeof getDemandLevel>) {
  if (level === 'high') return 'border-l-[hsl(var(--demand-high))]';
  if (level === 'medium') return 'border-l-[hsl(var(--demand-medium))]';
  return 'border-l-[hsl(var(--demand-low))]';
}

function buildWeatherCondition(
  weatherMtl:
    | {
        weatherId: number;
        temp: number;
        demandBoostPoints: number;
      }
    | null
    | undefined
): WeatherCondition | null {
  if (!weatherMtl) return null;

  return {
    weatherId: weatherMtl.weatherId,
    temp: weatherMtl.temp,
    demandBoostPoints: weatherMtl.demandBoostPoints,
  };
}

function findNearestHotspot(
  userLocation: { latitude: number; longitude: number } | null,
  allZones: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    score?: number | null;
  }>,
  weatherMtl:
    | {
        weatherId: number;
        temp: number;
        demandBoostPoints: number;
      }
    | null
    | undefined
) {
  if (!userLocation || allZones.length === 0) return null;

  const now = new Date();
  const { scores } = scoreAllZones(
    allZones,
    now,
    buildWeatherCondition(weatherMtl)
  );

  const ranked = allZones
    .map((zone) => ({
      ...zone,
      distance: haversineKm(
        userLocation.latitude,
        userLocation.longitude,
        zone.latitude,
        zone.longitude
      ),
      score: scores.get(zone.id) ?? 40,
    }))
    .sort((left, right) => left.distance - right.distance);

  return (
    ranked.find((zone) => zone.score >= 60 && zone.distance <= 10) ??
    ranked[0] ??
    null
  );
}

export function NearestHotspot() {
  const { location: userLocation } = useUserLocation(30000);

  const { data: zonesMtl = [] } = useZones('mtl');
  const { data: zonesLvl = [] } = useZones('lvl');
  const { data: zonesLng = [] } = useZones('lng');
  const { data: zonesBlv = [] } = useZones('blv');
  const { data: zonesRsm = [] } = useZones('rsm');
  const { data: zonesSth = [] } = useZones('sth');
  const { data: zonesBsb = [] } = useZones('bsb');
  const { data: zonesTrb = [] } = useZones('trb');
  const { data: zonesBdf = [] } = useZones('bdf');
  const { data: weatherMtl } = useWeather('mtl');

  const allZones = useMemo(
    () => [
      ...zonesMtl,
      ...zonesLvl,
      ...zonesLng,
      ...zonesBlv,
      ...zonesRsm,
      ...zonesSth,
      ...zonesBsb,
      ...zonesTrb,
      ...zonesBdf,
    ],
    [
      zonesMtl,
      zonesLvl,
      zonesLng,
      zonesBlv,
      zonesRsm,
      zonesSth,
      zonesBsb,
      zonesTrb,
      zonesBdf,
    ]
  );

  const nearest = useMemo(
    () => findNearestHotspot(userLocation, allZones, weatherMtl),
    [userLocation, allZones, weatherMtl]
  );

  if (!nearest) return null;

  const level = getDemandLevel(nearest.score);
  const borderClass = getBorderClass(level);
  const googleUrl = getGoogleMapsNavUrl(
    nearest.name,
    nearest.latitude,
    nearest.longitude
  );

  return (
    <div className="fixed bottom-[4.5rem] inset-x-0 z-30 px-2">
      <div
        className={`flex items-center gap-3 bg-card border border-border border-l-4 ${borderClass} rounded-xl h-[72px] px-4 shadow-lg shadow-background/50`}
      >
        <div className="flex-1 min-w-0">
          <span className="text-[16px] font-display font-bold block truncate">
            📍 {nearest.name}
          </span>
          <span className="text-[14px] text-muted-foreground font-body">
            {nearest.score}/100 · {nearest.distance.toFixed(1)} km
          </span>
        </div>
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 flex items-center justify-center gap-1.5 bg-primary text-primary-foreground font-display font-bold text-[14px] rounded-lg h-12 px-3 hover:bg-primary/90 transition-colors"
        >
          <GoogleMapsIcon className="w-5 h-5 flex-shrink-0" />
          GO
        </a>
      </div>
    </div>
  );
}
