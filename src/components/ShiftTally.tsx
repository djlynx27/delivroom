import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  computeStats,
  loadShift,
  MIN_VIABLE_NET_PER_HOUR,
  readShiftTarget,
  resetShift,
  writeShiftTarget,
} from '@/lib/shiftTracker';
import { Clock, DollarSign, MapPin, RotateCcw, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Always-visible compact dashboard at the top of DriveScreen showing the
 * driver's TRUE rate this shift, computed from their own logged fares.
 * Not Lyft's "estimated $50/h" — just dollars on the table ÷ time online.
 *
 * Subscribes to a custom `delivroom:shift-updated` event so any code that
 * calls recordRide() automatically refreshes this widget without prop
 * drilling.
 */
export function ShiftTally() {
  const [stats, setStats] = useState(() => computeStats(loadShift()));
  const [target, setTarget] = useState(() => readShiftTarget());
  const [editingTarget, setEditingTarget] = useState(false);

  useEffect(() => {
    function refresh() {
      setStats(computeStats(loadShift()));
    }
    refresh();
    const interval = setInterval(refresh, 30_000); // wall-clock ticker for $/h
    window.addEventListener('delivroom:shift-updated', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('delivroom:shift-updated', refresh);
    };
  }, []);

  if (stats.rideCount === 0) {
    return null; // Don't take up screen space before the first ride
  }

  const netLow =
    stats.netHourlyRate != null && stats.netHourlyRate < MIN_VIABLE_NET_PER_HOUR;
  const pacingPct = target > 0 ? Math.min(100, (stats.netFare / target) * 100) : 0;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            <span className="text-xs font-medium">Shift en cours</span>
            <Badge variant="outline" className="text-[10px]">{stats.rideCount} rides</Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => {
              resetShift();
              window.dispatchEvent(new CustomEvent('delivroom:shift-updated'));
            }}
            title="Reset shift"
          >
            <RotateCcw className="w-3 h-3 text-muted-foreground" />
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-1 text-center">
          <Stat
            icon={<DollarSign className="w-3 h-3" />}
            label="Total $"
            value={`$${stats.totalFare.toFixed(0)}`}
          />
          <Stat
            icon={<TrendingUp className="w-3 h-3" />}
            label="$/h vrai"
            value={stats.trueHourlyRate != null ? `$${stats.trueHourlyRate.toFixed(0)}` : '—'}
            emphasis
          />
          <Stat
            icon={<MapPin className="w-3 h-3" />}
            label="Km"
            value={stats.totalKm.toFixed(0)}
          />
          <Stat
            icon={<Clock className="w-3 h-3" />}
            label="Heures"
            value={stats.wallHours.toFixed(1)}
          />
        </div>
        <div className="grid grid-cols-2 gap-1 text-center">
          <Stat
            icon={<TrendingUp className="w-3 h-3" />}
            label="$/h net"
            value={stats.netHourlyRate != null ? `$${stats.netHourlyRate.toFixed(0)}` : '—'}
            emphasis
            warn={netLow}
          />
          <Stat
            icon={<MapPin className="w-3 h-3" />}
            label="$/km net"
            value={stats.netPerKm != null ? `$${stats.netPerKm.toFixed(2)}` : '—'}
          />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full ${netLow ? 'bg-destructive' : 'bg-green-400'}`}
              style={{ width: `${pacingPct}%` }}
            />
          </div>
          {editingTarget ? (
            <input
              autoFocus
              type="number"
              inputMode="numeric"
              defaultValue={target}
              className="w-14 h-5 text-[10px] font-mono bg-white/5 border border-border rounded px-1 text-right"
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next) && next > 0) {
                  setTarget(next);
                  writeShiftTarget(next);
                }
                setEditingTarget(false);
              }}
            />
          ) : (
            <button
              className="text-[10px] font-mono text-muted-foreground whitespace-nowrap"
              onClick={() => setEditingTarget(true)}
              title="Modifier l'objectif"
            >
              ${stats.netFare.toFixed(0)}/${target.toFixed(0)}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface StatProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  emphasis?: boolean;
  warn?: boolean;
}

function Stat({ icon, label, value, emphasis, warn }: StatProps) {
  const color = warn ? 'text-destructive' : emphasis ? 'text-green-400' : '';
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-center gap-0.5 text-muted-foreground">
        {icon}
        <span className="text-[9px] uppercase tracking-tight">{label}</span>
      </div>
      <p className={`font-mono font-bold ${emphasis || warn ? 'text-base' : 'text-sm'} ${color}`}>
        {value}
      </p>
    </div>
  );
}
