import { CitySelect } from '@/components/CitySelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useI18n } from '@/contexts/I18nContext';
import {
  useAddCity,
  useBulkInsertTimeSlots,
  useCities,
  useZones,
} from '@/hooks/useSupabase';
import { useTrips, type TripWithZone } from '@/hooks/useTrips';
import {
  searchFoursquarePlaces,
  type FoursquarePlace,
} from '@/integrations/foursquare';
import {
  searchOpenFoodFacts,
  type OpenFoodProduct,
} from '@/integrations/openFoodFacts';
import { supabase } from '@/integrations/supabase/client';
import {
  getDefaultLearningAgents,
  type LearningAgent,
  type LearningAgentState,
  type ZoneHistory,
} from '@/lib/aiAgents';
import { generateAISimulatedSlots } from '@/lib/aiSimulation';
import { getObservedZoneScore } from '@/lib/observedScore';
import { useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Clock,
  Database,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface AIRecommendation {
  zone_id: string;
  zone_name: string;
  new_score: number;
  peak_hours: string;
  best_days: string;
  trend: 'up' | 'down' | 'stable';
  tip: string;
}

interface AIAnalysisResponse {
  error?: string;
  recommendations?: AIRecommendation[];
}

const LAST_AI_ANALYSIS_STORAGE_KEY = 'delivroom_last_ai_analysis';

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function getStoredAiAnalysisTimestamp() {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(LAST_AI_ANALYSIS_STORAGE_KEY);
    return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

function storeAiAnalysisTimestamp(value: string) {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(LAST_AI_ANALYSIS_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures and keep UI functional.
  }
}

function logAdminGeolocationIssue(...args: unknown[]) {
  if (import.meta.env.DEV) {
    console.warn(...args);
  }
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'up') {
    return <TrendingUp className="w-4 h-4 text-green-400" />;
  }
  if (trend === 'down') {
    return <TrendingDown className="w-4 h-4 text-red-400" />;
  }
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

export function AdminAiAnalysisCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState<AIRecommendation[] | null>(null);
  const [lastAnalyzed, setLastAnalyzed] = useState<string | null>(() =>
    getStoredAiAnalysisTimestamp()
  );

  async function handleAIAnalysis() {
    setAiLoading(true);
    setAiResults(null);
    try {
      const { data, error } =
        await supabase.functions.invoke('ai-score-analysis');
      if (error) throw error;
      const payload = (data ?? {}) as AIAnalysisResponse;
      if (payload.error) throw new Error(payload.error);
      setAiResults(payload.recommendations ?? []);
      queryClient.invalidateQueries({ queryKey: ['zone-scores'] });
      queryClient.invalidateQueries({ queryKey: ['zones'] });
      const analysisTimestamp = new Date().toISOString();
      setLastAnalyzed(analysisTimestamp);
      storeAiAnalysisTimestamp(analysisTimestamp);
      toast.success(
        `${t('aiAnalysisDone')} — ${payload.recommendations?.length || 0} ${t('aiRecommendations')}`
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('aiAnalysisError')));
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" /> Analyse IA — scoring de la
          demande
        </CardTitle>
        <CardDescription className="text-xs">
          Recalcule les scores des zones à partir des 30 derniers jours. À
          lancer après un lot de données propre.
        </CardDescription>
        {lastAnalyzed && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Clock className="w-3.5 h-3.5" />
            {t('aiLastAnalyzed')}:{' '}
            {new Date(lastAnalyzed).toLocaleDateString('fr-CA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={handleAIAnalysis}
          className="w-full gap-2"
          disabled={aiLoading}
        >
          {aiLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {aiLoading ? t('aiRunning') : t('aiRunButton')}
        </Button>

        <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          Conseil: lance cette analyse après import CSV propre ou après
          plusieurs nouvelles courses réelles, pas juste après un document OCR.
        </div>

        {aiResults && aiResults.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-xs font-medium text-foreground">
              {aiResults.length} zones analysées
            </p>
            {aiResults.map((rec) => (
              <div
                key={rec.zone_id}
                className="bg-background rounded-lg border border-border p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-display font-semibold">
                    {rec.zone_name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <TrendIcon trend={rec.trend} />
                    <Badge
                      variant={
                        rec.new_score >= 70
                          ? 'default'
                          : rec.new_score >= 40
                            ? 'secondary'
                            : 'outline'
                      }
                      className="text-xs"
                    >
                      {rec.new_score}/100
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <span>🕐 {rec.peak_hours}</span>
                  <span>📅 {rec.best_days}</span>
                </div>
                {rec.tip && (
                  <p className="text-xs text-muted-foreground italic">
                    💡 {rec.tip}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {aiResults && aiResults.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Aucune recommandation générée. Ajoute plus de données.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminLearningAgentsCard() {
  const { t } = useI18n();
  const agents = useMemo<LearningAgent[]>(() => getDefaultLearningAgents(), []);
  const { data: recentTrips = [] } = useTrips(100);
  const [agentStates, setAgentStates] = useState<
    Record<string, LearningAgentState>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem('agentStates') ?? '{}');
    } catch {
      return {};
    }
  });

  const learningHistory = useMemo<ZoneHistory[]>(() => {
    return recentTrips
      .map((trip: TripWithZone) => {
        const zone = trip.zones;
        if (!zone) return null;
        const expected = Number(zone.current_score || 50);
        const observed = getObservedZoneScore(trip);
        return {
          zoneId: trip.zone_id,
          expectedScore: expected,
          observedScore: observed,
          timestamp: trip.started_at,
        };
      })
      .filter((item): item is ZoneHistory => item !== null);
  }, [recentTrips]);

  const driftMetrics = useMemo(() => {
    if (learningHistory.length === 0) {
      return { meanError: 0, sample: 0 };
    }
    const errors = learningHistory.map((item) =>
      Math.abs(item.observedScore - item.expectedScore)
    );
    const meanError =
      errors.reduce((sum, value) => sum + value, 0) / errors.length;
    return {
      meanError: Number(meanError.toFixed(1)),
      sample: learningHistory.length,
    };
  }, [learningHistory]);

  function handleRetrainAgents() {
    const nextStates: Record<string, LearningAgentState> = {};
    for (const agent of agents) {
      nextStates[agent.id] = agent.learn(learningHistory);
    }
    setAgentStates(nextStates);
    localStorage.setItem('agentStates', JSON.stringify(nextStates));
    toast.success(t('agentLearned'));
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" /> {t('agentsDashboard')}
        </CardTitle>
        <CardDescription className="text-xs">
          Lecture rapide du drift entre score attendu et revenu observé sur les
          trips récents. Ce tableau reste local à ce navigateur.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          Ce module n’écrit ni dans Supabase ni dans les vrais poids du modèle.
          Il sert surtout à visualiser un drift local et à tester les agents.
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Échantillon récent: {driftMetrics.sample} trajets</p>
          <p>Drift moyen: {driftMetrics.meanError}%</p>
          <p>Statut: {driftMetrics.meanError <= 10 ? 'OK' : 'Drift élevé'}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wider text-muted-foreground">
                <th>{t('name')}</th>
                <th>{t('agentStatus')}</th>
                <th>{t('agentLastUpdated')}</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-t border-border">
                  <td className="py-2">{agent.name}</td>
                  <td className="py-2">
                    {agentStates[agent.id]?.lastUpdated
                      ? t('agentLearned')
                      : t('agentNotAvailable')}
                  </td>
                  <td className="py-2">
                    {agentStates[agent.id]?.lastUpdated ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button onClick={handleRetrainAgents} className="w-full" size="sm">
          {t('retrainAgents')}
        </Button>
      </CardContent>
    </Card>
  );
}

export function AdminManageCitiesCard() {
  const { t } = useI18n();
  const { data: cities = [] } = useCities();
  const addCity = useAddCity();
  const [newCity, setNewCity] = useState('');

  async function handleAddCity() {
    if (!newCity.trim()) return;
    const id = newCity
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .slice(0, 8);
    try {
      await addCity.mutateAsync({ id, name: newCity.trim() });
      setNewCity('');
      toast.success(t('addCity'));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('save')));
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" /> {t('manageCities')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {cities.map((city) => (
          <div
            key={city.id}
            className="flex items-center justify-between bg-background rounded-md px-3 py-2 border border-border"
          >
            <span className="text-sm font-body">{city.name}</span>
            <span className="text-xs text-muted-foreground">{city.id}</span>
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            placeholder={t('name')}
            value={newCity}
            onChange={(e) => setNewCity(e.target.value)}
            className="bg-background border-border"
            onKeyDown={(e) => e.key === 'Enter' && void handleAddCity()}
          />
          <Button
            size="sm"
            onClick={() => void handleAddCity()}
            className="gap-1"
            disabled={addCity.isPending}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminSimulationCard() {
  const { t } = useI18n();
  const { data: cities = [] } = useCities();
  const [simCityId, setSimCityId] = useState('mtl');
  const [simDate, setSimDate] = useState(
    () => new Date().toISOString().split('T')[0]
  );
  const { data: zones = [] } = useZones(simCityId);
  const bulkInsert = useBulkInsertTimeSlots();
  const [simProgress, setSimProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);

  const isSimulating = simProgress !== null;
  const progressPct = simProgress
    ? Math.round((simProgress.current / Math.max(simProgress.total, 1)) * 100)
    : 0;

  async function handleSimulate() {
    if (zones.length === 0) {
      toast.error(t('noZonesCity'));
      return;
    }
    setSimProgress({ current: 0, total: 1, label: simCityId });
    const slots = generateAISimulatedSlots(simCityId, simDate, zones);
    try {
      await bulkInsert.mutateAsync(slots);
      setSimProgress({ current: 1, total: 1, label: simCityId });
      toast.success(
        `${t('simulated')}: ${slots.length} slots (${zones.length} zones × 96 créneaux)`
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('simulated')));
    } finally {
      setTimeout(() => setSimProgress(null), 1500);
    }
  }

  async function handleSimulateAll() {
    setSimProgress({ current: 0, total: cities.length, label: '' });
    try {
      let totalSlots = 0;
      for (let index = 0; index < cities.length; index++) {
        const city = cities[index];
        setSimProgress({
          current: index,
          total: cities.length,
          label: city.name,
        });
        const { data: cityZones, error } = await supabase
          .from('zones')
          .select('*')
          .eq('city_id', city.id);
        if (error) throw error;
        if (!cityZones || cityZones.length === 0) continue;
        const slots = generateAISimulatedSlots(city.id, simDate, cityZones);
        await bulkInsert.mutateAsync(slots);
        totalSlots += slots.length;
      }
      setSimProgress({
        current: cities.length,
        total: cities.length,
        label: 'Terminé',
      });
      toast.success(
        `${t('simulated')}: ${totalSlots} slots (${cities.length} villes)`
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('simulated')));
    } finally {
      setTimeout(() => setSimProgress(null), 1500);
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Zap className="w-4 h-4 text-demand-medium" /> {t('simulate')}
        </CardTitle>
        <CardDescription className="text-xs">
          Outil de test. Ces créneaux sont synthétiques et ne doivent pas servir
          à valider la rentabilité réelle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <CitySelect
            cities={cities}
            value={simCityId}
            onChange={setSimCityId}
          />
          <Input
            type="date"
            value={simDate}
            onChange={(e) => setSimDate(e.target.value)}
            className="bg-background border-border"
          />
        </div>

        {isSimulating && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-body">
              <span>
                {t('generationInProgress')} {simProgress.label}
              </span>
              <span>{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
        )}

        <Button
          onClick={() => void handleSimulate()}
          className="w-full gap-2"
          disabled={isSimulating}
        >
          {isSimulating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          {t('simulate')} (1 ville)
        </Button>
        <Button
          onClick={() => void handleSimulateAll()}
          variant="secondary"
          className="w-full gap-2"
          disabled={isSimulating}
        >
          {isSimulating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          {t('simulate')} — Toutes les villes
        </Button>

        <div className="text-xs text-muted-foreground font-body space-y-0.5 pt-1 border-t border-border">
          <p className="font-medium text-foreground">{t('simulationMode')}</p>
          <p>{t('simulationExplanation')}</p>
          <p>
            {t('slotsCount')} {zones.length || '?'} zones ={' '}
            {zones.length ? zones.length * 96 : '?'} scores
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminExternalDataCard() {
  const { t } = useI18n();
  const [foodQuery, setFoodQuery] = useState('');
  const [foodResults, setFoodResults] = useState<OpenFoodProduct[]>([]);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<FoursquarePlace[]>([]);
  const [placeLocation, setPlaceLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlaceLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        logAdminGeolocationIssue('Geolocation permission denied:', err.message);
        toast.error(t('locationPermissionTip'));
      }
    );
  }, [t]);

  async function handleSearchFood() {
    if (!foodQuery.trim()) return;
    try {
      const items = await searchOpenFoodFacts(foodQuery.trim());
      setFoodResults(items);
      toast.success(`${items.length} ${t('productsFound')}`);
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, `${t('searchFailed')} (OpenFoodFacts)`)
      );
    }
  }

  async function handleSearchPlaces() {
    if (!placeQuery.trim() || !placeLocation) {
      toast.error(t('locationOrQueryMissing'));
      return;
    }
    try {
      const places = await searchFoursquarePlaces(
        placeQuery.trim(),
        placeLocation.lat,
        placeLocation.lng
      );
      setPlaceResults(places);
      toast.success(`${places.length} ${t('placesFound')}`);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Foursquare search failed'));
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Zap className="w-4 h-4 text-demand-medium" /> {t('apiConnector')}
        </CardTitle>
        <CardDescription className="text-xs">
          Outils externes annexes. Ils n’influencent pas directement les scores
          ou les revenus de l’app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {t('openFoodFacts')} ({t('searchProducts')})
          </p>
          <div className="flex gap-2">
            <Input
              placeholder={t('searchProducts')}
              value={foodQuery}
              onChange={(e) => setFoodQuery(e.target.value)}
              className="bg-background border-border"
            />
            <Button
              onClick={() => void handleSearchFood()}
              variant="secondary"
              className="gap-2"
            >
              {t('searchProducts')}
            </Button>
          </div>
          {foodResults.length > 0 && (
            <div className="space-y-2 pt-2">
              {foodResults.slice(0, 5).map((item) => (
                <div
                  key={item.id || item.product_name}
                  className="rounded-md border border-border bg-background p-2 text-xs"
                >
                  <p className="font-semibold">
                    {item.product_name || t('noData')}
                  </p>
                  <p>
                    {item.brands} • {item.quantity || '—'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-medium">Foursquare</p>
          <div className="flex gap-2">
            <Input
              placeholder={t('searchPlaces')}
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              className="bg-background border-border"
            />
            <Button
              onClick={() => void handleSearchPlaces()}
              variant="secondary"
              className="gap-2"
            >
              {t('searchPlaces')}
            </Button>
          </div>
          {placeResults.length > 0 && (
            <div className="space-y-2 pt-2">
              {placeResults.slice(0, 5).map((place) => (
                <div
                  key={place.fsq_id}
                  className="rounded-md border border-border bg-background p-2 text-xs"
                >
                  <p className="font-semibold">{place.name}</p>
                  <p>{place.location?.formatted_address || '—'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
