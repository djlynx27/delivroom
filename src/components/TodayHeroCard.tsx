import { DemandBadge } from '@/components/DemandBadge';
import { GoogleMapsIcon, WazeIcon } from '@/components/NavIcons';
import { ScoreFactorIcons } from '@/components/ScoreFactorIcons';
import { SwipeToAccept } from '@/components/SwipeToAccept';
import { Button } from '@/components/ui/button';
import type { ScoreFactors } from '@/hooks/useDemandScores';
import { getGoogleMapsNavUrl, getWazeNavUrl } from '@/lib/hotspots';
import { Clock } from 'lucide-react';

interface HeroZone {
  id: string;
  name: string;
  type: string;
  score: number;
  latitude: number;
  longitude: number;
}

interface TodayHeroCardProps {
  driverMode: 'rideshare' | 'delivery' | 'all';
  start: string;
  end: string;
  bestZoneLabel: string;
  loadingLabel: string;
  heroZone: HeroZone | null;
  heroFactors?: ScoreFactors;
  heroDistance: number | null;
  isInVehicle: boolean;
  formatMoney: (value: number) => string;
}

function getHeroTitle({
  driverMode,
  bestZoneLabel,
}: {
  driverMode: TodayHeroCardProps['driverMode'];
  bestZoneLabel: string;
}) {
  if (driverMode === 'rideshare') {
    return '🚗 Meilleure zone passagers';
  }

  if (driverMode === 'delivery') {
    return '📦 Meilleure zone livraison';
  }

  return bestZoneLabel;
}

function HeroFactorsSummary({
  heroFactors,
  formatMoney,
}: {
  heroFactors: ScoreFactors | undefined;
  formatMoney: (value: number) => string;
}) {
  const factorModel = buildHeroFactorModel(heroFactors);

  return (
    <>
      <ScoreFactorIcons factors={heroFactors} />
      <LearningBoostLine
        learningBoostPoints={factorModel.learningBoostPoints}
        learningSimilarity={factorModel.learningSimilarity}
        learningAvgEarningsPerHour={factorModel.learningAvgEarningsPerHour}
        formatMoney={formatMoney}
      />
      <HabitBoostLine
        habitBoostPercent={factorModel.habitBoostPercent}
        habitSimilarity={factorModel.habitSimilarity}
      />
      <SuccessProbabilityLine
        successProbability={factorModel.successProbability}
        driverSupplyEstimate={factorModel.driverSupplyEstimate}
        proximityFactor={factorModel.proximityFactor}
      />
    </>
  );
}

function buildHeroFactorModel(heroFactors: ScoreFactors | undefined) {
  return {
    learningBoostPoints: Number(heroFactors?.learningBoostPoints ?? 0),
    learningSimilarity: heroFactors?.learningSimilarity ?? 0,
    learningAvgEarningsPerHour: heroFactors?.learningAvgEarningsPerHour ?? 0,
    habitBoostPercent: Number(heroFactors?.habitBoostPercent ?? 0),
    habitSimilarity: heroFactors?.habitSimilarity ?? 0,
    successProbability: heroFactors?.successProbability,
    driverSupplyEstimate: heroFactors?.driverSupplyEstimate,
    proximityFactor: heroFactors?.proximityFactor,
  };
}

function LearningBoostLine({
  learningBoostPoints,
  learningSimilarity,
  learningAvgEarningsPerHour,
  formatMoney,
}: {
  learningBoostPoints: number;
  learningSimilarity: number;
  learningAvgEarningsPerHour: number;
  formatMoney: (value: number) => string;
}) {
  if (learningBoostPoints <= 0) {
    return null;
  }

  return (
    <span className="text-[13px] text-primary/90 font-body block mt-1">
      {`IA contextuelle +${learningBoostPoints} pts · similarité ${Math.round(learningSimilarity * 100)}% · historique ${formatMoney(learningAvgEarningsPerHour)}/h`}
    </span>
  );
}

function HabitBoostLine({
  habitBoostPercent,
  habitSimilarity,
}: {
  habitBoostPercent: number;
  habitSimilarity: number;
}) {
  if (habitBoostPercent <= 0) {
    return null;
  }

  return (
    <span className="text-[13px] text-blue-500 font-body block mt-1">
      {`Habitude perso +${habitBoostPercent}% · similarité ${Math.round(habitSimilarity * 100)}%`}
    </span>
  );
}

