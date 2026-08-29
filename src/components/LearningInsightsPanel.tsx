import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTrips, type TripWithZone } from '@/hooks/useTrips';
import { deriveLearningInsights } from '@/lib/learningEngine';
import {
  findSimilarContextsForTrip,
  syncLearningAggregates,
} from '@/lib/learningSync';
import { DEFAULT_WEIGHTS } from '@/lib/scoringEngine';
import { useQuery } from '@tanstack/react-query';
import { BrainCircuit, Radar, Scale, Sparkles, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

type LearningInsights = ReturnType<typeof deriveLearningInsights>;
type SimilarContextsResult = Awaited<
  ReturnType<typeof findSimilarContextsForTrip>
>;

function formatMoney(value: number) {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
}

function LearningInsightsEmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background/50 p-4 text-sm text-muted-foreground">
      Ajoute des courses pour amorcer l’apprentissage. Le moteur commencera
      alors à suivre l’erreur moyenne, les zones fortes par créneau et les
      ajustements de poids suggérés.
    </div>
  );
}

function LearningSummaryCards({ insights }: { insights: LearningInsights }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Target className="h-3.5 w-3.5" /> Précision estimée
        </div>
        <p className="mt-1 text-lg font-semibold font-display">
          {insights.accuracyPercent}%
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          MAE de {insights.meanAbsoluteError} points sur{' '}
          {insights.predictions.length} prédictions.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Radar className="h-3.5 w-3.5" /> Patterns EMA
        </div>
        <p className="mt-1 text-lg font-semibold font-display">
          {insights.emaPatterns.length}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Combinaisons zone × jour × créneau déjà apprises.
        </p>
      </div>
    </div>
  );
}

