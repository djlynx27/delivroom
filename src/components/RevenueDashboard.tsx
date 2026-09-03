import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { useSessions } from '@/hooks/useSupabase';
import { useTrips } from '@/hooks/useTrips';
import {
  aggregateTripAnalytics,
  summarizeTrackedSessions,
} from '@/lib/tripAnalytics';
import { BarChart3, Clock3, MapPin, Smartphone, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';

function formatMoney(value: number) {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
}

const chartConfig = {
  revenue: { label: 'Revenu', color: '#22c55e' },
  rides: { label: 'Courses', color: '#0ea5e9' },
  Nuit: { label: 'Nuit', color: '#1d4ed8' },
  Matin: { label: 'Matin', color: '#06b6d4' },
  'Après-midi': { label: 'Après-midi', color: '#f59e0b' },
  Soir: { label: 'Soir', color: '#ef4444' },
} as const;

type RevenueAnalytics = ReturnType<typeof aggregateTripAnalytics>;
type TrackedSessionsSummary = ReturnType<typeof summarizeTrackedSessions>;

function buildRevenueKpis({
  analytics,
  tracked30Days,
}: {
  analytics: RevenueAnalytics;
  tracked30Days: TrackedSessionsSummary;
}) {
  return [
    {
      label: '7 derniers jours',
      value: formatMoney(analytics.last7Days.revenue),
      helper: `${analytics.last7Days.rides} courses`,
      icon: Wallet,
    },
    {
      label: '$/h en course sur 30 jours',
      value: formatMoney(analytics.last30Days.revenuePerHour),
      helper: `${analytics.last30Days.hours.toFixed(1)} h en course`,
      icon: Clock3,
    },
    {
      label: '$/h shift tracké',
      value: formatMoney(tracked30Days.revenuePerHour),
      helper:
        tracked30Days.shiftCount > 0
          ? `${tracked30Days.hours.toFixed(1)} h sur ${tracked30Days.shiftCount} shift${tracked30Days.shiftCount > 1 ? 's' : ''}`
          : 'Aucun shift terminé et syncé',
      icon: Clock3,
    },
    {
      label: 'Ticket moyen',
      value: formatMoney(analytics.last30Days.averageRide),
      helper: analytics.bestPlatform ?? 'Plateforme non précisée',
      icon: Smartphone,
    },
    {
      label: 'Meilleure zone',
      value: analytics.bestZone ?? 'Aucune donnée',
      helper: `${formatMoney(analytics.zoneSeries[0]?.revenue ?? 0)} sur 30 jours`,
      icon: MapPin,
    },
  ];
}

function RevenueDashboardEmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background/50 p-4 text-sm text-muted-foreground">
      Aucun trajet disponible pour construire le dashboard. Ajoute des courses
      ou importe un CSV pour démarrer l'analyse.
    </div>
  );
}

function RevenueKpiGrid({
  kpis,
}: {
  kpis: ReturnType<typeof buildRevenueKpis>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="rounded-xl border border-border bg-background p-3"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <kpi.icon className="h-3.5 w-3.5" />
            {kpi.label}
          </div>
          <p className="mt-1 text-lg font-semibold font-display leading-tight">
            {kpi.value}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{kpi.helper}</p>
        </div>
      ))}
    </div>
  );
}

