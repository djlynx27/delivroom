import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { RankedStation } from '@/lib/gasRanking';
import { openGoogleMapsNav } from '@/lib/hotspots';
import { PIT_STOPS } from '@/lib/pitStops';
import type { DemandWindow } from '@/lib/scoringEngine';
import { Radar } from 'lucide-react';
import { useState } from 'react';

export interface MarketRadarZoneRow {
  id: string;
  name: string;
  estimatedWaitMin: number | null;
  driverCount: number;
  isSaturated: boolean;
}

interface MarketRadarSheetProps {
  zones: MarketRadarZoneRow[];
  demandWindow: DemandWindow;
  onDemandWindowChange: (window: DemandWindow) => void;
  bestGasStation: RankedStation | null;
}

type RadarView = 'wait' | 'saturation' | 'pitstops';

const DEMAND_WINDOWS: DemandWindow[] = ['5m', '30m', '1h'];

function WaitView({ zones }: { zones: MarketRadarZoneRow[] }) {
  const withWait = zones.filter((z) => z.estimatedWaitMin != null);
  if (withWait.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground text-center py-6">
        Aucune donnée d'attente disponible pour l'instant.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {withWait.map((zone) => (
        <div
          key={zone.id}
          className="flex items-center justify-between bg-card rounded-lg border border-border px-3 py-2.5"
        >
          <span className="text-[14px] font-body truncate">{zone.name}</span>
          <span className="text-[14px] font-display font-bold">
            ~{zone.estimatedWaitMin} min
          </span>
        </div>
      ))}
    </div>
  );
}

function SaturationView({ zones }: { zones: MarketRadarZoneRow[] }) {
  return (
    <div className="space-y-2">
      {zones.map((zone) => (
        <div
          key={zone.id}
          className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
            zone.isSaturated
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-card border-border'
          }`}
        >
          <span className="text-[14px] font-body truncate">{zone.name}</span>
          <span className="text-[13px] font-body text-muted-foreground">
            {zone.driverCount} chauffeur{zone.driverCount > 1 ? 's' : ''}
            {zone.isSaturated && (
              <span className="ml-2 text-red-400 font-bold">⚠ Saturée</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function PitStopsView({ bestGasStation }: { bestGasStation: RankedStation | null }) {
  return (
    <div className="space-y-2">
      {bestGasStation && (
        <button
          onClick={() =>
            openGoogleMapsNav(bestGasStation.name, bestGasStation.lat, bestGasStation.lng)
          }
          className="w-full flex items-center justify-between bg-card rounded-lg border border-border px-3 py-2.5 text-left"
        >
          <span className="text-[14px] font-body truncate">
            ⛽ {bestGasStation.name}
          </span>
          <span className="text-[13px] font-display font-bold text-green-400">
            {bestGasStation.price.toFixed(3)} $/L
          </span>
        </button>
      )}
      {PIT_STOPS.map((stop) => (
        <button
          key={stop.id}
          onClick={() => openGoogleMapsNav(stop.name, stop.latitude, stop.longitude)}
          className="w-full flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-2.5 text-left"
        >
          <span>🚻</span>
          <span className="text-[14px] font-body truncate">{stop.name}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Market Radar — 1-tap switch between Wait times, Saturation (nearby
 * drivers), and Pit-Stops. Data is passed in fully computed (from
 * useDemandScores + useNearbyDrivers + useGasBoard in DriveScreen) so this
 * component stays a thin presentational sheet.
 */
export function MarketRadarSheet({
  zones,
  demandWindow,
  onDemandWindowChange,
  bestGasStation,
}: MarketRadarSheetProps) {
  const [view, setView] = useState<RadarView>('wait');

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          className="w-full h-11 rounded-xl text-[14px] font-display font-bold border border-border bg-card flex items-center justify-center gap-2"
          aria-label="Ouvrir Market Radar"
        >
          <Radar className="w-4 h-4" />
          Market Radar
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Market Radar</SheetTitle>
        </SheetHeader>

        <div className="flex rounded-xl border border-border bg-muted/30 p-1 gap-1 mt-3">
          {(
            [
              { key: 'wait', label: 'Attente' },
              { key: 'saturation', label: 'Saturation' },
              { key: 'pitstops', label: 'Pit-Stops' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex-1 py-1.5 rounded-lg text-[13px] font-display font-bold transition-colors ${
                view === key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'wait' && (
          <div className="flex rounded-xl border border-border bg-muted/30 p-1 gap-1 mt-2">
            {DEMAND_WINDOWS.map((window) => (
              <button
                key={window}
                onClick={() => onDemandWindowChange(window)}
                className={`flex-1 py-1 rounded-lg text-[12px] font-body ${
                  demandWindow === window
                    ? 'bg-secondary text-secondary-foreground font-bold'
                    : 'text-muted-foreground'
                }`}
              >
                {window}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3">
          {view === 'wait' && <WaitView zones={zones} />}
          {view === 'saturation' && <SaturationView zones={zones} />}
          {view === 'pitstops' && <PitStopsView bestGasStation={bestGasStation} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
