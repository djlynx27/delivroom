import { ArrivalCountdown } from '@/components/ArrivalCountdown';
import { CitySelect } from '@/components/CitySelect';
import {
  AddressSearchBox,
  type AddressSearchResult,
} from '@/components/drive/AddressSearchBox';
import { AntiDeadheadCard } from '@/components/drive/AntiDeadheadCard';
import { MarketRadarSheet } from '@/components/drive/MarketRadarSheet';
import { DeadTimeTimer } from '@/components/DeadTimeTimer';
import { DemandBadge } from '@/components/DemandBadge';
import { DrivingHUD } from '@/components/DrivingHUD';
import { EventBoostBadge } from '@/components/EventBoostBadge';
import { WazeIcon } from '@/components/NavIcons';
import { CustomNavigationMap } from '@/components/CustomNavigationMap';
import {
  buildGoogleMapsProspectingUrl,
  buildOneTapNavigationUrl,
  type RouteCandidateZone,
  type RoutePoint,
} from '@/services/routing';
import { PlatformArbitrage } from '@/components/PlatformArbitrage';
import { PlatformSwitchBanner } from '@/components/PlatformSwitchBanner';
import { QuickDecideWidget } from '@/components/QuickDecideWidget';
import { ShiftTally } from '@/components/ShiftTally';
import { ScoreFactorIcons } from '@/components/ScoreFactorIcons';
import { SurgeIndicator } from '@/components/SurgeIndicator';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WeeklyGoalDisplay } from '@/components/WeeklyGoal';
import { useI18n } from '@/contexts/I18nContext';
import { useActivityDetection } from '@/hooks/useActivityDetection';
import {
  useAntiDeadhead,
  type AntiDeadheadSuggestion,
} from '@/hooks/useAntiDeadhead';
import { useArrivalCountdown } from '@/hooks/useArrivalCountdown';
import { nearestCityId, useAutoCity } from '@/hooks/useAutoCity';
import { useCityId } from '@/hooks/useCityId';
import { useDemandScores } from '@/hooks/useDemandScores';
import { useGasBoard } from '@/hooks/useGasBoard';
import { useHaptics } from '@/hooks/useHaptics';
import { findNearestZone } from '@/hooks/useNotifications';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useCities } from '@/hooks/useSupabase';
import { useTrips } from '@/hooks/useTrips';
import { haversineKm, useUserLocation } from '@/hooks/useUserLocation';
import { getDemandClass } from '@/lib/demandUtils';
import {
  getConservativePresencePreference,
  getDriverFingerprint,
  getStoredDriverMode,
  setConservativePresencePreference,
  setStoredDriverMode,
} from '@/lib/driverPreferences';
import { openWazeNav } from '@/lib/hotspots';
import {
  applySaturationDegradation,
  computeSaturationFactor,
  useNearbyDrivers,
} from '@/lib/realtime';
import {
  getReturnCorridor,
  reweightZonesByDriverMode,
  type DemandWindow,
  type ReturnCorridorResult,
  type ReturnCorridorStep,
} from '@/lib/scoringEngine';
import type { SurgeResult } from '@/lib/surgeEngine';
import { getMontrealDayStart } from '@/lib/timezone';
import { summarizeTrips } from '@/lib/tripAnalytics';
import { Car, Crosshair, Maximize2, Minimize2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

interface WakeLockNavigator extends Navigator {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinel>;
  };
}

type WakeLockStatus = 'active' | 'inactive' | 'unsupported';

function hasActiveSurge(surge: SurgeResult | null | undefined): surge is SurgeResult {
  return !!surge && surge.surgeClass !== 'normal';
}

function getHeroCardGlowClass(surge: SurgeResult | null | undefined): string {
  if (!hasActiveSurge(surge)) return '';
  return surge.surgeClass === 'high' || surge.surgeClass === 'peak'
    ? 'animate-pulse-glow'
    : '';
}

/** True when a return corridor is active toward this exact zone (anti-deadhead target). */
function corridorTargetsZone(
  zoneId: string,
  antiDeadhead: AntiDeadheadSuggestion | null,
  returnCorridor: ReturnCorridorResult | null
): boolean {
  return (
    !!returnCorridor?.active &&
    !!antiDeadhead &&
    zoneId === antiDeadhead.zone.id
  );
}