function SuccessProbabilityLine({
  successProbability,
  driverSupplyEstimate,
  proximityFactor,
}: {
  successProbability: number | null | undefined;
  driverSupplyEstimate: number | null | undefined;
  proximityFactor: number | null | undefined;
}) {
  if (successProbability == null) {
    return null;
  }

  return (
    <span className="text-[13px] text-muted-foreground font-body block mt-1">
      {`Probabilité de succès ${Math.round(successProbability * 100)}% · offre chauffeurs ${driverSupplyEstimate?.toFixed(1) ?? '0.0'} · proximité ${Math.round((proximityFactor ?? 0) * 100)}%`}
    </span>
  );
}

function HeroNavigationButtons({ heroZone }: { heroZone: HeroZone }) {
  return (
    <>
      <Button
        asChild
        className="w-full h-16 text-[18px] font-display font-bold gap-2.5 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <a
          href={getGoogleMapsNavUrl(
            heroZone.name,
            heroZone.latitude,
            heroZone.longitude
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          <GoogleMapsIcon className="w-6 h-6 flex-shrink-0" /> Google Maps
        </a>
      </Button>
      <Button
        asChild
        variant="secondary"
        className="w-full h-16 text-[18px] font-display font-bold gap-2.5"
      >
        <a
          href={getWazeNavUrl(
            heroZone.name,
            heroZone.latitude,
            heroZone.longitude
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          <WazeIcon className="w-6 h-6 flex-shrink-0" /> Waze
        </a>
      </Button>
    </>
  );
}

function HeroVehicleSwipe({ heroZone }: { heroZone: HeroZone }) {
  return (
    <SwipeToAccept
      label="Glisser → confirmer direction"
      onAccept={() => {
        window.open(
          getGoogleMapsNavUrl(
            heroZone.name,
            heroZone.latitude,
            heroZone.longitude
          ),
          '_blank'
        );
      }}
    />
  );
}

function HeroZoneContent({
  heroZone,
  heroFactors,
  heroDistance,
  formatMoney,
}: {
  heroZone: HeroZone;
  heroFactors: ScoreFactors | undefined;
  heroDistance: number | null;
  formatMoney: (value: number) => string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <h2 className="text-[28px] font-display font-bold leading-tight break-words">
          {heroZone.name}
        </h2>
        <span className="text-[16px] text-muted-foreground capitalize block mt-0.5">
          {heroZone.type}
          <HeroFactorsSummary
            heroFactors={heroFactors}
            formatMoney={formatMoney}
          />
        </span>
        {heroDistance !== null && (
          <span className="text-[20px] font-display font-semibold text-muted-foreground mt-1 block">
            📍 {heroDistance.toFixed(1)} km
          </span>
        )}
      </div>
      <DemandBadge score={heroZone.score} size="giant" />
    </div>
  );
}

export function TodayHeroCard({
  driverMode,
  start,
  end,
  bestZoneLabel,
  loadingLabel,
  heroZone,
  heroFactors,
  heroDistance,
  isInVehicle,
  formatMoney,
}: TodayHeroCardProps) {
  const heroTitle = getHeroTitle({ driverMode, bestZoneLabel });

  return (
    <div className="px-3 mt-2">
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-[14px] text-muted-foreground font-body uppercase tracking-wide">
            {heroTitle} · {start}–{end}
          </span>
        </div>

        {heroZone ? (
          <HeroZoneContent
            heroZone={heroZone}
            heroFactors={heroFactors}
            heroDistance={heroDistance}
            formatMoney={formatMoney}
          />
        ) : (
          <p className="text-[18px] font-body text-muted-foreground">
            {loadingLabel}
          </p>
        )}

        {heroZone && (
          <div className="mt-4 space-y-2">
            <HeroNavigationButtons heroZone={heroZone} />
            {isInVehicle && <HeroVehicleSwipe heroZone={heroZone} />}
          </div>
        )}
      </div>
    </div>
  );
}
