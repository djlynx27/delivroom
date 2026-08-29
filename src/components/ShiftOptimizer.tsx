/**
 * ShiftOptimizer
 *
 * Planning hebdomadaire IA pour chauffeur gig Montréal.
 * Recommande les meilleurs blocs horaires pour atteindre un objectif de revenus,
 * en s'appuyant sur les scores de demande (computeDemandScore) et le
 * feedback loop (EMA patterns + weight_history).
 *
 * Usage:
 *   <ShiftOptimizer cityId={cityId} targetWeeklyRevenue={800} />
 */

import { DemandBadge } from '@/components/DemandBadge';
import { useEmergingHotspots } from '@/hooks/useEmergingHotspots';
import { useZones, type Zone } from '@/hooks/useSupabase';
import { useTrips } from '@/hooks/useTrips';
import { useWeather } from '@/hooks/useWeather';
import { getDemandClass } from '@/lib/demandUtils';
import { deriveLearningInsights } from '@/lib/learningEngine';
import { computeDemandScore, type WeatherCondition } from '@/lib/scoringEngine';
import {
  blend,
  getRealAvgEarningsPerHour,
  MAX_EARNINGS_PER_HOUR,
  REAL_AVG_FULL_TRUST_AT_TRIPS,
  sanitizeTargetRevenueInput,
  scoreToEarningsPerH,
  type RealEarningsAverage,
} from '@/lib/shiftEarnings';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShiftBlock {
  dayLabel: string; // 'Lundi 23 mars'
  dayIndex: number; // 0=Mon … 6=Sun
  startHour: number;
  endHour: number;
  label: string; // 'Lundi 18h–22h'
  estimatedRevenue: number;
  avgScore: number;
  topZone: string;
  topZoneId: string;
  reason: string;
}

interface ShiftOptimizerProps {
  cityId: string;
  targetWeeklyRevenue?: number;
  className?: string;
}

// ── High-value time windows per day-of-week (0=Mon…6=Sun) ────────────────────
const PRIME_WINDOWS: Array<{ startHour: number; endHour: number }> = [
  { startHour: 6, endHour: 9 }, // Morning rush
  { startHour: 11, endHour: 14 }, // Midday
  { startHour: 16, endHour: 20 }, // Evening rush
  { startHour: 20, endHour: 24 }, // Nightlife
];

// Each window is offered as two variable-length shifts (1.5h/2h) instead of
// one rigid 3–4h block, so the optimizer can recommend a partial window when
// that's already enough to hit the target, and demand is sampled separately
// for each half so a later/earlier start can score differently.
const PRIME_BLOCKS: Array<{
  startHour: number;
  endHour: number;
  hours: number;
}> = PRIME_WINDOWS.flatMap(({ startHour, endHour }) => {
  const mid = startHour + (endHour - startHour) / 2;
  return [
    { startHour, endHour: mid, hours: mid - startHour },
    { startHour: mid, endHour, hours: endHour - mid },
  ];
});

const DAY_LABELS_FR = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];
const DOW_JS_TO_MON0 = [6, 0, 1, 2, 3, 4, 5]; // JS sun=0 → mon=0