function resolveOneTapUrl(
  origin: RoutePoint | null,
  zone: RouteCandidateZone,
  modeZones: RouteCandidateZone[],
  antiDeadhead: AntiDeadheadSuggestion | null,
  returnCorridor: ReturnCorridorResult | null
): string {
  if (origin && corridorTargetsZone(zone.id, antiDeadhead, returnCorridor)) {
    return buildGoogleMapsProspectingUrl(origin, zone, returnCorridor!.steps);
  }
  return buildOneTapNavigationUrl(origin, zone, modeZones);
}

function resolveHudReturnCorridor(
  heroZoneId: string | undefined,
  antiDeadhead: AntiDeadheadSuggestion | null,
  returnCorridor: ReturnCorridorResult | null
): { steps: ReturnCorridorStep[] } | null {
  if (!heroZoneId || !corridorTargetsZone(heroZoneId, antiDeadhead, returnCorridor)) {
    return null;
  }
  return { steps: returnCorridor!.steps };
}

export default function DriveScreen() {
  usePullToRefresh(() => window.location.reload());
  // Driver mode (rideshare/delivery/all) — shared with TodayScreen
  const [driverMode, setDriverModeState] = useState<
    'rideshare' | 'delivery' | 'all'
  >(() => getStoredDriverMode());
  const setDriverMode = (mode: 'rideshare' | 'delivery' | 'all') => {
    setDriverModeState(mode);
    setStoredDriverMode(mode);
  };

  // "Je suis libre" mode — shared with TodayScreen
  const [libreMode, setLibreMode] = useState(false);
  const { t } = useI18n();
  const [cityId, setCityId] = useCityId();
  const { data: cities = [] } = useCities();
  const { location, status, error, refresh } = useUserLocation(15000);
  const [cityRefreshKey, setCityRefreshKey] = useState(0);
  useAutoCity(
    cityId,
    setCityId,
    location?.latitude,
    location?.longitude,
    cityRefreshKey
  );

  // Rafraîchit la ville toutes les 2 minutes automatiquement
  useEffect(() => {
    const interval = setInterval(
      () => {
        setCityRefreshKey((k) => k + 1);
      },
      2 * 60 * 1000
    );
    return () => clearInterval(interval);
  }, []);
  const [conservativePresence, setConservativePresence] = useState(() =>
    getConservativePresencePreference()
  );
  const [demandWindow, setDemandWindow] = useState<DemandWindow>('30m');
  const {
    scores,
    factors,
    zones,
    isLoading: scoresLoading,
    surgeMap,
    zoneEventBadge,
    lyftSignalByZone,
  } = useDemandScores(cityId, {
    currentLat: location?.latitude ?? null,
    currentLng: location?.longitude ?? null,
    conservativePresence,
    demandWindow,
  });
  const { board: gasBoard } = useGasBoard(
    'regular',
    location ? { latitude: location.latitude, longitude: location.longitude } : null,
    new Date()
  );
  const bestGasStation =
    gasBoard?.slots.find((s) => s.kind === 'nearest-cheapest')?.station ?? null;
  const [fullScreen, setFullScreen] = useState(false);
  const [navZone, setNavZone] = useState<RouteCandidateZone | null>(null);

  // Speed-based activity detection → auto-HUD.
  // hudActive defaults to true so the driver lands directly in driving mode
  // when the app opens. They can dismiss it if they're sitting at home doing
  // admin work; the dismissed state is local to this session and not
  // persisted — every fresh app launch shows the HUD again, which is what
  // the user asked for.
  const { isInVehicle, speedKmh } = useActivityDetection();
  const [hudActive, setHudActive] = useState(true);
  const [hudDismissedManually, setHudDismissedManually] = useState(false);
  const [isRefreshingLocation, setIsRefreshingLocation] = useState(false);
  const { vibrate } = useHaptics();
  const [wakeLockStatus, setWakeLockStatus] = useState<WakeLockStatus>(() => {
    const nav = navigator as WakeLockNavigator;
    return nav.wakeLock ? 'inactive' : 'unsupported';
  });

  // Auto-enable HUD when vehicle motion is confidently detected
  useEffect(() => {
    if (isInVehicle && !hudActive && !hudDismissedManually) {
      setHudActive(true);
      vibrate('newOrder'); // alert driver that HUD is now active
    }
  }, [hudActive, hudDismissedManually, isInVehicle, vibrate]);

  useEffect(() => {
    if (!isInVehicle && hudDismissedManually) {
      setHudDismissedManually(false);
    }
  }, [hudDismissedManually, isInVehicle]);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;

    function releaseWakeLock() {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
      setWakeLockStatus('inactive');
    }

    async function requestWakeLock() {
      const nav = navigator as WakeLockNavigator;
      if (!nav.wakeLock) {
        setWakeLockStatus('unsupported');
        return;
      }
      try {
        const wl = await nav.wakeLock.request('screen');
        if (cancelled) {
          wl.release();
          return;
        }
        wakeLockRef.current = wl;
        setWakeLockStatus('active');
        wl.addEventListener('release', () => {
          if (wakeLockRef.current === wl) {
            wakeLockRef.current = null;
            setWakeLockStatus('inactive');
          }
        });
      } catch {
        setWakeLockStatus('inactive');
      }
    }

    if (document.visibilityState === 'visible') requestWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') requestWakeLock();
      else releaseWakeLock();
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      releaseWakeLock();
    };
  }, []);

  const wakeLockBadge =
    wakeLockStatus === 'active'
      ? {
          className: 'bg-primary/20 text-primary',
          label: t('screenActive'),
        }
      : wakeLockStatus === 'unsupported'
        ? {
            className: 'bg-muted text-muted-foreground',
            label: t('screenUnsupported'),
          }
        : {
            className: 'bg-amber-500/15 text-amber-300',
            label: t('screenInactive'),
          };

  // Ranked zones by score descending
  // Market Radar: crowdsourced nearby-driver density (Supabase Realtime
  // Presence) degrades a zone's ranked score slightly once it's saturated,
  // rather than hiding it -- still worth knowing about, just less of a sure
  // thing with 8 other drivers already circling it.
  const driverFingerprint = useMemo(() => getDriverFingerprint(), []);
  const zonesForPresence = useMemo(
    () => zones.map((z) => ({ ...z, score: scores.get(z.id) ?? z.current_score ?? 50 })),
    [zones, scores]
  );
  const { driversByZone, saturatedZoneIds } = useNearbyDrivers(
    cityId,
    location,
    zonesForPresence,
    driverFingerprint
  );

  const rankedZones = useMemo(() => {
    return zones
      .map((z) => {
        const score = scores.get(z.id) ?? 0;
        return {
          ...z,
          score: saturatedZoneIds.has(z.id)
            ? applySaturationDegradation(
                score,
                computeSaturationFactor(driversByZone.get(z.id) ?? 0, score)
              )
            : score,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [zones, scores, saturatedZoneIds, driversByZone]);

  const marketRadarZones = useMemo(
    () =>
      rankedZones.slice(0, 10).map((zone) => ({
        id: zone.id,
        name: zone.name,
        estimatedWaitMin: lyftSignalByZone.get(zone.id)?.estimatedWaitMin ?? null,
        driverCount: driversByZone.get(zone.id) ?? 0,
        isSaturated: saturatedZoneIds.has(zone.id),
      })),
    [rankedZones, lyftSignalByZone, driversByZone, saturatedZoneIds]
  );

  // Reweight scores based on driver objective (rideshare vs delivery favor
  // different zone types) — see scoringEngine.reweightZonesByDriverMode
  const modeZones = useMemo(
    () => reweightZonesByDriverMode(rankedZones, driverMode),
    [rankedZones, driverMode]
  );

  // Exclude airport from hero zone, but allow in next recommendations
  const heroZone = modeZones.find((z) => z.type !== 'aéroport') ?? null;
  // Next zones: include airport if present, but never as hero
  const nextZones = modeZones
    .filter((z) => !heroZone || z.id !== heroZone.id)
    .slice(0, 6);
  const heroEventBadge = heroZone ? zoneEventBadge.get(heroZone.id) : undefined;

  // Anti-deadhead: is the driver currently parked in a low-score zone
  // (e.g. just dropped off out in the sticks)? If so, suggest the best
  // reachable zone and, when it's far enough away, break the trip into a
  // return corridor instead of one long deadhead leg (getReturnCorridor).
  const currentZone = useMemo(
    () => (location ? findNearestZone(location.latitude, location.longitude, modeZones) : null),
    [location, modeZones]
  );
  const antiDeadhead = useAntiDeadhead({
    currentLat: location?.latitude ?? null,
    currentLng: location?.longitude ?? null,
    currentZoneId: currentZone?.id ?? null,
    zones: modeZones,
    scores,
    driverMode,
    conservativePresence,
  });
  const returnCorridor = useMemo(() => {
    if (!antiDeadhead || !location) return null;
    return getReturnCorridor(
      { lat: location.latitude, lng: location.longitude },
      { lat: antiDeadhead.zone.latitude, lng: antiDeadhead.zone.longitude },
      modeZones
    );
  }, [antiDeadhead, location, modeZones]);

  // Zero-friction 1-tap navigation: no in-app Mapbox view, no confirmation --
  // straight to the Google Maps app with the prospection waypoints baked in.
  // Used by the hero "Naviguer" button, the Driving HUD tiles, and the
  // 15-minute arrival auto-routing below, so the recommended-destination
  // flow never opens CustomNavigationMap.
  const navigateOneTap = useCallback(
    (zone: RouteCandidateZone) => {
      const origin = location
        ? { lat: location.latitude, lng: location.longitude }
        : null;
      window.location.href = resolveOneTapUrl(
        origin,
        zone,
        modeZones,
        antiDeadhead,
        returnCorridor
      );
    },
    [location, modeZones, returnCorridor, antiDeadhead]
  );

  // Address search: the picked address/POI becomes the active nav target
  // and fires the same 1-tap Google Maps handoff as the hero recommendation
  // — history-saving is handled inside AddressSearchBox itself. score: 0
  // since a manually searched address was never demand-scored.
  const handleAddressSelect = (result: AddressSearchResult) => {
    navigateOneTap({ ...result, score: 0 });
  };

  // 15-minute auto-routing: when driver arrives at heroZone, countdown then
  // auto-navigate to nextZones[0] in Google Maps.
  const {
    isCountingDown,
    arrivedZoneName,
    secondsRemaining,
    cancel,
    launchNow,
  } = useArrivalCountdown(heroZone, location, () => {
    const next = nextZones[0];
    if (next) navigateOneTap(next);
  });

  const getDistance = (
    zone: { latitude: number; longitude: number } | null
  ) => {
    if (!location || !zone) return null;
    return haversineKm(
      location.latitude,
      location.longitude,
      zone.latitude,
      zone.longitude
    );
  };

  const heroDistance = getDistance(heroZone);
  const heroSurge = heroZone ? surgeMap?.get(heroZone.id) : null;

  // Real earnings so far today for the HUD's "Gains" tile — falls back to 0
  // while trips are still loading or there simply are none yet, never NaN.
  const { data: todayTrips, isLoading: tripsLoading } = useTrips(200);
  const todayEarnings = useMemo(() => {
    if (tripsLoading || !todayTrips) return 0;
    return summarizeTrips(todayTrips, getMontrealDayStart()).revenue;
  }, [todayTrips, tripsLoading]);

  const gpsLabel =
    status === 'loading'
      ? t('gettingLocation')
      : status === 'error'
        ? t('locationUnavailable')
        : location
          ? `GPS: lat ${location.latitude.toFixed(4)}, lng ${location.longitude.toFixed(4)}`
          : t('gettingLocation');

  const speedLabel =
    location?.speed != null
      ? ` · spd ${Math.round(location.speed * 3.6)} km/h`
      : '';

  const accuracyLabel =
    location?.accuracy != null
      ? ` · precision ±${Math.round(location.accuracy)} m`
      : '';

  async function handleManualLocate() {
    setIsRefreshingLocation(true);
    try {
      const nextLocation = await refresh();
      if (!nextLocation) {
        toast.error(error ?? 'Le GPS ne repond pas pour le moment.');
        return;
      }
      setCityRefreshKey((k) => k + 1); // force la détection de ville
      const detectedCityId = nearestCityId(
        nextLocation.latitude,
        nextLocation.longitude
      );
      if (detectedCityId !== cityId) {
        setCityId(detectedCityId);
      }
      const detectedCityName =
        cities.find((city) => city.id === detectedCityId)?.name ??
        detectedCityId;
      toast.success(`Position recalee sur ${detectedCityName}.`);
    } catch (manualError) {
      const message =
        manualError instanceof Error
          ? manualError.message
          : 'Impossible d obtenir une position GPS precise.';
      toast.error(message);
    } finally {
      setIsRefreshingLocation(false);
    }
  }

  return (
    <div
      className="flex flex-col h-full pb-36 bg-background text-foreground overflow-y-auto"
      data-mode={driverMode}
    >
      {/* Address search — floating overlay, sticks above the hero card while
          scrolling. 1-tap: picking a result goes straight to Google Maps,
          same as the recommended-zone flow, no in-app map detour. */}
      <div className="sticky top-0 z-20 px-4 pt-2 pb-3 bg-gradient-to-b from-background via-background/95 to-transparent">
        <AddressSearchBox onSelect={handleAddressSelect} />
      </div>

      {/* Shift tally — running $/h based on actual fares logged today */}
      <div className="px-4 mt-2">
        <ShiftTally />
      </div>

      {/* Quick-decide widget — the headline tool for hands-busy drivers.
          Sits near the top so it's reachable with a thumb without
          scrolling. */}
      <div className="px-4 mt-2">
        <QuickDecideWidget />
      </div>

      {/* Multi-platform online tracker + switch suggestions */}
      <div className="px-4 mt-2">
        <PlatformSwitchBanner driverMode={driverMode} />
      </div>

      {/* Mode filter tabs — colour-coded per compass doc (blue=rideshare, amber=delivery) */}
      <div className="px-4 mt-2">
        <div className="flex rounded-xl border border-border bg-muted/30 p-1 gap-1">
          {(
            [
              {
                key: 'all',
                label: '🌐 Les deux',
                activeClass: 'bg-primary text-primary-foreground',
              },
              {
                key: 'rideshare',
                label: '🚗 Personnes',
                activeClass: 'bg-rideshare text-white',
              },
              {
                key: 'delivery',
                label: '📦 Livraison',
                activeClass: 'bg-delivery text-white',
              },
            ] as const
          ).map(({ key, label, activeClass }) => (
            <button
              key={key}
              onClick={() => {
                setDriverMode(key);
                vibrate('navigation');
              }}
              className={`flex-1 text-[13px] font-display font-semibold py-3 min-h-11 rounded-lg transition-colors ${
                driverMode === key
                  ? `${activeClass} shadow-sm`
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 mt-2">
        <button
          onClick={() => {
            const nextValue = !conservativePresence;
            setConservativePresence(nextValue);
            setConservativePresencePreference(nextValue);
          }}
          className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
            conservativePresence
              ? 'border-primary/40 bg-primary/10'
              : 'border-border bg-card'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-display font-bold">
                Présence prudente Lyft
              </p>
              <p className="text-[12px] text-muted-foreground font-body mt-1">
                Reste en ligne sur Lyft et vise une course compatible avec un
                filtre destination, au lieu d'aller chasser une autre zone.
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                conservativePresence
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {conservativePresence ? 'ACTIF' : 'INACTIF'}
            </span>
          </div>
        </button>
      </div>

      {/* Statut chauffeur : Occupé / Libre */}
      <div className="px-4 mt-2">
        <button
          onClick={() => {
            const nextLibreMode = !libreMode;

            if (nextLibreMode && heroZone) {
              navigateOneTap(heroZone);
            }

            setLibreMode(nextLibreMode);
          }}
          className={`w-full h-11 rounded-xl text-[14px] font-display font-bold border transition-colors flex items-center justify-center gap-2 ${
            libreMode
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="inline-block">
            <Car className="w-4 h-4" />
          </span>
          {libreMode
            ? conservativePresence
              ? '🟢 Je suis libre – Où rester visible ?'
              : '🟢 Je suis libre – Où aller ?'
            : '🔴 Occupé (course en cours)'}
        </button>
      </div>
      {/* ── NHTSA Driving HUD overlay ── */}
      {hudActive && (
        <DrivingHUD
          heroZone={
            heroZone
              ? {
                  id: heroZone.id,
                  name: heroZone.name,
                  score: heroZone.score,
                  latitude: heroZone.latitude,
                  longitude: heroZone.longitude,
                  distKm: heroDistance ?? undefined,
                  eventBadge: heroEventBadge
                    ? { name: heroEventBadge.name, endAt: heroEventBadge.end_at }
                    : null,
                }
              : null
          }
          nextZone={
            nextZones[0]
              ? {
                  id: nextZones[0].id,
                  name: nextZones[0].name,
                  score: nextZones[0].score,
                  latitude: nextZones[0].latitude,
                  longitude: nextZones[0].longitude,
                }
              : null
          }
          heroSurge={heroSurge}
          earningsToday={todayEarnings}
          speedKmh={speedKmh}
          returnCorridor={resolveHudReturnCorridor(
            heroZone?.id,
            antiDeadhead,
            returnCorridor
          )}
          onNavigate={navigateOneTap}
          onExit={() => {
            setHudDismissedManually(true);
            setHudActive(false);
          }}
        />
      )}
      {/* Header */}
      {!fullScreen && (
        <div className="px-4 pt-3 pb-2 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] font-display font-bold flex items-center gap-2">
              🚗 {t('driveMode')}
              <span
                className={`text-[13px] rounded-full px-2 py-0.5 font-body ${wakeLockBadge.className}`}
              >
                🔒 {wakeLockBadge.label}
              </span>
            </h1>
          </div>
          <div className="max-w-[130px] flex-shrink-0">
            <CitySelect cities={cities} value={cityId} onChange={setCityId} />
          </div>
        </div>
      )}

      {/* Dead time + weekly goal */}
      {!fullScreen && (
        <div className="px-4 space-y-2 mb-2">
          <DeadTimeTimer nearestZoneName={heroZone?.name} libreMode={libreMode} />
          <WeeklyGoalDisplay />
        </div>
      )}

      {/* Hero zone card */}
      <div
        className={`px-4 ${fullScreen ? 'flex-1 flex items-center justify-center pt-6' : ''}`}
      >
        <div
          className={`w-full bg-card rounded-3xl border border-border px-5 py-6 space-y-4 shadow-lg transition-shadow ${fullScreen ? 'max-w-md' : ''} ${getHeroCardGlowClass(heroSurge)}`}
        >
          <p className="text-[13px] font-body uppercase tracking-wide text-muted-foreground text-center">
            {t('bestZoneNow')}
          </p>

          {heroZone ? (
            <>
              <div className="flex flex-col items-center text-center space-y-1">
                <h1
                  className={`font-display font-bold leading-tight break-words ${fullScreen ? 'text-[40px]' : 'text-[32px]'}`}
                >
                  {heroZone.name}
                </h1>
                <p className="text-[16px] text-muted-foreground capitalize">
                  {heroZone.type}
                  <ScoreFactorIcons factors={factors.get(heroZone.id)} />
                </p>
                {heroDistance !== null && (
                  <p className="text-[20px] font-display font-semibold text-muted-foreground">
                    📍 {heroDistance.toFixed(1)} km
                  </p>
                )}
                {heroEventBadge && (
                  <EventBoostBadge
                    name={heroEventBadge.name}
                    endAt={heroEventBadge.end_at}
                  />
                )}
              </div>

              <div className="flex justify-center items-center gap-3">
                <DemandBadge score={heroZone.score} size="giant" />
                {hasActiveSurge(heroSurge) && (
                  <SurgeIndicator
                    surgeClass={heroSurge.surgeClass}
                    multiplier={heroSurge.surgeMultiplier}
                    size="lg"
                    showMultiplier
                  />
                )}
              </div>

              <div className="space-y-2 pt-2">
                <Button
                  onClick={() => navigateOneTap(heroZone)}
                  className="w-full h-16 text-[18px] font-display font-bold gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Car className="w-6 h-6 flex-shrink-0" /> Naviguer
                </Button>
                <Button
                  onClick={() => openWazeNav(heroZone.name, heroZone.latitude, heroZone.longitude)}
                  variant="secondary"
                  className="w-full h-16 text-[18px] font-display font-bold gap-2"
                >
                  <WazeIcon className="w-6 h-6 flex-shrink-0" /> Waze
                </Button>
                {/* Platform arbitrage for hero zone */}
                <PlatformArbitrage
                  zoneId={heroZone.id}
                  zoneScore={heroZone.score}
                  compact={false}
                />
              </div>
            </>
          ) : scoresLoading ? (
            <div className="flex flex-col items-center space-y-3 py-2">
              <Skeleton className="h-9 w-48" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-20 w-20 rounded-full" />
            </div>
          ) : (
            <p className="text-[16px] text-muted-foreground font-body text-center">
              {t('noZonesAvailable')}
            </p>
          )}
        </div>
      </div>

      {/* Anti-deadhead: driver is parked in a low-score zone -- suggest a
          reposition, broken into a return corridor when the hub is far. */}
      {!fullScreen && antiDeadhead && (
        <div className="px-4 mt-3">
          <AntiDeadheadCard
            suggestion={antiDeadhead}
            corridor={returnCorridor}
            onNavigate={() => navigateOneTap(antiDeadhead.zone)}
          />
        </div>
      )}

      {/* Full-screen toggle + GPS row */}
      <div className="px-4 mt-3 space-y-2">
        <MarketRadarSheet
          zones={marketRadarZones}
          demandWindow={demandWindow}
          onDemandWindowChange={setDemandWindow}
          bestGasStation={bestGasStation}
        />

        <Button
          variant="outline"
          className="w-full h-12 gap-2 font-display font-bold"
          onClick={() => setFullScreen((v) => !v)}
        >
          {fullScreen ? (
            <Minimize2 className="w-5 h-5" />
          ) : (
            <Maximize2 className="w-5 h-5" />
          )}
          {fullScreen ? '↙ Réduire' : '🚀 Mode Plein Écran'}
        </Button>

        {/* Manual HUD toggle + speed readout */}
        <Button
          variant={hudActive ? 'default' : 'outline'}
          className="w-full h-12 gap-2 font-display font-bold"
          onClick={() => {
            if (hudActive) {
              setHudDismissedManually(true);
              setHudActive(false);
            } else {
              setHudDismissedManually(false);
              setHudActive(true);
            }
            vibrate('accepted');
          }}
        >
          <Car className="w-5 h-5" />
          {hudActive
            ? '✅ HUD actif — Appuie sur ✕ pour quitter'
            : `🚗 Mode HUD conduite${speedKmh !== null ? ` · ${Math.round(speedKmh ?? 0)} km/h` : ''}`}
        </Button>

        <div className="flex items-center gap-3 bg-card rounded-xl border border-border px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 flex-shrink-0 h-9"
            onClick={() => {
              void handleManualLocate();
            }}
            disabled={isRefreshingLocation}
          >
            <Crosshair className="w-4 h-4" />
            {isRefreshingLocation ? 'GPS…' : 'Localiser'}
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-body text-muted-foreground truncate">
              {location
                ? `GPS: lat ${location.latitude.toFixed(4)}, lng ${location.longitude.toFixed(4)}${speedLabel}${accuracyLabel}`
                : gpsLabel}
            </p>
            <p className="text-[11px] font-body text-muted-foreground/80 mt-1">
              Localiser force un nouveau fix GPS precis pour recaler la ville et
              les recommandations.
            </p>
          </div>
        </div>
      </div>

      {/* Zones suivantes */}
      {!fullScreen && nextZones.length > 0 && (
        <div className="px-4 mt-4 pb-4 space-y-2">
          <h3 className="text-[14px] font-display font-bold text-muted-foreground uppercase tracking-wide">
            {t('nextSlots')}
          </h3>
          {nextZones.map((zone, i) => {
            const dc = getDemandClass(zone.score);
            const dist = getDistance(zone);
            return (
              <div
                key={zone.id}
                onClick={() =>
                  setNavZone({
                    id: zone.id,
                    name: zone.name,
                    latitude: zone.latitude,
                    longitude: zone.longitude,
                    score: zone.score,
                  })
                }
                style={{ animationDelay: `${i * 40}ms` }}
                className={`flex items-center justify-between bg-card rounded-xl border-l-4 ${dc.border} border border-border px-4 py-3 gap-3 cursor-pointer active:scale-[0.98] transition-transform animate-slide-up`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[17px] font-display font-semibold block leading-tight break-words">
                    {zone.name}
                  </span>
                  <span className="text-[13px] text-muted-foreground font-body capitalize">
                    {zone.type}
                    {dist !== null && (
                      <span className="ml-2">· {dist.toFixed(1)} km</span>
                    )}
                    <ScoreFactorIcons factors={factors.get(zone.id)} />
                  </span>
                </div>
                <div className="flex-shrink-0">
                  <DemandBadge score={zone.score} size="lg" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {navZone && (
        <CustomNavigationMap
          destination={navZone}
          candidateZones={modeZones}
          onClose={() => setNavZone(null)}
        />
      )}

      {/* 15-min arrival countdown overlay */}
      {isCountingDown && arrivedZoneName && (
        <ArrivalCountdown
          arrivedZoneName={arrivedZoneName}
          nextZoneName={nextZones[0]?.name ?? null}
          secondsRemaining={secondsRemaining}
          onCancel={cancel}
          onLaunchNow={launchNow}
        />
      )}
    </div>
  );
}
