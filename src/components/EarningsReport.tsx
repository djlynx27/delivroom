/**
 * EarningsReport
 *
 * Rapport multi-plateforme et multi-zone pour le chauffeur.
 * Sections :
 *   1. Métriques clés (7j / 30j)
 *   2. Revenus par plateforme (barres horizontales)
 *   3. Top zones (barres horizontales)
 *   4. Tendance journalière (7j sparkline bars)
 *   5. Calibration ML — poids actuels du modèle (depuis weight-calibrator EF)
 *
 * Usage:
 *   <EarningsReport trips={trips} />
 */

import { PLATFORM_META } from '@/hooks/usePlatformSignals';
import { useSessions } from '@/hooks/useSupabase';
import { useTrips } from '@/hooks/useTrips';
import { supabase } from '@/integrations/supabase/client';
import {
  aggregateTripAnalytics,
  type MetricSummary,
  summarizeTrackedSessions,
} from '@/lib/tripAnalytics';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface WeightSnapshot {
  w_time: number;
  w_day: number;
  w_weather: number;
  w_events: number;
  w_historical: number;
  mae: number;
  accuracy_pct: number;
  created_at: string;
}

// ── Tiny utilities ─────────────────────────────────────────────────────────────

function r(n: number, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function pct(value: number, max: number) {
  return max > 0 ? Math.round((value / max) * 100) : 0;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex-1 min-w-0 bg-background rounded-xl border border-border p-3 text-center space-y-0.5">
      <p className="text-[11px] text-muted-foreground font-body leading-tight">
        {label}
      </p>
      <p className="text-[20px] font-mono font-bold leading-tight">{value}</p>
      {sub && (
        <p className="text-[11px] text-muted-foreground font-body">{sub}</p>
      )}
    </div>
  );
}

function HorizontalBar({
  label,
  value,
  max,
  color,
  sub,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  sub?: string;
}) {
  const width = pct(value, max);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-body text-foreground truncate max-w-[9rem]">
          {label}
        </span>
        <span className="font-mono font-semibold">${r(value)}/h</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            color
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      {sub && (
        <p className="text-[10px] text-muted-foreground font-body">{sub}</p>
      )}
    </div>
  );
}

function WeightBar({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: string;
}) {
  const width = Math.round(value * 100);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-body text-muted-foreground">
          {icon} {label}
        </span>
        <span className="font-mono">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary/70 rounded-full transition-all duration-700"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface EarningsReportProps {
  className?: string;
}