function LearnedZonesSection({ insights }: { insights: LearningInsights }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <h3 className="font-display font-semibold">Top zones apprises</h3>
      <div className="mt-3 space-y-2">
        {insights.topLearnedZones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Pas assez d’observations pour classer les zones.
          </p>
        ) : (
          insights.topLearnedZones.map((zone, index) => (
            <div
              key={`${zone.zoneId}-${zone.observationCount}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">
                  {index === 0 ? '⭐ ' : ''}
                  {zone.zoneName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {zone.observationCount} observation
                  {zone.observationCount > 1 ? 's' : ''}
                </p>
              </div>
              <span className="text-sm font-semibold font-display">
                {formatMoney(zone.emaEarningsPerHour)}/h
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatSimilarContextDate(createdAt: string) {
  return new Date(createdAt).toLocaleDateString('fr-CA', {
    month: 'short',
    day: 'numeric',
  });
}

function SimilarContextsMatches({
  similarContexts,
}: {
  similarContexts: SimilarContextsResult;
}) {
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">Gain horaire moyen</p>
          <p className="mt-1 text-lg font-semibold font-display">
            {formatMoney(similarContexts.averageEarningsPerHour)}/h
          </p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">Similarité moyenne</p>
          <p className="mt-1 text-lg font-semibold font-display">
            {(similarContexts.averageSimilarity * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {similarContexts.matches.map((match, index) => (
          <div
            key={match.id}
            className="rounded-lg border border-border px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">
                {index === 0 ? 'Meilleur match' : `Match ${index + 1}`}
              </span>
              <span className="text-xs font-semibold text-primary">
                {(match.similarity * 100).toFixed(0)}%
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatMoney(match.actualEarningsPerHour)}/h observés le{' '}
              {formatSimilarContextDate(match.createdAt)}.
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

function SimilarContextsSection({
  anchorTrip,
  isLoadingSimilarContexts,
  similarContexts,
}: {
  anchorTrip: TripWithZone | null;
  isLoadingSimilarContexts: boolean;
  similarContexts: SimilarContextsResult | undefined;
}) {
  const hasMatches = similarContexts?.ok && similarContexts.matches.length > 0;

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <h3 className="font-display font-semibold flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" /> Contextes similaires
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Recherche vectorielle sur les patterns déjà synchronisés pour la
        dernière course liée à une zone.
      </p>

      {!anchorTrip ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Aucune course zonée disponible pour lancer une recherche.
        </p>
      ) : isLoadingSimilarContexts ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Recherche des situations historiques les plus proches...
        </p>
      ) : hasMatches ? (
        <SimilarContextsMatches similarContexts={similarContexts!} />
      ) : (
        <Alert className="mt-3 border-dashed">
          <Sparkles className="h-4 w-4" />
          <AlertTitle>Recherche indisponible ou vide</AlertTitle>
          <AlertDescription>
            {similarContexts?.message ??
              'Aucun contexte similaire exploitable pour le moment.'}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function WeightSuggestionsSection({
  insights,
}: {
  insights: LearningInsights;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <h3 className="font-display font-semibold flex items-center gap-2">
        <Scale className="h-4 w-4 text-primary" /> Ajustements suggérés
      </h3>
      <div className="mt-3 space-y-2">
        {insights.suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Les poids sont stables pour l’instant. Continue à accumuler des
            courses.
          </p>
        ) : (
          insights.suggestions.slice(0, 4).map((suggestion) => (
            <div
              key={suggestion.key}
              className="rounded-lg border border-border px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{suggestion.key}</span>
                <span
                  className={`text-xs font-semibold ${
                    suggestion.delta >= 0
                      ? 'text-emerald-500'
                      : 'text-amber-500'
                  }`}
                >
                  {suggestion.delta >= 0 ? '+' : ''}
                  {(suggestion.delta * 100).toFixed(1)} pts
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {suggestion.reason}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PredictionErrorsSection({ insights }: { insights: LearningInsights }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <h3 className="font-display font-semibold">Dernières erreurs utiles</h3>
      <div className="mt-3 space-y-2">
        {insights.predictions.slice(0, 4).map((prediction) => (
          <div
            key={prediction.tripId}
            className="rounded-lg border border-border px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{prediction.zoneName}</span>
              <span
                className={`text-xs font-semibold ${
                  prediction.error >= 0 ? 'text-emerald-500' : 'text-rose-500'
                }`}
              >
                {prediction.error >= 0 ? '+' : ''}
                {prediction.error}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Prévu {prediction.predictedScore}, réel {prediction.actualScore},
              soit {formatMoney(prediction.actualEarningsPerHour)}/h.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LearningInsightsContent({
  insights,
  anchorTrip,
  isLoadingSimilarContexts,
  similarContexts,
}: {
  insights: LearningInsights;
  anchorTrip: TripWithZone | null;
  isLoadingSimilarContexts: boolean;
  similarContexts: SimilarContextsResult | undefined;
}) {
  return (
    <>
      <LearningSummaryCards insights={insights} />
      <LearnedZonesSection insights={insights} />
      <SimilarContextsSection
        anchorTrip={anchorTrip}
        isLoadingSimilarContexts={isLoadingSimilarContexts}
        similarContexts={similarContexts}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <WeightSuggestionsSection insights={insights} />
        <PredictionErrorsSection insights={insights} />
      </div>
    </>
  );
}

export function LearningInsightsPanel() {
  const { data: trips = [] } = useTrips(500, undefined, true, true);
  const [isSyncing, setIsSyncing] = useState(false);
  const insights = useMemo(
    () => deriveLearningInsights(trips, DEFAULT_WEIGHTS),
    [trips]
  );
  const anchorTrip = useMemo(
    () => trips.find((trip) => trip.zone_id) ?? null,
    [trips]
  );
  const { data: similarContexts, isLoading: isLoadingSimilarContexts } =
    useQuery({
      queryKey: ['learning-similar-contexts', anchorTrip?.id],
      queryFn: async () => findSimilarContextsForTrip(anchorTrip!, 5),
      enabled: Boolean(anchorTrip),
      retry: false,
      staleTime: 5 * 60 * 1000,
    });

  async function handleSync() {
    setIsSyncing(true);
    const result = await syncLearningAggregates(trips, DEFAULT_WEIGHTS);
    setIsSyncing(false);

    if (result.ok) {
      toast.success(result.message);
      return;
    }

    toast.error(result.message);
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-display flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-primary" /> Boucle
              d’apprentissage
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              EMA, croyances bayésiennes et retour prédiction vs réalité
              calculés à partir des courses déjà enregistrées.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSync}
            disabled={isSyncing || trips.length === 0}
          >
            {isSyncing ? 'Sync...' : 'Sync Supabase'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {trips.length === 0 ? (
          <LearningInsightsEmptyState />
        ) : (
          <LearningInsightsContent
            insights={insights}
            anchorTrip={anchorTrip}
            isLoadingSimilarContexts={isLoadingSimilarContexts}
            similarContexts={similarContexts}
          />
        )}
      </CardContent>
    </Card>
  );
}
