import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatIdleTime,
  IDLE_BANNER_THRESHOLD_MIN,
  idleMinutes,
  loadIdleMap,
  setPlatformOnline,
  type IdleMap,
  type Platform,
} from '@/lib/platformIdle';
import { ChevronDown, Pause, Play, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';

const PLATFORM_LABELS: Record<Platform, string> = {
  lyft: 'Lyft',
  uber: 'Uber',
  hypra: 'Hypra',
  imoove: 'Imoove',
  doordash: 'DoorDash',
  ubereats: 'UberEats',
  skip: 'Skip',
};

const RIDESHARE: Platform[] = ['lyft', 'uber', 'hypra', 'imoove'];
const DELIVERY: Platform[] = ['doordash', 'ubereats', 'skip'];

type DriverMode = 'rideshare' | 'delivery' | 'all';

/** Platforms matching the driver's current objective — shown in the primary grid. */
function primaryPlatformsFor(mode: DriverMode): Platform[] {
  if (mode === 'rideshare') return RIDESHARE;
  if (mode === 'delivery') return DELIVERY;
  return [...RIDESHARE, ...DELIVERY];
}

interface PlatformSwitchBannerProps {
  /** Filters which platforms show in the primary grid vs the "Autres" disclosure. Default 'all' (no compaction). */
  driverMode?: DriverMode;
}

/**
 * Banner that surfaces when one online rideshare platform is idle past the
 * threshold and a different category (delivery) could fill the dead time.
 * Lets the driver tap to toggle online/offline state per platform in one
 * place — also serves as the entry-point for marking a trip on a given
 * platform later.
 */
function PlatformButton({
  platform,
  online,
  idle,
  onToggle,
}: {
  platform: Platform;
  online: boolean;
  idle: number | null;
  onToggle: (platform: Platform, online: boolean) => void;
}) {
  return (
    <Button
      variant={online ? 'default' : 'outline'}
      size="sm"
      className={`h-12 flex flex-col gap-0 items-center ${online ? '' : 'opacity-60'}`}
      onClick={() => onToggle(platform, !online)}
    >
      <span className="text-[11px] font-medium leading-tight flex items-center gap-1">
        {online ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
        {PLATFORM_LABELS[platform]}
      </span>
      {online && idle != null && (
        <span className="text-[9px] opacity-70 leading-tight">
          {formatIdleTime(idle)}
        </span>
      )}
    </Button>
  );
}

export function PlatformSwitchBanner({
  driverMode = 'all',
}: PlatformSwitchBannerProps) {
  const [map, setMap] = useState<IdleMap>(() => loadIdleMap());
  const [now, setNow] = useState(Date.now());

  // Recompute idle every 30 s. Cheap — single setState that re-renders the
  // banner section. No network, no heavy work.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  function togglePlatform(platform: Platform, online: boolean) {
    setMap(setPlatformOnline(platform, online));
  }

  const allPlatforms: Platform[] = [...RIDESHARE, ...DELIVERY];

  // Build a list of idle-too-long online platforms
  const idleSuggestions: { idle: Platform; idleMin: number; alts: Platform[] }[] = [];
  for (const p of RIDESHARE) {
    const idle = idleMinutes(map[p], now);
    if (idle != null && idle >= IDLE_BANNER_THRESHOLD_MIN) {
      // Alts = any other online platform from EITHER category
      const alts = allPlatforms.filter(
        (other) => other !== p && map[other]?.online,
      );
      idleSuggestions.push({ idle: p, idleMin: idle, alts });
    }
  }

  const anyOnline = allPlatforms.some((p) => map[p]?.online);

  const primary = primaryPlatformsFor(driverMode);
  const secondary = allPlatforms.filter((p) => !primary.includes(p));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Repeat className="w-3 h-3" /> Plateformes actives
        </h3>
        {anyOnline && (
          <Badge variant="outline" className="text-[10px]">
            {allPlatforms.filter((p) => map[p]?.online).length} online
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {primary.map((p) => (
          <PlatformButton
            key={p}
            platform={p}
            online={!!map[p]?.online}
            idle={idleMinutes(map[p], now)}
            onToggle={togglePlatform}
          />
        ))}
      </div>

      {secondary.length > 0 && (
        <details className="group">
          <summary className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground cursor-pointer select-none list-none">
            <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
            Autres plateformes
          </summary>
          <div className="grid grid-cols-4 gap-1.5 mt-1.5">
            {secondary.map((p) => (
              <PlatformButton
                key={p}
                platform={p}
                online={!!map[p]?.online}
                idle={idleMinutes(map[p], now)}
                onToggle={togglePlatform}
              />
            ))}
          </div>
        </details>
      )}

      {idleSuggestions.map((s) => (
        <div
          key={s.idle}
          className="bg-amber-500/10 border border-amber-500/30 rounded-md p-2 text-xs"
        >
          <p className="text-amber-300 font-medium">
            {PLATFORM_LABELS[s.idle]} silencieux depuis {formatIdleTime(s.idleMin)}
          </p>
          {s.alts.length > 0 ? (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Bascule sur {s.alts.map((a) => PLATFORM_LABELS[a]).join(' / ')} en attendant — chaque
              minute morte coûte ~$1 d'opportunité.
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Active une autre plateforme pour combler le creux.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
