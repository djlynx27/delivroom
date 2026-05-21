import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/contexts/I18nContext';
import { CitySelect } from '@/components/CitySelect';
import { DemandBadge } from '@/components/DemandBadge';
import { useCities } from '@/hooks/useSupabase';
import { useDemandScores } from '@/hooks/useDemandScores';
import { formatTime24h, getCurrentSlotTime, getDemandClass } from '@/lib/demandUtils';
import { getActiveTimeBoosts } from '@/lib/timeBoosts';
import { Clock, PartyPopper, Download, WifiOff, Navigation, Bell, Ticket, Upload, Brain } from 'lucide-react';
import { ScoreFactorIcons } from '@/components/ScoreFactorIcons';
import { WeatherWidget } from '@/components/WeatherWidget';
import { MapboxHeatmap } from '@/components/MapboxHeatmap';
import { useHoliday } from '@/hooks/useHoliday';
import { useHabsGame } from '@/hooks/useHabsGame';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useNotifications } from '@/hooks/useNotifications';
import { Button } from '@/components/ui/button';
import { useUserLocation, haversineKm } from '@/hooks/useUserLocation';
import { NavigationSheet } from '@/components/NavigationSheet';
import { useCityId } from '@/hooks/useCityId';
import { openGoogleMapsNav, openWazeNav } from '@/lib/hotspots';
import { DeadTimeTimer } from '@/components/DeadTimeTimer';
import { WeeklyGoalDisplay } from '@/components/WeeklyGoal';
import { MultiAppStatus } from '@/components/MultiAppStatus';

const CITY_CENTERS: Record<string, [number, number]> = {
  mtl: [45.5017, -73.5673],
  qc: [46.8139, -71.2080],
  ott: [45.4215, -75.6972],
};