function fmt(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, '0')}`;
}

function buildWeatherCondition(weather: ReturnType<typeof useWeather>['data']) {
  if (!weather) {
    return null;
  }

  return {
    weatherId: weather.weatherId,
    temp: weather.temp,
    demandBoostPoints: weather.demandBoostPoints,
  } satisfies WeatherCondition;
}

function getLearningAdjustedEarningsPerHour({
  bestScore,
  block,
  bestZoneId,
  learningInsights,
  jsDay,
  realAvg,
}: {
  bestScore: number;
  block: (typeof PRIME_BLOCKS)[number];
  bestZoneId: string;
  learningInsights: ReturnType<typeof deriveLearningInsights> | null;
  jsDay: number;
  realAvg: RealEarningsAverage | null;
}) {
  const conservativeDefault = scoreToEarningsPerH(bestScore);

  // Overall real average takes priority over the theoretical default once
  // there's enough logged history — trust scales with sample size so a
  // handful of trips doesn't fully override the conservative floor.
  const baseline = realAvg
    ? blend(
        realAvg.perHour,
        conservativeDefault,
        Math.min(1, realAvg.tripCount / REAL_AVG_FULL_TRUST_AT_TRIPS)
      )
    : conservativeDefault;

  if (!learningInsights) {
    return baseline;
  }

  const slotIdx = block.startHour * 4;
  const emaPattern = learningInsights.emaPatterns.find(
    (pattern) =>
      pattern.dayOfWeek === jsDay &&
      Math.abs(pattern.slotIndex - slotIdx) < 8 &&
      pattern.zoneId === bestZoneId
  );

  if (!emaPattern || emaPattern.observationCount < 2) {
    return baseline;
  }

  // Most granular real signal available (this exact zone/day/slot) —
  // outranks both the overall average and the theoretical default.
  const emaTrust = Math.min(0.85, emaPattern.observationCount * 0.1);
  return blend(emaPattern.emaEarningsPerHour, baseline, emaTrust);
}

function getBlockReason(startHour: number, dayIndex: number) {
  if (startHour >= 20) {
    return dayIndex >= 4
      ? 'Bars + nightlife (vendredi/samedi)'
      : 'Soirée demande modérée';
  }

  if (startHour >= 16) {
    return 'Rush heure de pointe soir';
  }

  if (startHour >= 11) {
    return 'Heure de lunch';
  }

  return 'Rush matinal';
}

function buildShiftBlock({
  date,
  dayIndex,
  block,
  bestScore,
  bestZoneName,
  bestZoneId,
  learningInsights,
  jsDay,
  realAvg,
}: {
  date: Date;
  dayIndex: number;
  block: (typeof PRIME_BLOCKS)[number];
  bestScore: number;
  bestZoneName: string;
  bestZoneId: string;
  learningInsights: ReturnType<typeof deriveLearningInsights> | null;
  jsDay: number;
  realAvg: RealEarningsAverage | null;
}): ShiftBlock {
  const earningsPerH = Math.min(
    MAX_EARNINGS_PER_HOUR,
    getLearningAdjustedEarningsPerHour({
      bestScore,
      block,
      bestZoneId,
      learningInsights,
      jsDay,
      realAvg,
    })
  );
  const estimatedRevenue = Math.round(earningsPerH * block.hours * 10) / 10;
  const dateLabel = date.toLocaleDateString('fr-CA', {
    day: 'numeric',
    month: 'short',
  });
  const dayName = DAY_LABELS_FR[dayIndex] ?? 'Jour';

  return {
    dayLabel: `${dayName} ${dateLabel}`,
    dayIndex,
    startHour: block.startHour,
    endHour: block.endHour,
    label: `${dayName} ${fmt(block.startHour)}–${fmt(block.endHour)}`,
    estimatedRevenue,
    avgScore: Math.round(bestScore),
    topZone: bestZoneName,
    topZoneId: bestZoneId,
    reason: getBlockReason(block.startHour, dayIndex),
  };
}

function findTopZoneForBlock({
  zones,
  slotDate,
  weatherCond,
}: {
  zones: Zone[];
  slotDate: Date;
  weatherCond: WeatherCondition | null;
}) {
  let bestScore = 0;
  let bestZoneName = '';
  let bestZoneId = '';

  for (const zone of zones) {
    const { score } = computeDemandScore(zone, slotDate, weatherCond);
    if (score > bestScore) {
      bestScore = score;
      bestZoneName = zone.name;
      bestZoneId = zone.id;
    }
  }

  return { bestScore, bestZoneName, bestZoneId };
}

function buildRecommendedBlocks({
  zones,
  weatherCond,
  learningInsights,
  realAvg,
}: {
  zones: Zone[];
  weatherCond: WeatherCondition | null;
  learningInsights: ReturnType<typeof deriveLearningInsights> | null;
  realAvg: RealEarningsAverage | null;
}) {
  if (zones.length === 0) {
    return [];
  }

  const today = new Date();
  const blocks: ShiftBlock[] = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(today);
    date.setDate(today.getDate() + dayOffset);
    const jsDay = date.getDay();
    const dayIndex = DOW_JS_TO_MON0[jsDay] ?? 0;

    for (const block of PRIME_BLOCKS) {
      const slotDate = new Date(date);
      const startH = Math.floor(block.startHour);
      const startM = Math.round((block.startHour - startH) * 60);
      slotDate.setHours(startH, startM, 0, 0);

      const { bestScore, bestZoneName, bestZoneId } = findTopZoneForBlock({
        zones,
        slotDate,
        weatherCond,
      });

      if (bestScore < 40) {
        continue;
      }

      blocks.push(
        buildShiftBlock({
          date,
          dayIndex,
          block,
          bestScore,
          bestZoneName,
          bestZoneId,
          learningInsights,
          jsDay,
          realAvg,
        })
      );
    }
  }

  return blocks
    .sort((first, second) => second.estimatedRevenue - first.estimatedRevenue)
    .slice(0, 28); // blocks are now half as long on average — keep the same hour coverage as before
}

function selectBlocksForTarget({
  recommended,
  targetRevenue,
}: {
  recommended: ShiftBlock[];
  targetRevenue: number;
}) {
  const selected: ShiftBlock[] = [];
  const hoursPerDay = new Map<number, number>();
  let accRevenue = 0;

  for (const block of recommended) {
    if (accRevenue >= targetRevenue) {
      break;
    }

    const dayHours = hoursPerDay.get(block.dayIndex) ?? 0;
    const blockHours = block.endHour - block.startHour;
    if (dayHours + blockHours > 10) {
      continue;
    }

    selected.push(block);
    hoursPerDay.set(block.dayIndex, dayHours + blockHours);
    accRevenue += block.estimatedRevenue;
  }

  return selected.sort((first, second) =>
    first.dayIndex !== second.dayIndex
      ? first.dayIndex - second.dayIndex
      : first.startHour - second.startHour
  );
}

function TargetRevenueControl({
  targetRevenue,
  setTargetRevenue,
}: {
  targetRevenue: number;
  setTargetRevenue: (value: number) => void;
}) {
  // Local text is the source of truth for what's displayed while editing —
  // it's the only way to represent "field is empty" without it being
  // immediately overwritten by the numeric value it maps to (0).
  const [raw, setRaw] = useState(String(targetRevenue));

  function handleChange(value: string) {
    const next = sanitizeTargetRevenueInput(value);
    setRaw(next);
    setTargetRevenue(next === '' ? 0 : Number(next));
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[12px] text-muted-foreground font-body">
        Objectif
      </span>
      <div className="flex items-center gap-0.5 bg-muted rounded-lg px-2 py-1">
        <span className="text-[13px] text-muted-foreground">$</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={raw}
          onChange={(e) => handleChange(e.target.value)}
          className="w-16 bg-transparent text-[14px] font-mono font-bold text-foreground outline-none"
        />
        <span className="text-[12px] text-muted-foreground">/sem</span>
      </div>
    </div>
  );
}

function ShiftOptimizerSummary({
  projectedRevenue,
  totalHours,
  gapToTarget,
}: {
  projectedRevenue: number;
  totalHours: number;
  gapToTarget: number;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-3 flex items-center gap-4">
      <div className="flex-1 text-center">
        <span className="text-[22px] font-mono font-bold text-primary leading-tight block">
          ${Math.round(projectedRevenue)}
        </span>
        <span className="text-[11px] text-muted-foreground font-body">
          projeté
        </span>
      </div>
      <div className="w-px h-10 bg-border" />
      <div className="flex-1 text-center">
        <span className="text-[22px] font-mono font-bold leading-tight block">
          {totalHours}h
        </span>
        <span className="text-[11px] text-muted-foreground font-body">
          heures planifiées
        </span>
      </div>
      <div className="w-px h-10 bg-border" />
      <div className="flex-1 text-center">
        <span
          className={cn(
            'text-[22px] font-mono font-bold leading-tight block',
            gapToTarget === 0 ? 'text-emerald-400' : 'text-orange-400'
          )}
        >
          {gapToTarget === 0 ? '✓' : `-$${Math.round(gapToTarget)}`}
        </span>
        <span className="text-[11px] text-muted-foreground font-body">
          {gapToTarget === 0 ? 'objectif atteint' : 'manquant'}
        </span>
      </div>
    </div>
  );
}

function ShiftBlocksList({ selectedBlocks }: { selectedBlocks: ShiftBlock[] }) {
  if (selectedBlocks.length === 0) {
    return (
      <p className="text-center text-[14px] text-muted-foreground font-body py-4">
        Aucun shift recommandé — ajustez votre objectif.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {selectedBlocks.map((block, index) => {
        const demandClass = getDemandClass(block.avgScore);

        return (
          <div
            key={`${block.dayIndex}-${block.startHour}`}
            className={cn(
              'bg-card rounded-xl border-l-4 border border-border p-3',
              demandClass.border
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {index === 0 && (
                    <span className="text-[10px] font-bold bg-primary/20 text-primary rounded px-1.5 py-0.5">
                      TOP
                    </span>
                  )}
                  <span className="text-[15px] font-display font-bold leading-tight">
                    {block.label}
                  </span>
                </div>
                <span className="text-[13px] text-primary font-body block mt-0.5">
                  📍 {block.topZone}
                </span>
                <span className="text-[12px] text-muted-foreground font-body">
                  {block.reason}
                </span>
              </div>
              <div className="text-right flex-shrink-0 space-y-1">
                <DemandBadge score={block.avgScore} size="sm" />
                <span className="text-[14px] font-mono font-bold text-foreground block">
                  ~${block.estimatedRevenue}
                </span>
                <span className="text-[11px] text-muted-foreground font-body block">
                  ({fmt(block.endHour - block.startHour)})
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmergingHotspotsSection({
  hotspots,
}: {
  hotspots: ReturnType<typeof useEmergingHotspots>['data'];
}) {
  if (!hotspots || hotspots.length === 0) return null;

  return (
    <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 space-y-1.5">
      <p className="text-[12px] font-display font-bold text-primary">
        🆕 Hotspots émergents (hors zones connues)
      </p>
      {hotspots.slice(0, 3).map((hotspot) => (
        <p key={hotspot.id} className="text-[12px] text-muted-foreground font-body">
          {hotspot.address} · vu {hotspot.occurrenceCount}×
        </p>
      ))}
    </div>
  );
}

function LearningCalibrationFooter({
  learningInsights,
}: {
  learningInsights: ReturnType<typeof deriveLearningInsights> | null;
}) {
  if (!learningInsights || learningInsights.predictions.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl bg-muted/40 border border-border/50 p-3">
      <p className="text-[12px] text-muted-foreground font-body text-center">
        📊 Calibré sur {learningInsights.predictions.length} courses · Précision
        :{' '}
        <span className="text-foreground font-semibold">
          {Math.round(learningInsights.accuracyPercent)}%
        </span>{' '}
        · MAE{' '}
        <span className="text-foreground font-semibold">
          ${Math.round(learningInsights.meanAbsoluteError)}/h
        </span>
      </p>
    </div>
  );
}

export function ShiftOptimizer({
  cityId,
  targetWeeklyRevenue = 700,
  className,
}: ShiftOptimizerProps) {
  const [targetRevenue, setTargetRevenue] = useState(targetWeeklyRevenue);
  const { data: zones = [] } = useZones(cityId);
  const { data: weather } = useWeather(cityId);
  const { data: trips = [] } = useTrips(300, undefined, true, true);
  const { data: emergingHotspots } = useEmergingHotspots();

  const weatherCond: WeatherCondition | null = useMemo(
    () => buildWeatherCondition(weather),
    [weather]
  );

  // Derive EMA patterns from trip history for $/h estimates
  const learningInsights = useMemo(() => {
    if (trips.length === 0) return null;
    return deriveLearningInsights(trips);
  }, [trips]);

  // Overall real $/h average across logged trips — calibrates the fallback
  // estimate used wherever the per-zone/day/slot EMA has too few (or zero)
  // observations, instead of always falling through to the theoretical curve.
  const realAvg = useMemo(() => getRealAvgEarningsPerHour(trips), [trips]);

  // Build the next 7-day optimized schedule
  const recommended = useMemo(
    () => buildRecommendedBlocks({ zones, weatherCond, learningInsights, realAvg }),
    [zones, weatherCond, learningInsights, realAvg]
  );

  // Greedy selection: pick blocks until target met, no day-overlap > 8h
  const selectedBlocks = useMemo(
    () => selectBlocksForTarget({ recommended, targetRevenue }),
    [recommended, targetRevenue]
  );

  const projectedRevenue = selectedBlocks.reduce(
    (s, b) => s + b.estimatedRevenue,
    0
  );
  const totalHours = selectedBlocks.reduce(
    (s, b) => s + (b.endHour - b.startHour),
    0
  );
  const gapToTarget = Math.max(0, targetRevenue - projectedRevenue);
  // Reverse calculation: hours realistically needed at the market cap, rather
  // than dividing the target evenly across rigid blocks.
  const requiredHours =
    targetRevenue > 0 ? Math.ceil(targetRevenue / MAX_EARNINGS_PER_HOUR) : 0;

  if (zones.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl bg-card border border-border p-4 text-center',
          className
        )}
      >
        <p className="text-muted-foreground text-[14px] font-body">
          Chargement des zones…
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header + target input */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-[16px] font-display font-bold">
            Planning IA — Semaine
          </h2>
          <p className="text-[12px] text-muted-foreground font-body">
            ≈{fmt(requiredHours)} nécessaires (max ${MAX_EARNINGS_PER_HOUR}/h)
          </p>
        </div>
        <TargetRevenueControl
          targetRevenue={targetRevenue}
          setTargetRevenue={setTargetRevenue}
        />
      </div>

      <ShiftOptimizerSummary
        projectedRevenue={projectedRevenue}
        totalHours={totalHours}
        gapToTarget={gapToTarget}
      />

      <ShiftBlocksList selectedBlocks={selectedBlocks} />

      <EmergingHotspotsSection hotspots={emergingHotspots} />

      <LearningCalibrationFooter learningInsights={learningInsights} />
    </div>
  );
}
