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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useZones } from '@/hooks/useSupabase';
import { supabase } from '@/integrations/supabase/client';
import { buildProfitReportUpdate } from '@/lib/profitReportExtraction';
import { findExistingUpload, hashFile, recordUpload } from '@/lib/screenshotDedup';
import { useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Flame,
  Link,
  Loader2,
  MapPin,
  ScanLine,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.docx,.xlsx,.csv,.txt';

interface AnalysisResult {
  zones_detected?: {
    area: string;
    demand: string;
    surge_multiplier: number | null;
    color_intensity: string;
  }[];
  overall_demand?: string;
  time_context?: string;
  notes?: string;
  recommended_target?:
    | 'demand'
    | 'shift'
    | 'daily'
    | 'mileage'
    | 'profit'
    | 'unknown';
  extracted_data?: Record<string, unknown>;
}

type SuggestedArea =
  | 'demand'
  | 'shift'
  | 'daily'
  | 'mileage'
  | 'profit'
  | 'unknown';

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function UniversalFileAnalyzer() {
  const queryClient = useQueryClient();
  const { data: mtlZones = [] } = useZones('mtl');
  const { data: lavalZones = [] } = useZones('lvl');
  const { data: longueuilZones = [] } = useZones('lng');
  const allZones = useMemo(
    () => [...mtlZones, ...lavalZones, ...longueuilZones],
    [lavalZones, longueuilZones, mtlZones]
  );

  const [zoneId, setZoneId] = useState('');
  const [suggestedZoneId, setSuggestedZoneId] = useState('');
  const [suggestedArea, setSuggestedArea] = useState<SuggestedArea>('unknown');
  const [file, setFile] = useState<File | null>(null);

  // Auto-select first zone pour simplifier upload statements sans interaction
  useEffect(() => {
    if (!zoneId && allZones.length > 0) {
      setZoneId(allZones[0].id);
    }
  }, [allZones, zoneId]);
  const [urlInput, setUrlInput] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [mode, setMode] = useState<'file' | 'url' | 'capture'>('file');

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      toast.error('Fichier trop gros (max 20 MB)');
      return;
    }
    setFile(f);
    setResult(null);
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  }

  async function handleAnalyze() {
    if (mode === 'url' && !urlInput.trim()) {
      toast.error('Entrez un URL');
      return;
    }
    if (mode !== 'url' && !file) {
      toast.error('Sélectionnez un fichier');
      return;
    }

    setLoading(true);
    setResult(null);
    setSuggestedZoneId('');
    setSuggestedArea('unknown');

    try {
      let imageUrl = '';
      let fileContent = '';
      const fileType = file?.type || '';

      const smartRoute = (basedOn: AnalysisResult) => {
        if (basedOn.recommended_target) {
          setSuggestedArea(basedOn.recommended_target);
        } else if (
          fileType.includes('csv') ||
          file?.name.toLowerCase().includes('quickbooks') ||
          file?.name.toLowerCase().includes('mileage')
        ) {
          setSuggestedArea('mileage');
        } else if (
          file?.name.toLowerCase().includes('lyft') ||
          file?.name.toLowerCase().includes('ride')
        ) {
          setSuggestedArea('shift');
        } else {
          setSuggestedArea('demand');
        }
      };

      let contentHash: string | null = null;
      let uploadedFileName: string | null = null;

      if (mode === 'url') {
        imageUrl = urlInput.trim();
      } else if (file) {
        if (file.type.startsWith('image/')) {
          // Dedup by content hash before spending a Gemini call — same
          // pattern as ScreenshotAnalyzer/BulkScreenshotUploader. A re-drop
          // of the same screenshot replays the cached result instead of
          // re-uploading and re-analyzing it.
          contentHash = await hashFile(file);
          const existing = await findExistingUpload(contentHash);
          if (existing?.analysis_result) {
            const cached = existing.analysis_result as AnalysisResult;
            setResult(cached);
            if (cached.recommended_target) {
              setSuggestedArea(cached.recommended_target);
            } else {
              smartRoute(cached);
            }
            toast.info('Ce fichier a déjà été analysé — résultat en cache');
            return;
          }

          uploadedFileName = `${Date.now()}-${file.name}`;
          const { error: uploadErr } = await supabase.storage
            .from('driver-screenshots')
            .upload(uploadedFileName, file, { contentType: file.type });
          if (uploadErr) throw uploadErr;
          const { data: urlData } = supabase.storage
            .from('driver-screenshots')
            .getPublicUrl(uploadedFileName);
          imageUrl = urlData.publicUrl;
        } else {
          fileContent = await file.text();
          if (fileContent.length > 200000) {
            fileContent = fileContent.slice(0, 200000);
          }

          if (file.name.toLowerCase().endsWith('.csv')) {
            const lines = fileContent.split('\n').slice(0, 10);
            const hasDistance = lines.some((l) =>
              /distance|mileage|km|mi/i.test(l)
            );
            const hasEarnings = lines.some((l) =>
              /earnings|fare|revenue/i.test(l)
            );
            if (hasDistance && hasEarnings) {
              setSuggestedArea('mileage');
            }
          }
        }
      }

      const rawZone = zoneId
        ? allZones.find((z) => z.id === zoneId)
        : undefined;
      const zoneFallback = suggestedZoneId
        ? allZones.find((z) => z.id === suggestedZoneId)
        : undefined;
      const chosenZone = rawZone || zoneFallback || allZones[0];
      const zoneName = chosenZone?.name || 'Auto';

      const { data, error } = await supabase.functions.invoke(
        'analyze-screenshot',
        {
          body: {
            image_url: imageUrl || undefined,
            file_content: fileContent || undefined,
            file_name: file?.name || urlInput,
            zone_id: chosenZone?.id,
            zone_name: chosenZone?.name || zoneName,
            auto_zone: true,
            mode,
          },
        }
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const analysis: AnalysisResult = data.analysis || {};
      setResult(analysis);

      if (analysis.zones_detected?.length) {
        const found = analysis.zones_detected[0];
        const matched = allZones.find((z) =>
          z.name.toLowerCase().includes(found.area.toLowerCase())
        );
        if (matched) {
          setSuggestedZoneId(matched.id);
          setZoneId(matched.id);
        }
      }
      if (analysis.recommended_target) {
        setSuggestedArea(analysis.recommended_target);
      } else {
        smartRoute(analysis);
      }

      if (contentHash && uploadedFileName && file) {
        await recordUpload({
          contentHash,
          filePath: uploadedFileName,
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type,
          source: 'manual',
          analysisResult: analysis,
        });
      }

      toast.success('Analyse terminée — propositions créées');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Erreur lors de l'analyse"));
    } finally {
      setLoading(false);
    }
  }

  async function handleApplySuggestion() {
    if (!result) {
      toast.error('Aucune analyse disponible pour appliquer');
      return;
    }

    const target =
      suggestedArea !== 'unknown'
        ? suggestedArea
        : result.recommended_target || 'demand';
    const blocksDirectTripImport = target === 'shift' || target === 'mileage';
    const selectedZone = allZones.find(
      (z) => z.id === zoneId || z.id === suggestedZoneId
    );
    if (!selectedZone) {
      toast.error("Veuillez sélectionner une zone avant d'appliquer");
      return;
    }

    if (blocksDirectTripImport) {
      toast.warning(
        'Import automatique bloqué: vérifie ce document puis utilise Trip Logger, CSV Importer ou Mode Taxi pour éviter de créer un faux trajet synthétique.'
      );
      return;
    }

    setLoading(true);
    try {
      if (target === 'demand') {
        const { error } = await supabase.functions.invoke('ai-score-analysis', {
          body: { zone_id: selectedZone.id },
        });
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ['zone-scores'] });
        queryClient.invalidateQueries({ queryKey: ['zones'] });
        toast.success('Recalibrage de la demande déclenché pour la zone');
      } else if (target === 'daily') {
        const { error } = await supabase.functions.invoke(
          'generate-daily-report'
        );
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
        toast.success('Rapport quotidien généré');
      } else if (target === 'profit') {
        const ed = result.extracted_data || {};
        const today = new Date().toISOString().split('T')[0];
        const { data: existingReport, error: fetchErr } = await supabase
          .from('daily_reports')
          .select(
            'id,total_earnings,total_trips,total_distance_km,hours_worked'
          )
          .eq('report_date', today)
          .single();
        if (fetchErr && fetchErr.code !== 'PGRST116') throw fetchErr;

        const profitUpdate = buildProfitReportUpdate(existingReport, ed);
        if (!profitUpdate.ok) {
          toast.error(profitUpdate.message);
          return;
        }

        const baseUpdate = {
          report_date: today,
          ...profitUpdate.values,
          ai_recommendation: result.notes || undefined,
        };

        if (existingReport) {
          const { error: upErr } = await supabase
            .from('daily_reports')
            .update(baseUpdate)
            .eq('id', existingReport.id);
          if (upErr) throw upErr;
        } else {
          const { error: insErr } = await supabase
            .from('daily_reports')
            .insert(baseUpdate);
          if (insErr) throw insErr;
        }
        queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
        toast.success('Rapport de profit/quotidien mis à jour');
      } else {
        toast.error('Type de route inconnu');
      }
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, "Erreur lors de l'application de la suggestion")
      );
    } finally {
      setLoading(false);
    }
  }

  const demandColor = (d: string) => {
    if (d === 'very_high') return 'destructive';
    if (d === 'high') return 'default';
    if (d === 'medium') return 'secondary';
    return 'outline';
  };

  const directApplyLabelByArea: Record<SuggestedArea, string> = {
    demand: 'Lancer le recalcul de demande',
    shift: 'Import auto bloqué',
    daily: 'Générer le rapport quotidien',
    mileage: 'Import auto bloqué',
    profit: 'Mettre à jour le rapport de profit',
    unknown: 'Appliquer la suggestion IA',
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Camera className="w-4 h-4 text-primary" /> Analyseur universel
        </CardTitle>
        <CardDescription className="text-xs">
          Uploadez un fichier (image, PDF, CSV, etc.), un URL, ou capturez vos
          données en direct
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Mode tabs */}
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={mode === 'file' ? 'default' : 'outline'}
            onClick={() => setMode('file')}
            className="flex-1 gap-1 text-xs"
          >
            <Upload className="w-3 h-3" /> Fichier
          </Button>
          <Button
            size="sm"
            variant={mode === 'url' ? 'default' : 'outline'}
            onClick={() => setMode('url')}
            className="flex-1 gap-1 text-xs"
          >
            <Link className="w-3 h-3" /> URL
          </Button>
          <Button
            size="sm"
            variant={mode === 'capture' ? 'default' : 'outline'}
            onClick={() => setMode('capture')}
            className="flex-1 gap-1 text-xs"
          >
            <ScanLine className="w-3 h-3" /> Capture
          </Button>
        </div>

        {/* Zone select */}
        <Select value={zoneId} onValueChange={setZoneId}>
          <SelectTrigger className="bg-background border-border">
            <SelectValue placeholder="Zone de référence" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border max-h-60">
            {allZones.map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.name} —{' '}
                <span className="text-muted-foreground capitalize">
                  {z.type}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* File upload */}
        {(mode === 'file' || mode === 'capture') && (
          <label className="flex items-center justify-center gap-2 w-full h-28 rounded-lg border-2 border-dashed border-border bg-background cursor-pointer hover:border-primary/50 transition-colors">
            {preview ? (
              <img
                src={preview}
                alt="Preview"
                className="h-full w-full object-contain rounded-lg"
              />
            ) : file ? (
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <Upload className="w-6 h-6" />
                <span className="text-xs">{file.name}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                {mode === 'capture' ? (
                  <ScanLine className="w-6 h-6" />
                ) : (
                  <Upload className="w-6 h-6" />
                )}
                <span className="text-xs text-center px-2">
                  {mode === 'capture'
                    ? 'Prenez un screenshot Lyft/Uber/Maxymo et uploadez-le ici'
                    : 'JPG, PNG, PDF, CSV, XLSX, DOCX, TXT'}
                </span>
              </div>
            )}
            <input
              type="file"
              accept={mode === 'capture' ? 'image/*' : ACCEPTED_TYPES}
              capture={mode === 'capture' ? 'environment' : undefined}
              className="hidden"
              onChange={handleFile}
            />
          </label>
        )}

        {/* URL input */}
        {mode === 'url' && (
          <Input
            placeholder="https://example.com/screenshot.png"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="bg-background border-border"
          />
        )}

        <Button
          onClick={handleAnalyze}
          className="w-full gap-2"
          disabled={
            loading ||
            (!file && mode !== 'url') ||
            (mode === 'url' && !urlInput)
          }
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Camera className="w-4 h-4" />
          )}
          {loading ? 'Analyse en cours…' : "Analyser avec l'IA"}
        </Button>

        {mode === 'capture' && (
          <p className="text-[10px] text-muted-foreground text-center">
            Supporte: Lyft, Uber, Maxymo, Gridwise, QuickBooks, Everlance — l'IA
            extraira automatiquement les données pertinentes
          </p>
        )}

        {(result || suggestedArea !== 'unknown') && (
          <div className="p-2 bg-background border border-border rounded-md space-y-2 text-xs">
            <p className="font-semibold">Direction IA proposée :</p>
            <p>
              Zone suggérée:{' '}
              {suggestedZoneId
                ? allZones.find((z) => z.id === suggestedZoneId)?.name ||
                  suggestedZoneId
                : 'Non détectée'}
            </p>
            <p>
              Usage recommandé:{' '}
              {suggestedArea === 'unknown' ? 'Auto' : suggestedArea}
            </p>
            <p>
              {suggestedArea === 'mileage' &&
                '→ Vérifie ce document puis intègre-le manuellement au suivi kilométrique fiscal.'}
              {suggestedArea === 'shift' &&
                '→ Vérifie ce document puis utilise-le pour analyse de shift, heures et performance.'}
              {suggestedArea === 'daily' &&
                '→ Utilisez dans rapport quotidien / revenus journaliers.'}
              {suggestedArea === 'profit' &&
                '→ Utilisez dans la rentabilité net / calc profit.'}
              {suggestedArea === 'demand' &&
                '→ Utilisez pour recalcul de demande / scores zone.'}
            </p>
            {(suggestedArea === 'shift' || suggestedArea === 'mileage') && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-100">
                Les imports automatiques vers la table trips sont désactivés
                pour les documents de shift ou de kilométrage. Ce type de
                fichier peut représenter un résumé global et fausser les scores
                ainsi que les revenus horaires.
              </div>
            )}
            <Button
              onClick={handleApplySuggestion}
              size="sm"
              className="w-full"
              disabled={loading || !result}
            >
              {loading
                ? 'Traitement...'
                : directApplyLabelByArea[suggestedArea]}
            </Button>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                Résultat de l'analyse
              </span>
              {result.overall_demand && (
                <Badge
                  variant={demandColor(result.overall_demand)}
                  className="text-xs"
                >
                  <Flame className="w-3 h-3 mr-1" />
                  {result.overall_demand}
                </Badge>
              )}
            </div>

            {result.time_context && (
              <p className="text-xs text-muted-foreground">
                ⏰ {result.time_context}
              </p>
            )}

            {result.zones_detected && result.zones_detected.length > 0 && (
              <div className="space-y-1.5">
                {result.zones_detected.map((z, i) => (
                  <div
                    key={i}
                    className="bg-background rounded-md border border-border p-2 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-xs font-medium">{z.area}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {z.surge_multiplier && (
                        <span className="text-xs text-muted-foreground">
                          ×{z.surge_multiplier}
                        </span>
                      )}
                      <Badge
                        variant={demandColor(z.demand)}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {z.demand}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.notes && (
              <p className="text-xs text-muted-foreground italic">
                💡 {result.notes}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground text-center">
              Données sauvegardées automatiquement
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