export default function TodayScreen() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const [showImportHint, setShowImportHint] = useState(false);
  const [cityId, setCityId] = useCityId();
  const [now, setNow] = useState(new Date());
  const { canInstall, install } = usePwaInstall();
  const isOnline = useOnlineStatus();
  const { enabled: notifEnabled, requestPermission } = useNotifications(cityId);
  const { location: userLocation } = useUserLocation();
  const [navZone, setNavZone] = useState<{ name: string; lat: number; lng: number } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  const { start, end } = getCurrentSlotTime(now);
  const { data: cities = [] } = useCities();
  const { scores, factors, zones, endingSoon, relevantTmEvents } = useDemandScores(cityId);
  const { data: holiday } = useHoliday(getCurrentSlotTime(now).date);
  const { data: habsGame } = useHabsGame(getCurrentSlotTime(now).date);
  const timeBoosts = useMemo(() => getActiveTimeBoosts(now), [now]);

  const rankedZones = useMemo(() => {
    return zones
      .map(z => ({ ...z, score: scores.get(z.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
  }, [zones, scores]);

  const heroZone = rankedZones[0] ?? null;
  const nextZones = rankedZones.slice(1, 4);

  const getDistance = (zone: { latitude: number; longitude: number } | null) => {
    if (!userLocation || !zone) return null;
    return haversineKm(userLocation.latitude, userLocation.longitude, zone.latitude, zone.longitude);
  };

  const heroDistance = getDistance(heroZone);

  const mapCenter = heroZone
    ? [heroZone.latitude, heroZone.longitude] as [number, number]
    : CITY_CENTERS[cityId] ?? CITY_CENTERS.mtl;

  const mapMarkers = useMemo(() => {
    return rankedZones.map(z => ({
      id: z.id,
      name: z.name,
      type: z.type,
      latitude: z.latitude,
      longitude: z.longitude,
      demandScore: z.score,
    }));
  }, [rankedZones]);

  return (
    <div className="flex flex-col h-full pb-36">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1 h-12">
        <div className="w-[140px] flex-shrink-0">
          <CitySelect cities={cities} value={cityId} onChange={setCityId} />
        </div>
        <div className="flex-1 min-w-0">
          <WeatherWidget cityId={cityId} />
        </div>
        <span className="text-[14px] text-muted-foreground font-body flex-shrink-0">
          {formatTime24h(now)}
        </span>
      </div>

      {/* Dead Time Timer + Weekly Goal */}
      <div className="px-3 mt-2 space-y-2">
        <DeadTimeTimer nearestZoneName={heroZone?.name} />
        <WeeklyGoalDisplay />
      </div>

      {/* Alerts */}
      <div className="px-3 space-y-1.5 mt-2">
        {!isOnline && (
          <div className="flex items-center gap-2 bg-destructive/20 border border-destructive/40 rounded-lg px-3 py-2">
            <WifiOff className="w-5 h-5 text-destructive flex-shrink-0" />
            <span className="text-[14px] font-body font-medium text-destructive">Hors ligne</span>
          </div>
        )}
        {canInstall && (
          <Button onClick={install} variant="outline" className="w-full gap-2 border-primary/40 text-primary hover:bg-primary/10 h-12">
            <Download className="w-5 h-5" /> Installer HustleGo
          </Button>
        )}
        {!notifEnabled && (
          <Button onClick={requestPermission} variant="outline" className="w-full gap-2 border-accent/40 text-accent-foreground hover:bg-accent/10 h-12">
            <Bell className="w-5 h-5" /> {lang === 'fr' ? 'Activer les notifications' : 'Enable notifications'}
          </Button>
        )}
        {notifEnabled && (
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
            <Bell className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-[13px] font-body text-primary">
              {lang === 'fr' ? 'Notifications activées' : 'Notifications enabled'}
            </span>
          </div>
        )}
        {holiday?.isHoliday && holiday.name && (
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
            <PartyPopper className="w-5 h-5 text-primary flex-shrink-0" />
            <span className="text-[14px] font-body font-medium text-primary">{holiday.name}</span>
          </div>
        )}
        {cityId === 'mtl' && habsGame?.isHomeGame && (
          <div className="flex items-center gap-2 bg-accent/30 border border-accent rounded-lg px-3 py-2">
            <span className="text-lg flex-shrink-0">🏒</span>
            <span className="text-[14px] font-body font-medium">Canadiens — Centre Bell</span>
          </div>
        )}
        {timeBoosts.map((boost, index) => (
          <div key={index} className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2">
            <span className="text-lg flex-shrink-0">{boost.icon}</span>
            <span className="text-[14px] font-body font-medium">
              {lang === 'fr' ? boost.bannerFr : boost.bannerEn}
            </span>
          </div>
        ))}
        {endingSoon.map(ev => {
          const minsLeft = Math.round((new Date(ev.end_at).getTime() - now.getTime()) / 60_000);
          return (
            <div key={ev.id} className="flex items-center gap-2 bg-destructive/20 border border-destructive/40 rounded-lg px-3 py-2">
              <span className="text-[14px] font-body font-bold text-destructive">
                🔴 {ev.name} se termine dans {minsLeft}min — Demande maximale prévue!
              </span>
            </div>
          );
        })}
        {relevantTmEvents.length > 0 && (
          <div
            onClick={() => navigate('/events')}
            className="flex items-center gap-2 bg-accent/20 border border-accent/40 rounded-lg px-3 py-2 cursor-pointer active:scale-[0.98] transition-transform"
          >
            <Ticket className="w-5 h-5 text-accent-foreground flex-shrink-0" />
            <span className="text-[14px] font-body font-medium text-accent-foreground">
              🎫 {relevantTmEvents.length} événement{relevantTmEvents.length > 1 ? 's' : ''} en cours/à venir —{' '}
              {relevantTmEvents.map(e => e.venueName).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* Meilleure zone */}
      <div className="px-3 mt-2">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-[14px] text-muted-foreground font-body uppercase tracking-wide">
                {lang === 'fr' ? 'Meilleure zone maintenant' : 'Best zone now'} · {start}–{end}
              </span>
            </div>
            {/* Confidence badge */}
            {heroZone && (() => {
              const f = factors.get(heroZone.id);
              const hasPersonalData = (f?.learningBoostPoints ?? 0) > 0 || (f?.habitBoostPercent ?? 0) > 0;
              return hasPersonalData ? (
                <span className="flex items-center gap-1 text-[11px] text-green-400 font-medium">
                  <Brain className="w-3 h-3" /> Données perso
                </span>
              ) : (
                <button
                  onClick={() => setShowImportHint(h => !h)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  🔮 Théorique
                </button>
              );
            })()}
          </div>

          {/* Import hint */}
          {showImportHint && (
            <div className="mb-3 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-xs text-primary">
                Importe tes screenshots Imoove/Hypra pour des suggestions basées sur tes vraies données
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-primary shrink-0"
                onClick={() => navigate('/admin/imports')}
              >
                <Upload className="w-3 h-3 mr-1" /> Importer
              </Button>
            </div>
          )}

          {heroZone ? (
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-[28px] font-display font-bold leading-tight break-words">
                  {heroZone.name}
                </h2>
                <span className="text-[16px] text-muted-foreground capitalize block mt-0.5">
                  {heroZone.type}
                  <ScoreFactorIcons factors={factors.get(heroZone.id)} />
                </span>
                {heroDistance !== null && (
                  <span className="text-[20px] font-display font-semibold text-muted-foreground mt-1 block">
                    📍 {heroDistance.toFixed(1)} km
                  </span>
                )}
              </div>
              <DemandBadge score={heroZone.score} size="giant" />
            </div>
          ) : (
            <p className="text-[18px] font-body text-muted-foreground">
              {lang === 'fr' ? 'Chargement des zones...' : 'Loading zones...'}
            </p>
          )}

          {heroZone && (
            <div className="mt-4 space-y-2">
              <Button
                onClick={() => openGoogleMapsNav(heroZone.name, heroZone.latitude, heroZone.longitude)}
                className="w-full h-16 text-[18px] font-display font-bold gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Navigation className="w-5 h-5" />
                🗺️ GO — Google Maps
              </Button>
              <Button
                onClick={() => openWazeNav(heroZone.name, heroZone.latitude, heroZone.longitude)}
                variant="secondary"
                className="w-full h-16 text-[18px] font-display font-bold gap-2"
              >
                🧭 Waze
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Heatmap */}
      <div className="flex-shrink-0 h-[260px] max-h-[260px] overflow-hidden mx-3 mt-3 rounded-xl border border-border">
        <MapboxHeatmap
          center={mapCenter}
          zoom={13}
          markers={mapMarkers}
          onZoneClick={(z) => setNavZone({ name: z.name, lat: z.latitude, lng: z.longitude })}
        />
      </div>

      {/* Multi-App Status */}
      <div className="px-3 mt-3">
        <MultiAppStatus cityId={cityId} />
      </div>

      {/* Prochains créneaux */}
      <div className="px-3 mt-3 pb-4 space-y-2">
        <h3 className="text-[16px] font-display font-bold text-muted-foreground uppercase tracking-wide">
          {t('nextSlots')}
        </h3>
        {nextZones.map((zone) => {
          const dc = getDemandClass(zone.score);
          const dist = getDistance(zone);
          return (
            <div
              key={zone.id}
              onClick={() => setNavZone({ name: zone.name, lat: zone.latitude, lng: zone.longitude })}
              className={`flex items-center justify-between bg-card rounded-xl border-l-4 ${dc.border} border border-border p-4 gap-3 cursor-pointer active:scale-[0.98] transition-transform`}
            >
              <div className="flex-1 min-w-0">
                <span className="text-[18px] font-display font-semibold block leading-tight break-words">
                  {zone.name}
                  {dist !== null && (
                    <span className="text-muted-foreground text-[14px] font-body ml-2">
                      · {dist.toFixed(1)} km
                    </span>
                  )}
                </span>
                <span className="text-[14px] text-muted-foreground font-body capitalize">
                  {zone.type}
                  <ScoreFactorIcons factors={factors.get(zone.id)} />
                </span>
                <span className="text-[12px] text-muted-foreground font-body">{start}–{end}</span>
              </div>
              <div className="flex-shrink-0">
                <DemandBadge score={zone.score} size="lg" />
              </div>
            </div>
          );
        })}
      </div>

      <NavigationSheet
        open={!!navZone}
        onClose={() => setNavZone(null)}
        zoneName={navZone?.name ?? ''}
        latitude={navZone?.lat ?? 0}
        longitude={navZone?.lng ?? 0}
      />
    </div>
  );
}
