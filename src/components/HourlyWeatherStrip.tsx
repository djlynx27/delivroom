import { Badge } from '@/components/ui/badge';
import { useHourlyForecast } from '@/hooks/useWeather';
import { CloudRain, Loader2 } from 'lucide-react';

interface HourlyWeatherStripProps {
  cityId: string;
  hours?: number;
}

/**
 * Horizontal-scrollable strip showing the next N hours of weather.
 * Each cell surfaces the demand boost the score-calculator would apply at
 * that hour, so the driver can read "rain at 18 h → expected +15 score
 * boost" and plan accordingly.
 */
export function HourlyWeatherStrip({ cityId, hours = 18 }: HourlyWeatherStripProps) {
  const { data: forecast, isLoading } = useHourlyForecast(cityId, hours);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Chargement météo horaire…
      </div>
    );
  }
  if (!forecast?.length) return null;

  const peakBoost = Math.max(...forecast.map((p) => p.demandBoostPoints));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <CloudRain className="w-3 h-3" /> Météo horaire ({hours}h)
        </h3>
        {peakBoost > 0 && (
          <Badge variant="default" className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30">
            Pic prévu : +{peakBoost}
          </Badge>
        )}
      </div>
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex gap-1.5 min-w-fit pb-1">
          {forecast.map((p) => {
            const intensity =
              p.demandBoostPoints >= 25
                ? 'bg-red-500/20 border-red-500/40 text-red-200'
                : p.demandBoostPoints >= 12
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
                  : p.demandBoostPoints >= 4
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-200'
                    : 'bg-background border-border text-muted-foreground';
            return (
              <div
                key={p.time}
                className={`shrink-0 w-14 rounded-md border px-1.5 py-1.5 flex flex-col items-center gap-0.5 ${intensity}`}
              >
                <span className="text-[10px] font-medium">{p.label}</span>
                <span className="text-base leading-none">{p.icon}</span>
                <span className="text-[10px]">{p.temp}°</span>
                {p.demandBoostPoints > 0 && (
                  <span className="text-[9px] font-mono opacity-80">+{p.demandBoostPoints}</span>
                )}
                {p.precipProbability >= 30 && p.demandBoostPoints === 0 && (
                  <span className="text-[9px] font-mono opacity-60">{p.precipProbability}%</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
