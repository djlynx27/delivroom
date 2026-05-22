import { ArrivalCountdown } from '@/components/ArrivalCountdown';
import { CitySelect } from '@/components/CitySelect';
import { DeadTimeTimer } from '@/components/DeadTimeTimer';
import { DemandBadge } from '@/components/DemandBadge';
import { DrivingHUD } from '@/components/DrivingHUD';
import { GoogleMapsIcon, WazeIcon } from '@/components/NavIcons';
import { NavigationSheet } from '@/components/NavigationSheet';
import { PlatformArbitrage } from '@/components/PlatformArbitrage';
import { PlatformSwitchBanner } from '@/components/PlatformSwitchBanner';
import { QuickDecideWidget } from '@/components/QuickDecideWidget';
import { ShiftTally } from '@/components/ShiftTally';
import { ScoreFactorIcons } from '@/components/ScoreFactorIcons';
import { SurgeIndicator } from '@/components/SurgeIndicator';
import { Button } from '@/components/ui/button';
import { WeeklyGoalDisplay } from '@/components/WeeklyGoal';
import { useI18n } from '@/contexts/I18nContext';
import { useActivityDetection } from '@/hooks/useActivityDetection';
import { useArrivalCountdown } from '@/hooks/useArrivalCountdown';
import { nearestCityId, useAutoCity } from '@/hooks/useAutoCity';
import { useCityId } from '@/hooks/useCityId';
import { useDemandScores } from '@/hooks/useDemandScores';
import { useHaptics } from '@/hooks/useHaptics';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useCities } from '@/hooks/useSupabase';
import { haversineKm, useUserLocation } from '@/hooks/useUserLocation';
import { getDemandClass } from '@/lib/demandUtils';
import {
  getConservativePresencePreference,
  getStoredDriverMode,
  setConservativePresencePreference,
  setStoredDriverMode,
} from '@/lib/driverPreferences';
import {
  openGoogleMapsNav,
  openWazeNav,
  launchGoogleMapsNavigation,
} from '@/lib/hotspots';
import { Car, Crosshair, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

interface WakeLockNavigator extends Navigator {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinel>;
  };
}

type WakeLockStatus = 'active' | 'inactive' | 'unsupported';

// Mode boost multipliers — module-level constants (no state dependency)
const RIDESHARE_BOOST: Record<string, number> = {
  aéroport: 1.2,
  université: 1.15,
  transport: 1.1,
  commercial: 1.05,
  médical: 1.05,
  métro: 1.05,
  résidentiel: 0.75,
};
const DELIVERY_BOOST: Record<string, number> = {
  commercial: 1.3,
  résidentiel: 1.2,
  métro: 0.95,
  transport: 0.85,
  université: 0.8,
  médical: 0.75,
  tourisme: 0.75,
  nightlife: 0.7,
  événements: 0.7,
  aéroport: 0.65,
};

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
  const { scores, factors, zones, surgeMap } = useDemandScores(cityId, {
    currentLat: location?.latitude ?? null,
    currentLng: location?.longitude ?? null,
    conservativePresence,
  });
  const [fullScreen, setFullScreen] = useState(false);
  const [navZone, setNavZone] = useState<{
    name: string;
    lat: number;
    lng: number;
  } | null>(null);

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

  // Mode filter logic (mirrors TodayScreen) — boost maps defined at module level

  // Ranked zones by score descending
  const rankedZones = useMemo(() => {
    return zones
      .map((z) => ({ ...z, score: scores.get(z.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
  }, [zones, scores]);

  // Reweight scores based on driver objective
  const modeZones = useMemo(() => {
    if (driverMode === 'all') return rankedZones;
    const boostMap =
      driverMode === 'rideshare' ? RIDESHARE_BOOST : DELIVERY_BOOST;
    return [...rankedZones]
      .map((z) => ({
        ...z,
        score: Math.min(Math.round(z.score * (boostMap[z.type] ?? 1.0)), 100),
      }))
      .sort((a, b) => b.score - a.score);
  }, [rankedZones, driverMode]);

  // Exclude airport from hero zone, but allow in next recommendations
  const heroZone = modeZones.find((z) => z.type !== 'aéroport') ?? null;
  // Next zones: include airport if present, but never as hero
  const nextZones = modeZones
    .filter((z) => !heroZone || z.id !== heroZone.id)
    .slice(0, 6);

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
    if (next) {
      launchGoogleMapsNavigation(next.name, next.latitude, next.longitude);
    }
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
        <PlatformSwitchBanner />
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
              className={`flex-1 text-[13px] font-display font-semibold py-2 rounded-lg transition-colors ${
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
              launchGoogleMapsNavigation(
                heroZone.name,
                heroZone.latitude,
                heroZone.longitude
              );
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
          speedKmh={speedKmh}
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
          <div className="w-[130px] flex-shrink-0">
            <CitySelect cities={cities} value={cityId} onChange={setCityId} />
          </div>
        </div>
      )}

      {/* Dead time + weekly goal */}
      {!fullScreen && (
        <div className="px-4 space-y-2 mb-2">
          <DeadTimeTimer nearestZoneName={heroZone?.name} />
          <WeeklyGoalDisplay />
        </div>
      )}

      {/* Hero zone card */}
      <div
        className={`px-4 ${fullScreen ? 'flex-1 flex items-center justify-center pt-6' : ''}`}
      >
        <div
          className={`w-full bg-card rounded-3xl border border-border px-5 py-6 space-y-4 shadow-lg ${fullScreen ? 'max-w-md' : ''}`}
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
              </div>

              <div className="flex justify-center items-center gap-3">
                <DemandBadge score={heroZone.score} size="giant" />
                {(() => {
                  const surge = surgeMap?.get(heroZone.id);
                  return surge && surge.surgeClass !== 'normal' ? (
                    <SurgeIndicator
                      surgeClass={surge.surgeClass}
                      multiplier={surge.surgeMultiplier}
                      size="lg"
                      showMultiplier
                    />
                  ) : null;
                })()}
              </div>

              <div className="space-y-2 pt-2">
                <Button
                  onClick={() => openGoogleMapsNav(heroZone.name, heroZone.latitude, heroZone.longitude)}
                  className="w-full h-16 text-[18px] font-display font-bold gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <GoogleMapsIcon className="w-6 h-6 flex-shrink-0" /> Google Maps
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
          ) : (
            <p className="text-[16px] text-muted-foreground font-body text-center">
              {t('noZonesAvailable')}
            </p>
          )}
        </div>
      </div>

      {/* Full-screen toggle + GPS row */}
      <div className="px-4 mt-3 space-y-2">
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
          {nextZones.map((zone) => {
            const dc = getDemandClass(zone.score);
            const dist = getDistance(zone);
            return (
              <div
                key={zone.id}
                onClick={() =>
                  setNavZone({
                    name: zone.name,
                    lat: zone.latitude,
                    lng: zone.longitude,
                  })
                }
                className={`flex items-center justify-between bg-card rounded-xl border-l-4 ${dc.border} border border-border px-4 py-3 gap-3 cursor-pointer active:scale-[0.98] transition-transform`}
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

      <NavigationSheet
        open={!!navZone}
        onClose={() => setNavZone(null)}
        zoneName={navZone?.name ?? ''}
        latitude={navZone?.lat ?? 0}
        longitude={navZone?.lng ?? 0}
      />

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
