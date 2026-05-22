import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, HeartPulse, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

const PLATFORMS = ['lyft', 'uber', 'hypra', 'imoove'] as const;
type Platform = (typeof PLATFORMS)[number];

interface DriverMetric {
  id: string;
  platform: Platform;
  acceptance_rate: number | null;
  cancellation_rate: number | null;
  rating: number | null;
  trips_completed: number | null;
  measured_at: string;
}

// Hard thresholds — calibrated from Lyft / Uber driver community knowledge.
// Below these values, the platform deprioritizes you in matching and
// eventually deactivates your account.
const ACCEPTANCE_WARN = 90;
const ACCEPTANCE_CRIT = 80;
const CANCEL_WARN = 5;
const CANCEL_CRIT = 8;
const RATING_WARN = 4.85;
const RATING_CRIT = 4.7;

async function fetchLatestMetrics(): Promise<DriverMetric[]> {
  // For each platform, grab the most recent row.
  // Cheap because the table is small per user.
  const { data, error } = await supabase
    .from('driver_metrics')
    .select('id, platform, acceptance_rate, cancellation_rate, rating, trips_completed, measured_at')
    .order('measured_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  const latest = new Map<string, DriverMetric>();
  for (const row of (data ?? []) as DriverMetric[]) {
    if (!latest.has(row.platform)) latest.set(row.platform, row);
  }
  return Array.from(latest.values());
}

export function HealthMetricsTracker() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Platform | null>(null);

  const { data: metrics = [] } = useQuery({
    queryKey: ['driver-metrics', 'latest'],
    queryFn: fetchLatestMetrics,
  });

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-primary" /> Santé du compte
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {PLATFORMS.map((p) => {
          const m = metrics.find((x) => x.platform === p);
          return (
            <PlatformMetricRow
              key={p}
              platform={p}
              metric={m}
              onEdit={() => setEditing(p)}
            />
          );
        })}
      </CardContent>

      <UpdateMetricsDialog
        platform={editing}
        existing={editing ? metrics.find((x) => x.platform === editing) ?? null : null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void qc.invalidateQueries({ queryKey: ['driver-metrics'] });
        }}
      />
    </Card>
  );
}

interface PlatformMetricRowProps {
  platform: Platform;
  metric: DriverMetric | undefined;
  onEdit: () => void;
}

function PlatformMetricRow({ platform, metric, onEdit }: PlatformMetricRowProps) {
  if (!metric) {
    return (
      <div className="flex items-center justify-between bg-background rounded-md border border-border p-2">
        <span className="text-xs uppercase text-muted-foreground">{platform}</span>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-[10px]" onClick={onEdit}>
          <Pencil className="w-3 h-3" /> Saisir
        </Button>
      </div>
    );
  }

  const acceptanceLevel = thresholdLevel(metric.acceptance_rate, ACCEPTANCE_WARN, ACCEPTANCE_CRIT);
  const cancelLevel = thresholdLevelInverse(metric.cancellation_rate, CANCEL_WARN, CANCEL_CRIT);
  const ratingLevel = thresholdLevel(metric.rating, RATING_WARN, RATING_CRIT);
  const worstLevel = [acceptanceLevel, cancelLevel, ratingLevel].includes('crit')
    ? 'crit'
    : [acceptanceLevel, cancelLevel, ratingLevel].includes('warn')
      ? 'warn'
      : 'ok';

  const updatedAgo = humanizeAgo(metric.measured_at);

  return (
    <div className="bg-background rounded-md border border-border p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase font-medium flex items-center gap-1.5">
          {worstLevel === 'ok' && <CheckCircle2 className="w-3 h-3 text-green-400" />}
          {worstLevel === 'warn' && <AlertTriangle className="w-3 h-3 text-amber-400" />}
          {worstLevel === 'crit' && <AlertTriangle className="w-3 h-3 text-red-400" />}
          {platform}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{updatedAgo}</span>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onEdit}>
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <MetricCell label="Accept" value={fmtPct(metric.acceptance_rate)} level={acceptanceLevel} />
        <MetricCell label="Cancel" value={fmtPct(metric.cancellation_rate)} level={cancelLevel} />
        <MetricCell label="Rating" value={fmtRating(metric.rating)} level={ratingLevel} />
      </div>
    </div>
  );
}

