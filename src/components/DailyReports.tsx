import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSessions } from '@/hooks/useSupabase';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { getDailyReportDisplayMetrics } from '@/lib/dailyReportDisplay';
import { useQuery } from '@tanstack/react-query';
import { Clock, FileText, MapPin, Sparkles } from 'lucide-react';
import { useMemo } from 'react';

type DailyReportRow = Tables<'daily_reports'>;
type TrackedReportMetrics = {
  hours: number;
  revenue: number;
  rides: number;
  shifts: number;
};

function formatReportDate(reportDate: string) {
  return new Date(`${reportDate}T12:00:00`).toLocaleDateString('fr-CA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function TrackedShiftSummary({ tracked }: { tracked: TrackedReportMetrics }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[12px] text-amber-100">
      {tracked.shifts} shift{tracked.shifts > 1 ? 's' : ''} tracké
      {tracked.shifts > 1 ? 's' : ''}: {tracked.hours.toFixed(1)} h · $
      {tracked.revenue.toFixed(0)} de revenu synchronisé
    </div>
  );
}

function ReportHighlights({ report }: { report: DailyReportRow }) {
  return (
    <>
      <div className="flex gap-3 text-[12px] text-muted-foreground">
        {report.best_zone_name && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3 text-green-400" />{' '}
            {report.best_zone_name}
          </span>
        )}
        {report.best_time_slot && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> {report.best_time_slot}
          </span>
        )}
      </div>
      {(report.dead_time_pct ?? 0) > 0 && (
        <div className="text-[12px] text-yellow-500">
          ⏱️ Temps mort: {Number(report.dead_time_pct).toFixed(0)}%
        </div>
      )}
      {report.ai_recommendation && (
        <div className="flex items-start gap-1.5 text-[12px] text-muted-foreground italic bg-primary/5 rounded px-2 py-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
          {report.ai_recommendation}
        </div>
      )}
    </>
  );
}

function DailyReportCard({
  report,
  tracked,
}: {
  report: DailyReportRow;
  tracked: TrackedReportMetrics | null;
}) {
  const displayMetrics = getDailyReportDisplayMetrics(report, tracked);

  return (
    <div className="bg-background rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-display font-bold">
          {formatReportDate(report.report_date)}
        </span>
        <Badge variant="secondary" className="text-xs">
          {displayMetrics.trips.toFixed(0)} courses
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <span className="text-[11px] text-muted-foreground block">Gains</span>
          <span className="text-[16px] font-display font-bold text-primary">
            ${displayMetrics.earnings.toFixed(0)}
          </span>
        </div>
        <div>
          <span className="text-[11px] text-muted-foreground block">
            Distance
          </span>
          <span className="text-[16px] font-display font-bold">
            {Number(report.total_distance_km || 0).toFixed(0)} km
          </span>
        </div>
        <div>
          <span className="text-[11px] text-muted-foreground block">
            {tracked && tracked.hours > 0
              ? 'Heures trackées'
              : 'Heures rapport'}
          </span>
          <span className="text-[16px] font-display font-bold">
            {displayMetrics.hours.toFixed(1)}h
          </span>
        </div>
      </div>
      {tracked && tracked.hours > 0 && (
        <TrackedShiftSummary tracked={tracked} />
      )}
      <ReportHighlights report={report} />
    </div>
  );
}

function getTrackedSessionHours(session: {
  total_hours: number | null;
  started_at: string;
  ended_at: string | null;
}) {
  const explicitHours = Number(session.total_hours ?? 0);
  if (explicitHours > 0) {
    return explicitHours;
  }

  if (!session.ended_at) {
    return 0;
  }

  const startedAt = new Date(session.started_at);
  const endedAt = new Date(session.ended_at);
  const durationMs = endedAt.getTime() - startedAt.getTime();

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  return durationMs / (1000 * 60 * 60);
}

function useReports() {
  return useQuery<DailyReportRow[]>({
    queryKey: ['daily-reports'],
    queryFn: async () => {
      // Without a lower bound, `order + limit` happily returns the 14 most
      // recent rows even if the newest is months old (e.g. the
      // generate-daily-report cron was never scheduled) — the UI would then
      // show stale data with no indication it isn't current. Bound the query
      // so a coverage gap surfaces as the honest "no report yet" empty state.
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 13);
      cutoff.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('daily_reports')
        .select('*')
        .gte('report_date', cutoff.toISOString().split('T')[0])
        .order('report_date', { ascending: false })
        .limit(14);
      if (error) throw error;
      return (data ?? []) as DailyReportRow[];
    },
  });
}

export function DailyReports() {
  const { data: reports = [] } = useReports();
  const sessionsSince = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 13);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }, []);
  const { data: sessions = [] } = useSessions(sessionsSince, 200);

  const trackedByDate = useMemo(() => {
    return sessions.reduce<Record<string, TrackedReportMetrics>>(
      (acc, session) => {
        const dateKey = session.started_at.split('T')[0];
        if (!dateKey) return acc;
        const current = acc[dateKey] ?? {
          hours: 0,
          revenue: 0,
          rides: 0,
          shifts: 0,
        };
        current.hours += getTrackedSessionHours(session);
        current.revenue += Number(session.total_earnings ?? 0);
        current.rides += Number(session.total_rides ?? 0);
        current.shifts += 1;
        acc[dateKey] = current;
        return acc;
      },
      {}
    );
  }, [sessions]);

  if (reports.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" /> Rapports quotidiens
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Aucun rapport généré. Les rapports sont créés automatiquement à
            23h30 chaque jour.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" /> Rapports quotidiens
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reports.map((report) => (
          <DailyReportCard
            key={report.id}
            report={report}
            tracked={trackedByDate[report.report_date] ?? null}
          />
        ))}
      </CardContent>
    </Card>
  );
}
