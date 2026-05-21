import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useAutoShift } from '@/hooks/useAutoShift';
import { useTrips } from '@/hooks/useTrips';
import {
  derivePostShiftSummary,
  type PostShiftSummary,
} from '@/lib/learningEngine';
import { syncShiftLearning } from '@/lib/learningSync';
import { DEFAULT_WEIGHTS } from '@/lib/scoringEngine';
import { buildShiftSnapshot } from '@/lib/tripAnalytics';
import { cn } from '@/lib/utils';
import {
  Clock3,
  Flag,
  Play,
  Route,
  Smartphone,
  Wallet,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

const ACTIVE_SHIFT_KEY = 'delivroom_active_shift';

type ActiveShift = {
  startedAt: string;
};

function loadActiveShift() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_SHIFT_KEY);
    return raw ? (JSON.parse(raw) as ActiveShift) : null;
  } catch {
    return null;
  }
}

function saveActiveShift(shift: ActiveShift | null) {
  if (typeof window === 'undefined') return;
  if (!shift) {
    window.localStorage.removeItem(ACTIVE_SHIFT_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_SHIFT_KEY, JSON.stringify(shift));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMoneyPerHour(value: number) {
  return `${formatMoney(value)}/h`;
}

function getStartedLabel(startedAt: string | null) {
  if (!startedAt) {
    return null;
  }

  return new Date(startedAt).toLocaleString('fr-CA', {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

function getShiftRevenuePerHour(
  summary: {
    elapsedHours: number;
    metrics: { revenue: number };
  } | null
) {
  if (!summary || summary.elapsedHours <= 0) {
    return 0;
  }

  return summary.metrics.revenue / summary.elapsedHours;
}

function buildShiftStats(
  snapshot: NonNullable<ReturnType<typeof buildShiftSnapshot>>
) {
  return [
    {
      label: 'Revenu',
      value: formatMoney(snapshot.metrics.revenue),
      icon: Wallet,
    },
    {
      label: '$/h en course',
      value: formatMoney(snapshot.metrics.revenuePerHour),
      icon: Clock3,
    },
    {
      label: 'Courses',
      value: String(snapshot.metrics.rides),
      icon: Smartphone,
    },
    {
      label: 'Distance',
      value: `${snapshot.metrics.distanceKm.toFixed(1)} km`,
      icon: Route,
    },
  ];
}

function ShiftSnapshotContent({
  snapshot,
  startedLabel,
  stats,
  shiftRevenuePerHour,
  isSyncing,
  onEndShift,
}: {
  snapshot: NonNullable<ReturnType<typeof buildShiftSnapshot>>;
  startedLabel: string | null;
  stats: ReturnType<typeof buildShiftStats>;
  shiftRevenuePerHour: number;
  isSyncing: boolean;
  onEndShift: () => void;
}) {
  return (
    <>
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              Démarré à {startedLabel}
            </p>
            <p className="text-lg font-display font-semibold">
              {snapshot.elapsedHours.toFixed(1)} h en cours
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={onEndShift}
            disabled={isSyncing}
          >
            {isSyncing ? 'Sync...' : 'Terminer'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-background p-3"
          >
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <stat.icon className="h-3.5 w-3.5" />
              {stat.label}
            </div>
            <p className="mt-1 text-lg font-semibold font-display">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-amber-100">Rythme réel du shift</span>
          <span className="font-semibold text-foreground">
            {formatMoneyPerHour(shiftRevenuePerHour)}
          </span>
        </div>
        <p className="mt-1 text-xs text-amber-100">
          Basé sur {snapshot.elapsedHours.toFixed(1)} h écoulées depuis le début
          du shift. Le $/h en course ci-dessus exclut les temps morts.
        </p>
      </div>

      <div className="grid gap-2 rounded-xl border border-border bg-background p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Zone la plus rentable</span>
          <span className="font-medium">
            {snapshot.topZone ?? 'Pas encore de données'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Plateforme dominante</span>
          <span className="font-medium">
            {snapshot.topPlatform ?? 'Pas encore de données'}
          </span>
        </div>
      </div>
    </>
  );
}

function EmptyShiftContent({ onStartShift }: { onStartShift: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background/50 p-4">
      <p className="text-sm text-muted-foreground">
        Lance un shift avant de rouler pour suivre automatiquement le revenu, le
        rythme et la meilleure zone pendant la session.
      </p>
      <Button className="mt-3 w-full gap-2" onClick={onStartShift}>
        <Play className="w-4 h-4" /> Démarrer un shift
      </Button>
    </div>
  );
}

export function ShiftTracker() {
  const { data: trips = [] } = useTrips(500);
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(() =>
    loadActiveShift()
  );
  const [now, setNow] = useState(() => new Date());
  const [lastShiftSummary, setLastShiftSummary] =
    useState<PostShiftSummary | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const { enabled: autoShiftEnabled, toggleEnabled: toggleAutoShift } =
    useAutoShift();

  // Ref stable pour les event listeners (évite les captures de closures périmées)
  const endShiftRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!activeShift) return;
    const intervalId = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(intervalId);
  }, [activeShift]);

  const snapshot = useMemo(() => {
    if (!activeShift) return null;
    return buildShiftSnapshot(trips, activeShift.startedAt, now);
  }, [activeShift, now, trips]);

  const startShift = () => {
    const nextShift = { startedAt: new Date().toISOString() };
    setActiveShift(nextShift);
    saveActiveShift(nextShift);
    setNow(new Date());
    toast.success('Shift démarré');
  };

  const endShift = async () => {
    if (!snapshot) return;
    const endedAt = new Date().toISOString();
    const summary = derivePostShiftSummary(
      trips,
      snapshot.startedAt,
      endedAt,
      DEFAULT_WEIGHTS
    );
    setLastShiftSummary(summary);
    setActiveShift(null);
    saveActiveShift(null);
    setIsSyncing(true);
    const syncResult = await syncShiftLearning(
      trips,
      snapshot.startedAt,
      endedAt,
      DEFAULT_WEIGHTS
    );
    setIsSyncing(false);
    toast.success(
      `Shift terminé: ${formatMoney(snapshot.metrics.revenue)} sur ${snapshot.metrics.rides} course${snapshot.metrics.rides > 1 ? 's' : ''}`
    );
    if (syncResult.ok) {
      toast.info(syncResult.message);
    } else {
      toast.warning(syncResult.message);
    }
  };

  // Mettre la ref à jour à chaque render pour que les listeners aient
  // toujours la version la plus récente de endShift
  useEffect(() => {
    endShiftRef.current = endShift;
  });

  // Écoute les événements du moniteur global (AutoShiftMonitor)
  useEffect(() => {
    const onShiftChanged = () => {
      setActiveShift(loadActiveShift());
      setNow(new Date());
    };
    window.addEventListener('delivroom:shift-changed', onShiftChanged);
    return () =>
      window.removeEventListener('delivroom:shift-changed', onShiftChanged);
  }, []);

  useEffect(() => {
    const onAutoEnd = () => {
      void endShiftRef.current();
    };
    window.addEventListener('delivroom:auto-end-shift', onAutoEnd);
    return () =>
      window.removeEventListener('delivroom:auto-end-shift', onAutoEnd);
  }, []);

  const startedLabel = getStartedLabel(snapshot?.startedAt ?? null);
  const shiftRevenuePerHour = getShiftRevenuePerHour(snapshot);
  const stats = snapshot ? buildShiftStats(snapshot) : [];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Flag className="w-4 h-4 text-primary" /> Shift tracker
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Zap
              className={cn(
                'w-3.5 h-3.5',
                autoShiftEnabled ? 'text-primary' : 'text-muted-foreground'
              )}
            />
            <Switch
              checked={autoShiftEnabled}
              onCheckedChange={toggleAutoShift}
              aria-label="Démarrage automatique du shift"
            />
          </div>
        </div>
        <CardDescription className="text-xs">
          Suivi live du shift en cours à partir des courses enregistrées ou
          importées.{' '}
          {autoShiftEnabled && (
            <span className="text-primary">Auto-shift actif.</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {snapshot ? (
          <ShiftSnapshotContent
            snapshot={snapshot}
            startedLabel={startedLabel}
            stats={stats}
            shiftRevenuePerHour={shiftRevenuePerHour}
            isSyncing={isSyncing}
            onEndShift={() => {
              void endShift();
            }}
          />
        ) : (
          <EmptyShiftContent onStartShift={startShift} />
        )}

        <p className={cn('text-[11px] leading-relaxed text-muted-foreground')}>
          Le suivi est calculé depuis les courses présentes dans la table
          `trips`. Le $/h en course utilise seulement la durée des trajets. Si
          tu ajoutes les courses plus tard, le résumé du shift se mettra à jour.
        </p>

        {lastShiftSummary && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">Résumé post-shift</p>
            <div className="mt-2 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>Précision estimée</span>
                <span className="font-semibold">
                  {lastShiftSummary.accuracyPercent}%
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Rythme en course</span>
                <span className="font-semibold">
                  {formatMoney(lastShiftSummary.revenuePerHour)}/h
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Meilleure zone</span>
                <span className="font-semibold">
                  {lastShiftSummary.bestZone ?? 'Pas assez de données'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                {lastShiftSummary.suggestedFocus}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