interface MetricCellProps {
  label: string;
  value: string;
  level: 'ok' | 'warn' | 'crit' | 'na';
}

function MetricCell({ label, value, level }: MetricCellProps) {
  const cls =
    level === 'crit'
      ? 'bg-red-500/10 text-red-300 border-red-500/40'
      : level === 'warn'
        ? 'bg-amber-500/10 text-amber-300 border-amber-500/40'
        : level === 'ok'
          ? 'bg-green-500/5 text-green-300 border-green-500/30'
          : 'bg-background text-muted-foreground border-border';
  return (
    <div className={`rounded border px-1 py-1 text-center ${cls}`}>
      <p className="opacity-60 leading-tight">{label}</p>
      <p className="font-mono font-medium leading-tight">{value}</p>
    </div>
  );
}

function thresholdLevel(value: number | null, warn: number, crit: number): 'ok' | 'warn' | 'crit' | 'na' {
  if (value === null || value === undefined) return 'na';
  if (value < crit) return 'crit';
  if (value < warn) return 'warn';
  return 'ok';
}

function thresholdLevelInverse(value: number | null, warn: number, crit: number): 'ok' | 'warn' | 'crit' | 'na' {
  if (value === null || value === undefined) return 'na';
  if (value > crit) return 'crit';
  if (value > warn) return 'warn';
  return 'ok';
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(0)}%`;
}

function fmtRating(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return v.toFixed(2);
}

function humanizeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}min`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}j`;
}

interface UpdateMetricsDialogProps {
  platform: Platform | null;
  existing: DriverMetric | null;
  onClose: () => void;
  onSaved: () => void;
}

function UpdateMetricsDialog({ platform, existing, onClose, onSaved }: UpdateMetricsDialogProps) {
  const [acceptance, setAcceptance] = useState('');
  const [cancellation, setCancellation] = useState('');
  const [rating, setRating] = useState('');
  const [trips, setTrips] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset form whenever the dialog opens against a different platform —
  // ensures fields are pre-filled with the latest persisted snapshot.
  useEffect(() => {
    if (!platform) return;
    setAcceptance(existing?.acceptance_rate?.toString() ?? '');
    setCancellation(existing?.cancellation_rate?.toString() ?? '');
    setRating(existing?.rating?.toString() ?? '');
    setTrips(existing?.trips_completed?.toString() ?? '');
  }, [platform, existing]);

  async function save() {
    if (!platform) return;
    setSaving(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        toast.error('Auth requise');
        return;
      }
      const { error } = await supabase.from('driver_metrics').insert({
        user_id: authData.user.id,
        platform,
        acceptance_rate: parseOrNull(acceptance),
        cancellation_rate: parseOrNull(cancellation),
        rating: parseOrNull(rating),
        trips_completed: parseIntOrNull(trips),
        source: 'manual',
      });
      if (error) {
        toast.error(`Échec : ${error.message}`);
        return;
      }
      toast.success('Métriques sauvegardées');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!platform} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Saisir santé {platform ? <Badge variant="outline" className="ml-1 uppercase">{platform}</Badge> : null}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">Acceptance rate (%)</Label>
            <Input type="number" step="0.1" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} placeholder="90" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cancellation rate (%)</Label>
            <Input type="number" step="0.1" value={cancellation} onChange={(e) => setCancellation(e.target.value)} placeholder="3" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Rating (sur 5)</Label>
            <Input type="number" step="0.01" min="0" max="5" value={rating} onChange={(e) => setRating(e.target.value)} placeholder="4.92" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Total trips complétés</Label>
            <Input type="number" value={trips} onChange={(e) => setTrips(e.target.value)} placeholder="450" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button onClick={save} disabled={saving}>Sauvegarder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseOrNull(s: string): number | null {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function parseIntOrNull(s: string): number | null {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

