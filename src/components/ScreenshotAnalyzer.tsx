import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useZones } from '@/hooks/useSupabase';
import { useZoneScores } from '@/hooks/useZoneScores';
import { supabase } from '@/integrations/supabase/client';
import { decideRideOffer, type Decision } from '@/lib/rideDecision';
import { findExistingUpload, hashFile, recordUpload } from '@/lib/screenshotDedup';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Camera, CheckCircle2, Flame, Loader2, MapPin, Navigation, Save, ShieldCheck, ThumbsDown, ThumbsUp, Upload, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

const PLATFORMS = ['lyft', 'imoove', 'hypra', 'doordash', 'uber', 'autre'] as const;
type Platform = (typeof PLATFORMS)[number];

interface ExtractedData {
  earnings?: number | null;
  tips?: number | null;
  distance_km?: number | null;
  hours_worked?: number | null;
  trips_count?: number | null;
  date?: string | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  pickup_zone_id?: string | null;
  pickup_zone_name?: string | null;
  dropoff_zone_id?: string | null;
  dropoff_zone_name?: string | null;
  pickup_time_minutes?: number | null;
  pickup_distance_km?: number | null;
  ride_time_minutes?: number | null;
  ride_distance_km?: number | null;
}

interface AnalysisResult {
  zones_detected: {
    area: string;
    demand: string;
    surge_multiplier: number | null;
    color_intensity: string;
  }[];
  overall_demand: string;
  time_context: string | null;
  notes: string;
  recommended_target?: string;
  extracted_data?: ExtractedData;
  matched_zone_id?: string;
  matched_zone_name?: string;
  is_fallback?: boolean;
  fallback_reason?: string;
}

interface AnalyzeScreenshotResponse {
  error?: string;
  analysis?: AnalysisResult;
}