function DailyRevenueChart({ analytics }: { analytics: RevenueAnalytics }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3">
        <h3 className="font-display font-semibold">Revenus par jour</h3>
        <p className="text-xs text-muted-foreground">
          Les 7 derniers jours, pour visualiser le rythme récent.
        </p>
      </div>
      <ChartContainer config={chartConfig} className="h-[220px] w-full">
        <LineChart data={analytics.dailySeries}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis
            tickFormatter={(value) => `$${value}`}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            type="monotone"
            dataKey="revenue"
            stroke="var(--color-revenue)"
            strokeWidth={3}
            dot={{ fill: 'var(--color-revenue)' }}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function TopZonesChart({ analytics }: { analytics: RevenueAnalytics }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3">
        <h3 className="font-display font-semibold">Top zones</h3>
        <p className="text-xs text-muted-foreground">
          Revenu cumulé sur 30 jours, trié par rentabilité réelle.
        </p>
      </div>
      <ChartContainer config={chartConfig} className="h-[220px] w-full">
        <BarChart
          data={analytics.zoneSeries}
          layout="vertical"
          margin={{ left: 12 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={90}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="revenue" fill="var(--color-revenue)" radius={8} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

function DaypartRevenueChart({ analytics }: { analytics: RevenueAnalytics }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3">
        <h3 className="font-display font-semibold">Répartition par créneau</h3>
        <p className="text-xs text-muted-foreground">
          Où se concentre ton revenu selon l'heure de départ des courses.
        </p>
      </div>
      <ChartContainer config={chartConfig} className="h-[220px] w-full">
        <PieChart>
          <Pie
            data={analytics.daypartSeries}
            dataKey="revenue"
            nameKey="label"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
          >
            {analytics.daypartSeries.map((entry) => (
              <Cell key={entry.label} fill={`var(--color-${entry.label})`} />
            ))}
          </Pie>
          <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
        </PieChart>
      </ChartContainer>
    </div>
  );
}

function RevenueQuickRead({ analytics }: { analytics: RevenueAnalytics }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3">
        <h3 className="font-display font-semibold">Lecture rapide</h3>
        <p className="text-xs text-muted-foreground">
          Trois signaux directement exploitables sur la route.
        </p>
      </div>
      <div className="space-y-2 text-sm">
        <div className="rounded-lg border border-border p-3">
          <p className="text-muted-foreground text-xs">Zone la plus rentable</p>
          <p className="font-medium mt-1">
            {analytics.bestZone ?? 'Pas encore de signal fort'}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-muted-foreground text-xs">
            Plateforme la plus rentable
          </p>
          <p className="font-medium mt-1">
            {analytics.bestPlatform ?? 'Pas encore de signal fort'}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-muted-foreground text-xs">Créneau dominant</p>
          {/* daypartSeries always has 4 fixed buckets (Nuit/Matin/Après-midi/Soir),
              so [0] is never undefined — even with zero trips in the window it
              would otherwise silently show "Nuit" with $0 as if it were a real
              signal. Gate on revenue instead of presence. */}
          <p className="font-medium mt-1">
            {(analytics.daypartSeries[0]?.revenue ?? 0) > 0
              ? analytics.daypartSeries[0]?.label
              : 'Pas encore de signal fort'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatMoney(analytics.daypartSeries[0]?.revenue ?? 0)} cumulés sur
            30 jours.
          </p>
        </div>
      </div>
    </div>
  );
}

export function RevenueDashboard() {
  const { data: trips = [] } = useTrips({ limit: 500 });
  const sessionsSince = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }, []);
  const { data: sessions = [] } = useSessions(sessionsSince, 300);
  const analytics = useMemo(() => aggregateTripAnalytics(trips), [trips]);
  const tracked30Days = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return summarizeTrackedSessions(sessions, start, new Date());
  }, [sessions]);
  const kpis = buildRevenueKpis({ analytics, tracked30Days });

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" /> Dashboard revenus
        </CardTitle>
        <CardDescription className="text-xs">
          Vue synthétique des 30 derniers jours à partir de la table `trips`.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          Le taux horaire affiché ici repose sur la durée des trajets présents
          dans `trips`, pas sur l’intégralité du temps de shift ou d’attente.
        </div>

        {trips.length === 0 ? (
          <RevenueDashboardEmptyState />
        ) : (
          <>
            <RevenueKpiGrid kpis={kpis} />

            <div className="grid gap-4 lg:grid-cols-2">
              <DailyRevenueChart analytics={analytics} />
              <TopZonesChart analytics={analytics} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <DaypartRevenueChart analytics={analytics} />
              <RevenueQuickRead analytics={analytics} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