export function EarningsReport({ className }: EarningsReportProps) {
  const { data: trips = [] } = useTrips({ limit: 400 });
  const sessionsSince = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }, []);
  const { data: sessions = [] } = useSessions(sessionsSince, 300);
  const [weights, setWeights] = useState<WeightSnapshot | null>(null);

  // Fetch current ML weights from weight-calibrator Edge Function
  useEffect(() => {
    const ctrl = new AbortController();
    const timeoutId = window.setTimeout(() => ctrl.abort(), 8000);

    async function fetchWeights() {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session?.session?.access_token ?? '';
        const projectRef =
          (
            import.meta as unknown as { env: Record<string, string> }
          ).env.VITE_SUPABASE_URL?.replace('https://', '').split('.')[0] ?? '';
        const url = `https://${projectRef}.supabase.co/functions/v1/weight-calibrator`;
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = (await res.json()) as WeightSnapshot;
          setWeights(json);
        }
      } catch {
        // Not critical — display without weights
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void fetchWeights();
    return () => {
      window.clearTimeout(timeoutId);
      ctrl.abort();
    };
  }, []);

  const analytics = useMemo(() => aggregateTripAnalytics(trips), [trips]);
  const tracked7Days = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return summarizeTrackedSessions(sessions, start, new Date());
  }, [sessions]);
  const tracked30Days = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return summarizeTrackedSessions(sessions, start, new Date());
  }, [sessions]);

  const { last7Days, last30Days, platformSeries, zoneSeries, dailySeries } =
    analytics;

  const maxPlatformRPH = Math.max(
    ...platformSeries.map((p) => p.revenuePerHour ?? 0),
    1
  );
  const maxZoneRPH = Math.max(
    ...zoneSeries.map((z) => z.revenuePerHour ?? 0),
    1
  );
  const maxDailyRev = Math.max(...dailySeries.map((d) => d.revenue), 1);

  function MetricSection({ title, m }: { title: string; m: MetricSummary }) {
    return (
      <div className="space-y-1.5">
        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide px-0.5">
          {title}
        </h4>
        <div className="flex gap-2">
          <MetricCard
            label="Revenus"
            value={`$${r(m.revenue)}`}
            sub={`${m.rides} courses`}
          />
          <MetricCard
            label="$/h en course"
            value={`$${r(m.revenuePerHour)}`}
            sub={`${r(m.hours)}h en course`}
          />
          <MetricCard
            label="Avg / course"
            value={`$${r(m.averageRide)}`}
            sub={`${r(m.distanceKm)} km`}
          />
        </div>
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl bg-card border border-border p-6 text-center text-muted-foreground text-sm font-body',
          className
        )}
      >
        Aucune course enregistrée. Ajoutez des courses pour voir le rapport.
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* ── 7j & 30j metrics ── */}
      <MetricSection title="7 derniers jours" m={last7Days} />
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-background p-3 text-sm">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            7 derniers jours · shift tracké
          </p>
          <p className="mt-1 text-lg font-semibold font-display">
            ${r(tracked7Days.revenuePerHour)}/h
          </p>
          <p className="text-[11px] text-muted-foreground">
            {tracked7Days.shiftCount > 0
              ? `${tracked7Days.hours.toFixed(1)} h trackées · ${r(tracked7Days.revenue)}$ de revenu`
              : 'Aucun shift terminé et synchronisé sur la période'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-background p-3 text-sm">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            30 derniers jours · shift tracké
          </p>
          <p className="mt-1 text-lg font-semibold font-display">
            ${r(tracked30Days.revenuePerHour)}/h
          </p>
          <p className="text-[11px] text-muted-foreground">
            {tracked30Days.shiftCount > 0
              ? `${tracked30Days.hours.toFixed(1)} h trackées · ${r(tracked30Days.revenue)}$ de revenu`
              : 'Aucun shift terminé et synchronisé sur la période'}
          </p>
        </div>
      </div>
      <MetricSection title="30 derniers jours" m={last30Days} />

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
        Les métriques horaires de ce rapport utilisent la somme des durées de
        trajets présentes dans `trips`. Les cartes “shift tracké” ci-dessus
        utilisent les sessions réellement terminées et synchronisées.
      </div>

      {/* ── Daily sparkline ── */}
      <div className="space-y-1.5">
        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide px-0.5">
          Revenus journaliers (7j)
        </h4>
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-end gap-1.5 h-16">
            {dailySeries.map((day) => {
              const h = pct(day.revenue, maxDailyRev);
              return (
                <div
                  key={day.label}
                  className="flex-1 flex flex-col items-center gap-0.5"
                >
                  <div
                    className="w-full flex flex-col justify-end"
                    style={{ height: '52px' }}
                  >
                    <div
                      className="w-full rounded-t bg-primary/70 transition-all duration-500"
                      style={{ height: `${Math.max(3, h)}%` }}
                      title={`${day.label}: $${r(day.revenue)}`}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground font-body">
                    {day.label.slice(0, 3)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Platform $/h ── */}
      {platformSeries.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide px-0.5">
            Revenus/h en course par plateforme
          </h4>
          <div className="bg-card rounded-xl border border-border p-3 space-y-3">
            {platformSeries
              .filter((p) => p.revenuePerHour !== null)
              .map((p) => {
                const rph = p.revenuePerHour as number;
                const meta =
                  (
                    PLATFORM_META as Record<
                      string,
                      | (typeof PLATFORM_META)[keyof typeof PLATFORM_META]
                      | undefined
                    >
                  )[p.label.toLowerCase()] ?? null;
                const color = meta?.color ?? 'bg-primary';
                return (
                  <HorizontalBar
                    key={p.label}
                    label={meta ? `${meta.emoji} ${meta.label}` : p.label}
                    value={rph}
                    max={maxPlatformRPH}
                    color={color}
                    sub={`$${r(p.revenue)} · ${r(p.hours)}h · ${p.rides} courses`}
                  />
                );
              })}
          </div>
        </div>
      )}

      {/* ── Zone $/h ── */}
      {zoneSeries.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide px-0.5">
            Top zones rentables en course
          </h4>
          <div className="bg-card rounded-xl border border-border p-3 space-y-3">
            {zoneSeries
              .filter((z) => z.revenuePerHour !== null)
              .slice(0, 8)
              .map((z) => (
                <HorizontalBar
                  key={z.label}
                  label={`📍 ${z.label}`}
                  value={z.revenuePerHour as number}
                  max={maxZoneRPH}
                  color="bg-emerald-500"
                  sub={`$${r(z.revenue)} · ${r(z.hours)}h · ${z.rides} courses`}
                />
              ))}
          </div>
        </div>
      )}

      {/* ── ML weight calibration ── */}
      {weights && (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide px-0.5">
            Calibration IA — poids du modèle
          </h4>
          <div className="bg-card rounded-xl border border-border p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-body">
                Précision {Math.round(weights.accuracy_pct)}% · MAE $
                {r(weights.mae)}/h
              </span>
              <span className="text-[10px] text-muted-foreground font-body">
                {new Date(weights.created_at).toLocaleDateString('fr-CA')}
              </span>
            </div>
            <WeightBar label="Heure du jour" value={weights.w_time} icon="🕐" />
            <WeightBar
              label="Jour de semaine"
              value={weights.w_day}
              icon="📅"
            />
            <WeightBar label="Météo" value={weights.w_weather} icon="🌧" />
            <WeightBar label="Événements" value={weights.w_events} icon="🎭" />
            <WeightBar
              label="Historique"
              value={weights.w_historical}
              icon="📊"
            />
          </div>
        </div>
      )}
    </div>
  );
}