type ZoneOption = { id: string; name: string; type: string | null };

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function getDemandBadgeVariant(demand: string) {
  if (demand === 'surge' || demand === 'very_high') return 'destructive';
  if (demand === 'high') return 'default';
  if (demand === 'medium') return 'secondary';
  return 'outline';
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

interface UploadedScreenshot {
  signedUrl: string;
  objectPath: string;
}

async function uploadScreenshot(file: File): Promise<UploadedScreenshot> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error('Authentification requise pour uploader un screenshot');
  }
  const userId = authData.user.id;
  const objectPath = `${userId}/${Date.now()}-${sanitizeFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from('driver-screenshots')
    .upload(objectPath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data: signed, error: signError } = await supabase.storage
    .from('driver-screenshots')
    .createSignedUrl(objectPath, 300); // 5 min — suffit pour l'Edge Function
  if (signError || !signed?.signedUrl) {
    throw signError ?? new Error('Impossible de générer une URL signée');
  }
  return { signedUrl: signed.signedUrl, objectPath };
}

async function analyzeScreenshot(
  signedUrl: string,
  zoneId: string | null,
  zoneName: string | null
): Promise<AnalysisResult | null> {
  const { data, error } = await supabase.functions.invoke('analyze-screenshot', {
    body: {
      image_url: signedUrl,
      zone_id: zoneId ?? undefined,
      zone_name: zoneName ?? undefined,
      auto_zone: true,
    },
  });
  if (error) throw error;
  const payload = (data ?? {}) as AnalyzeScreenshotResponse;
  if (payload.error) throw new Error(payload.error);
  return payload.analysis ?? null;
}

export function ScreenshotAnalyzer() {
  const qc = useQueryClient();
  // Fixed: use correct city IDs from DB (mtl, lvl, lng)
  const { data: mtlZones = [] } = useZones('mtl');
  const { data: lvlZones = [] } = useZones('lvl');
  const { data: lngZones = [] } = useZones('lng');
  const allZones: ZoneOption[] = [...mtlZones, ...lvlZones, ...lngZones];

  const [zoneId, setZoneId] = useState('');
  const [platform, setPlatform] = useState<Platform>('lyft');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [storedPath, setStoredPath] = useState<string | null>(null);

  // Pull current zone scores so the decision agent can reason about the
  // strategic value of the dropoff (lands in a hot zone = better ride).
  // Three city queries because the scanner doesn't know city upfront.
  const { data: mtlScores = [] } = useZoneScores('mtl');
  const { data: lvlScores = [] } = useZoneScores('lvl');
  const { data: lngScores = [] } = useZoneScores('lng');
  const allScores = useMemo(
    () => [...mtlScores, ...lvlScores, ...lngScores],
    [mtlScores, lvlScores, lngScores],
  );

  const decision: Decision | null = useMemo(() => {
    if (!result?.extracted_data || result.is_fallback) return null;
    const d = result.extracted_data;
    if (!d.earnings || (!d.ride_distance_km && !d.ride_time_minutes)) return null;
    const dropoffScore = d.dropoff_zone_id
      ? allScores.find((s) => s.zone_id === d.dropoff_zone_id)?.final_score ?? null
      : null;
    const pickupScore = d.pickup_zone_id
      ? allScores.find((s) => s.zone_id === d.pickup_zone_id)?.final_score ?? null
      : null;
    return decideRideOffer({
      earnings: d.earnings ?? null,
      pickupTimeMin: d.pickup_time_minutes ?? null,
      pickupDistKm: d.pickup_distance_km ?? null,
      rideTimeMin: d.ride_time_minutes ?? null,
      rideDistKm: d.ride_distance_km ?? null,
      dropoffZoneScore: dropoffScore,
      pickupZoneScore: pickupScore,
    });
  }, [result, allScores]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error('Max 10 MB'); return; }
    setFile(f);
    setResult(null);
    setSaved(false);
    setStoredPath(null);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  }

  async function handleAnalyze() {
    if (!file) { toast.error('Sélectionnez un screenshot'); return; }
    setLoading(true);
    setResult(null);
    setSaved(false);
    setStoredPath(null);
    let uploaded: UploadedScreenshot | null = null;
    try {
      // Dedup: skip the upload + Gemini call if this exact file was already
      // processed for this user. Cached analysis is replayed straight back.
      const contentHash = await hashFile(file);
      const existing = await findExistingUpload(contentHash);
      if (existing) {
        setStoredPath(existing.file_path);
        if (existing.analysis_result) {
          setResult(existing.analysis_result as AnalysisResult);
          toast.info('Ce screenshot a déjà été analysé — résultat en cache');
        } else {
          toast.info('Ce screenshot a déjà été uploadé');
        }
        return;
      }

      uploaded = await uploadScreenshot(file);
      setStoredPath(uploaded.objectPath);
      toast.success('Screenshot sauvegardé dans ton compte');

      const selectedZone = zoneId ? allZones.find(z => z.id === zoneId) : null;
      const analysis = await analyzeScreenshot(
        uploaded.signedUrl,
        zoneId || null,
        selectedZone?.name ?? null,
      );
      // Use matched zone if AI found one (user didn't pick + AI inferred)
      if (!zoneId && analysis?.matched_zone_id) setZoneId(analysis.matched_zone_id);
      setResult(analysis);
      if (analysis?.is_fallback) {
        toast.warning('Screenshot stocké, mais analyse IA indisponible');
      } else {
        toast.success('Analyse terminée');
      }

      // Persist dedup record so a future re-upload of the same file is skipped
      await recordUpload({
        contentHash,
        filePath: uploaded.objectPath,
        fileName: file.name,
        fileSizeBytes: file.size,
        mimeType: file.type,
        source: 'manual',
        analysisResult: analysis,
      });
    } catch (err) {
      const msg = getErrorMessage(err, "Erreur lors de l'analyse");
      toast.error(uploaded ? `Stocké, mais ${msg.toLowerCase()}` : msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveTrip() {
    if (!result?.extracted_data) return;
    const { earnings, tips, distance_km, date } = result.extracted_data;
    if (!earnings && !tips) { toast.error('Aucun revenu détecté dans le screenshot'); return; }

    // Use AI-matched zone if driver didn't manually select one
    const effectiveZoneId = zoneId || result.matched_zone_id || null;

    setSaving(true);
    try {
      const startedAt = date ? new Date(date).toISOString() : new Date().toISOString();
      const { error } = await supabase.from('trips').insert({
        zone_id: effectiveZoneId,
        started_at: startedAt,
        earnings: earnings ?? null,
        tips: tips ?? null,
        distance_km: distance_km ?? null,
        platform,
        notes: `Import screenshot — ${result.notes ?? ''}`.slice(0, 500),
      });
      if (error) throw error;
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['trips-feed'] });
      qc.invalidateQueries({ queryKey: ['trip-history'] });
      toast.success('Course sauvegardée — le moteur d\'apprentissage va s\'améliorer');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Erreur lors de la sauvegarde'));
    } finally {
      setSaving(false);
    }
  }

  const hasTripData = (result?.extracted_data?.earnings ?? 0) > 0
    || (result?.extracted_data?.tips ?? 0) > 0;
  const isTripScreenshot = result?.recommended_target === 'shift'
    || result?.recommended_target === 'daily'
    || hasTripData;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Camera className="w-4 h-4 text-primary" /> Import screenshot
        </CardTitle>
        <CardDescription className="text-xs">
          Lyft heatmap (zones de surge) ou rapport de course Imoove/Hypra/Lyft — l'IA extrait les données et les sauvegarde pour améliorer tes suggestions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Platform selector */}
        <Select value={platform} onValueChange={v => setPlatform(v as Platform)}>
          <SelectTrigger className="bg-background border-border">
            <SelectValue placeholder="Plateforme" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            {PLATFORMS.map(p => (
              <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Zone selector */}
        <Select value={zoneId} onValueChange={setZoneId}>
          <SelectTrigger className="bg-background border-border">
            <SelectValue placeholder="Zone de référence (optionnel)" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border max-h-60">
            {allZones.map(zone => (
              <SelectItem key={zone.id} value={zone.id}>
                {zone.name}
                <span className="text-muted-foreground capitalize ml-1 text-xs">— {zone.type}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* File upload */}
        <label className="flex items-center justify-center gap-2 w-full h-28 rounded-lg border-2 border-dashed border-border bg-background cursor-pointer hover:border-primary/50 transition-colors">
          {preview ? (
            <img src={preview} alt="Preview" className="h-full w-full object-contain rounded-lg" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <Upload className="w-6 h-6" />
              <span className="text-xs">Screenshot JPG/PNG (max 10 MB)</span>
            </div>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </label>

        <Button onClick={handleAnalyze} className="w-full gap-2" disabled={loading || !file}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          {loading ? 'Analyse en cours…' : "Analyser avec l'IA"}
        </Button>

        {/* Storage confirmation — independent from analysis success */}
        {storedPath && (
          <div className="flex items-start gap-2 text-xs bg-green-500/5 border border-green-500/20 rounded-md p-2">
            <ShieldCheck className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              <p className="text-green-400 font-medium">Screenshot stocké en sécurité</p>
              <p className="text-muted-foreground break-all font-mono text-[10px]">
                driver-screenshots/{storedPath}
              </p>
            </div>
          </div>
        )}

        {/* Fallback state — Gemini failed but file is saved */}
        {result?.is_fallback && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/30 rounded-md p-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-medium text-amber-400">Analyse IA indisponible</p>
                <p className="text-xs text-muted-foreground">{result.notes}</p>
                {result.fallback_reason && (
                  <p className="text-[10px] text-muted-foreground font-mono">
                    code: {result.fallback_reason}
                  </p>
                )}
                <p className="text-xs text-muted-foreground pt-1">
                  Le fichier est conservé. Réessaie plus tard ou contacte le support si ça persiste.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Real analysis result */}
        {result && !result.is_fallback && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Résultat IA</span>
              <Badge variant={getDemandBadgeVariant(result.overall_demand)} className="text-xs">
                <Flame className="w-3 h-3 mr-1" />{result.overall_demand}
              </Badge>
            </div>
            {result.matched_zone_name && !zoneId && (
              <p className="text-xs text-muted-foreground">
                Zone détectée par l'IA : <span className="text-foreground font-medium">{result.matched_zone_name}</span>
              </p>
            )}

            {/* Trajet pickup → dropoff */}
            {result.extracted_data && (result.extracted_data.pickup_address || result.extracted_data.dropoff_address) && (
              <div className="bg-background rounded-lg border border-border p-3 space-y-2">
                {result.extracted_data.pickup_address && (
                  <div className="flex items-start gap-2 text-xs">
                    <Navigation className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Départ</p>
                      <p className="font-medium break-words">{result.extracted_data.pickup_address}</p>
                      {result.extracted_data.pickup_zone_name && (
                        <p className="text-muted-foreground text-[10px]">Zone : {result.extracted_data.pickup_zone_name}</p>
                      )}
                    </div>
                  </div>
                )}
                {result.extracted_data.pickup_address && result.extracted_data.dropoff_address && (
                  <div className="flex justify-center">
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  </div>
                )}
                {result.extracted_data.dropoff_address && (
                  <div className="flex items-start gap-2 text-xs">
                    <MapPin className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Destination</p>
                      <p className="font-medium break-words">{result.extracted_data.dropoff_address}</p>
                      {result.extracted_data.dropoff_zone_name && (
                        <p className="text-muted-foreground text-[10px]">Zone : {result.extracted_data.dropoff_zone_name}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Decision verdict — TAKE / SKIP / MEH with reasoning */}
            {decision && (
              <div
                className={
                  decision.verdict === 'take'
                    ? 'bg-green-500/10 border border-green-500/40 rounded-lg p-3 space-y-2'
                    : decision.verdict === 'skip'
                      ? 'bg-red-500/10 border border-red-500/40 rounded-lg p-3 space-y-2'
                      : 'bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-2'
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {decision.verdict === 'take' && <ThumbsUp className="w-4 h-4 text-green-400" />}
                    {decision.verdict === 'skip' && <ThumbsDown className="w-4 h-4 text-red-400" />}
                    {decision.verdict === 'meh' && <Zap className="w-4 h-4 text-amber-400" />}
                    <span
                      className={
                        decision.verdict === 'take'
                          ? 'text-sm font-bold text-green-400 uppercase'
                          : decision.verdict === 'skip'
                            ? 'text-sm font-bold text-red-400 uppercase'
                            : 'text-sm font-bold text-amber-400 uppercase'
                      }
                    >
                      {decision.verdict === 'take' ? 'Accepte' : decision.verdict === 'skip' ? 'Refuse' : 'Au feeling'}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    confiance {decision.confidence}%
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-1 text-[10px]">
                  {decision.metrics.dollarsPerKm != null && (
                    <div className="text-center">
                      <p className="text-muted-foreground">$/km</p>
                      <p className="font-mono font-medium">${decision.metrics.dollarsPerKm.toFixed(2)}</p>
                    </div>
                  )}
                  {decision.metrics.effectiveHourlyRate != null && (
                    <div className="text-center">
                      <p className="text-muted-foreground">$/h eff.</p>
                      <p className="font-mono font-medium">${decision.metrics.effectiveHourlyRate.toFixed(0)}</p>
                    </div>
                  )}
                  {decision.metrics.paidHourlyRate != null && (
                    <div className="text-center">
                      <p className="text-muted-foreground">$/h payé</p>
                      <p className="font-mono font-medium">${decision.metrics.paidHourlyRate.toFixed(0)}</p>
                    </div>
                  )}
                </div>
                {decision.reasoning.length > 0 && (
                  <ul className="text-[10px] text-muted-foreground space-y-0.5 pl-1">
                    {decision.reasoning.map((r, i) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Extracted trip data */}
            {result.extracted_data && (
              <div className="bg-background rounded-lg border border-border p-3 space-y-1">
                {result.extracted_data.earnings != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Revenus</span>
                    <span className="font-semibold text-green-400">${result.extracted_data.earnings.toFixed(2)}</span>
                  </div>
                )}
                {result.extracted_data.tips != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tips</span>
                    <span className="font-semibold text-green-400">${result.extracted_data.tips.toFixed(2)}</span>
                  </div>
                )}
                {result.extracted_data.distance_km != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Distance</span>
                    <span>{result.extracted_data.distance_km.toFixed(1)} km</span>
                  </div>
                )}
                {result.extracted_data.date && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Date</span>
                    <span>{result.extracted_data.date}</span>
                  </div>
                )}
              </div>
            )}

            {/* Zone detections */}
            {result.zones_detected?.length > 0 && (
              <div className="space-y-1">
                {result.zones_detected.map((z, i) => (
                  <div key={`${z.area}-${i}`} className="bg-background rounded-md border border-border p-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-xs font-medium">{z.area}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {z.surge_multiplier && <span className="text-xs text-muted-foreground">×{z.surge_multiplier}</span>}
                      <Badge variant={getDemandBadgeVariant(z.demand)} className="text-[10px] px-1.5 py-0">{z.demand}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.notes && <p className="text-xs text-muted-foreground italic">💡 {result.notes}</p>}

            {/* Save trip button — shown when earnings were detected */}
            {isTripScreenshot && !saved && (
              <Button
                onClick={handleSaveTrip}
                variant="outline"
                className="w-full gap-2 border-green-500/50 text-green-400 hover:bg-green-500/10"
                disabled={saving}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Sauvegarde…' : 'Sauvegarder comme course'}
              </Button>
            )}
            {saved && (
              <div className="flex items-center gap-2 text-green-400 text-sm justify-center">
                <CheckCircle2 className="w-4 h-4" />
                Course sauvegardée — algorithme mis à jour
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
