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
import { useCities, useZones } from '@/hooks/useSupabase';
import { supabase } from '@/integrations/supabase/client';
import { runAutoPipeline, type PipelineItem } from '@/lib/bulkImportPipeline';
import { DEADHEAD_PENALTY_KM_THRESHOLD } from '@/lib/learningEngine';
import {
  buildAcceptedTripInsert,
  buildTripsRawInsert,
  parseMaxymoCsv,
  type MaxymoCsvRecord,
} from '@/lib/maxymoCsvParsing';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface MaxymoPipelineItem extends PipelineItem {
  record: MaxymoCsvRecord;
}

interface MaxymoStats {
  total: number;
  accepted: number;
  rejected: number;
  unknownStatus: number;
  avgDeadheadKm: number;
}

interface ImportResult {
  trips: number;
  marketRows: number;
  skippedDuplicates: number;
}

function toPipelineItem(record: MaxymoCsvRecord): MaxymoPipelineItem {
  return {
    status: 'done',
    record,
    analysis:
      record.offerStatus === 'accepted'
        ? { extracted_data: { earnings: record.fareCad } }
        : { is_fallback: true },
  };
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

function computeStats(records: MaxymoCsvRecord[]): MaxymoStats {
  const accepted = records.filter((r) => r.offerStatus === 'accepted').length;
  const rejected = records.filter((r) => r.offerStatus === 'rejected').length;
  const unknownStatus = records.filter((r) => r.offerStatus === 'unknown').length;
  const avgDeadheadKm = average(
    records.map((r) => r.pickupDistanceKm).filter((v): v is number => v != null)
  );
  return { total: records.length, accepted, rejected, unknownStatus, avgDeadheadKm };
}

/** Rows already saved in a prior import (same driver, same content hash) —
 * skipped so re-dropping the same export doesn't double-count revenue. RLS
 * scopes the lookup to the signed-in driver already. */
async function findExistingContentHashes(hashes: string[]): Promise<Set<string>> {
  if (!hashes.length) return new Set();
  const { data, error } = await supabase
    .from('trips_raw')
    .select('content_hash')
    .in('content_hash', hashes);
  if (error) {
    console.error('[MaxymoCsvImporter] dedup lookup failed:', error);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.content_hash).filter((h): h is string => h != null));
}

async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier échouée'));
    reader.readAsText(file);
  });
}

async function resolveUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

async function saveAcceptedTrips(
  candidates: MaxymoPipelineItem[],
  userId: string,
  importedAt: string,
  zoneId: string | null
): Promise<number> {
  const rows = candidates
    .map((c) => buildAcceptedTripInsert(c.record, userId, importedAt, zoneId))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (!rows.length) return 0;
  const { error } = await supabase.from('trips').insert(rows);
  if (error) throw error;
  return rows.length;
}

async function triggerRetrain(savedCount: number): Promise<void> {
  if (savedCount <= 0) return;
  const toastId = toast.loading(`Recalcul des zones (${savedCount} nouvelle(s) course(s))…`);
  try {
    await supabase.functions.invoke('score-calculator');
    toast.success('Scores de zones mis à jour', { id: toastId });
  } catch (err) {
    console.error('[MaxymoCsvImporter] retrain failed:', err);
    toast.error('Recalcul des zones échoué (les courses restent sauvegardées)', { id: toastId });
  }
}

/** Market history (all offers, accepted AND rejected) → trips_raw, then the
 * shared auto-pipeline (save accepted-with-fare candidates → invalidate the
 * learning-loop queries → retrain) — the same tail BulkScreenshotUploader
 * routes through, so a Maxymo CSV import and a Maxymo screenshot batch can't
 * drift out of sync with each other. */
async function importMaxymoRecords(
  records: MaxymoCsvRecord[],
  userId: string,
  zoneId: string | null,
  invalidate: (key: string) => void
): Promise<ImportResult> {
  const importedAt = new Date().toISOString();

  // Skip rows already saved in a prior import of this (or an overlapping)
  // CSV — re-dropping the same export must not double-count revenue.
  const existingHashes = await findExistingContentHashes(records.map((r) => r.contentHash));
  const newRecords = records.filter((r) => !existingHashes.has(r.contentHash));
  const skippedDuplicates = records.length - newRecords.length;
  if (!newRecords.length) {
    return { trips: 0, marketRows: 0, skippedDuplicates };
  }

  const marketRows = buildTripsRawInsert(newRecords, importedAt, userId, zoneId);
  const { error: marketError } = await supabase.from('trips_raw').insert(marketRows);
  if (marketError) throw marketError;

  const { savedCount } = await runAutoPipeline(newRecords.map(toPipelineItem), {
    saveTrips: (candidates) => saveAcceptedTrips(candidates, userId, importedAt, zoneId),
    invalidate,
    retrain: triggerRetrain,
  });

  return { trips: savedCount, marketRows: marketRows.length, skippedDuplicates };
}

function getDropzoneClassName(dragActive: boolean): string {
  const base = 'flex items-center justify-center gap-2 w-full h-20 rounded-lg border-2 border-dashed transition-colors';
  return dragActive ? `${base} border-primary bg-primary/5` : `${base} border-border bg-background`;
}

function getImportButtonLabel(importing: boolean, imported: ImportResult | null, total: number): string {
  if (importing) return 'Import en cours…';
  if (imported) return 'Importé';
  return `Importer ${total} offre(s)`;
}

function ImportPreview({
  stats,
  zoneId,
  zoneOptions,
  onZoneChange,
  importing,
  imported,
  onImport,
  onReset,
}: {
  stats: MaxymoStats;
  zoneId: string;
  zoneOptions: { id: string; name: string }[];
  onZoneChange: (v: string) => void;
  importing: boolean;
  imported: ImportResult | null;
  onImport: () => void;
  onReset: () => void;
}) {
  if (stats.total === 0) return null;
  const deadheadWarning = stats.avgDeadheadKm > DEADHEAD_PENALTY_KM_THRESHOLD;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{stats.total} offres</Badge>
        <Badge variant="default" className="bg-green-500/15 text-green-400 border-green-500/30">
          {stats.accepted} acceptées
        </Badge>
        <Badge variant="secondary">{stats.rejected} refusées</Badge>
        {stats.unknownStatus > 0 && (
          <Badge variant="destructive" title="Statut non reconnu — ni acceptée ni refusée, exclue du CA par prudence">
            {stats.unknownStatus} statut(s) inconnu(s)
          </Badge>
        )}
        <Badge
          variant={deadheadWarning ? 'destructive' : 'outline'}
          title="Distance moyenne à vide vers le pickup"
        >
          {stats.avgDeadheadKm} km à vide en moyenne
        </Badge>
      </div>
      {deadheadWarning && (
        <p className="text-[10px] text-amber-400">
          Au-dessus de {DEADHEAD_PENALTY_KM_THRESHOLD} km en moyenne — le moteur pénalisera le
          score de rentabilité des zones concernées.
        </p>
      )}

      <Select value={zoneId} onValueChange={onZoneChange} disabled={importing || imported !== null}>
        <SelectTrigger className="bg-background border-border">
          <SelectValue placeholder="Zone où ces courses ont été faites (optionnel)" />
        </SelectTrigger>
        <SelectContent className="bg-card border-border max-h-60">
          {zoneOptions.map((z) => (
            <SelectItem key={z.id} value={z.id}>
              {z.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!zoneId && (
        <p className="text-[10px] text-muted-foreground">
          Le CSV Maxymo ne contient pas de coordonnées GPS — sans zone choisie ici, ces courses
          n'entrent pas dans le scoring par zone (seulement dans le CA global).
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={onImport} className="flex-1 gap-2" disabled={importing || imported !== null}>
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          {getImportButtonLabel(importing, imported, stats.total)}
        </Button>
        <Button onClick={onReset} variant="outline" disabled={importing}>
          Réinitialiser
        </Button>
      </div>
    </div>
  );
}

function ImportedSummary({ imported }: { imported: ImportResult | null }) {
  if (!imported) return null;
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-background border border-border">
      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
      <div className="text-xs">
        <p className="font-medium text-foreground">{imported.trips} course(s) sauvegardée(s)</p>
        <p className="text-muted-foreground">
          {imported.marketRows} offre(s) archivée(s) comme historique de marché
        </p>
        {imported.skippedDuplicates > 0 && (
          <p className="text-muted-foreground">
            {imported.skippedDuplicates} offre(s) déjà importée(s) précédemment — ignorée(s)
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyState({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
      <XCircle className="w-3 h-3" /> Aucun fichier chargé
    </p>
  );
}

export function MaxymoCsvImporter() {
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [records, setRecords] = useState<MaxymoCsvRecord[]>([]);
  const [zoneId, setZoneId] = useState('');
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const { data: cities = [] } = useCities();
  const cityIds = useMemo(() => cities.map((c) => c.id), [cities]);
  const { data: zones = [] } = useZones(cityIds);

  const stats = useMemo(() => computeStats(records), [records]);

  const loadFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setImported(null);
    const text = await readFileText(file);
    const parsed = parseMaxymoCsv(text);
    if (!parsed.length) {
      toast.error('Fichier CSV Maxymo vide ou invalide');
      setRecords([]);
      return;
    }
    setRecords(parsed);
    toast.success(`${parsed.length} offres Maxymo détectées`);
  }, []);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave() {
    setDragActive(false);
  }

  async function handleImport() {
    if (!records.length) return;
    setImporting(true);
    try {
      const userId = await resolveUserId();
      if (!userId) {
        toast.error('Session expirée — reconnecte-toi avant d’importer');
        return;
      }

      const result = await importMaxymoRecords(records, userId, zoneId || null, (key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      );
      setImported(result);
      const learningNote = zoneId
        ? 'le moteur va apprendre pour cette zone'
        : 'aucune zone choisie — CA global seulement, pas de scoring par zone';
      toast.success(
        `${result.trips} course(s) sauvegardée(s), ${result.marketRows} offre(s) archivée(s) — ${learningNote}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de l’import Maxymo');
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setFileName(null);
    setRecords([]);
    setImported(null);
    setZoneId('');
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-primary" /> Import CSV Maxymo
        </CardTitle>
        <CardDescription className="text-xs">
          Exporte l'historique d'offres Maxymo (acceptées et refusées) et dépose le CSV ici.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          data-testid="maxymo-csv-dropzone"
          className={getDropzoneClassName(dragActive)}
        >
          <label className="flex items-center justify-center gap-2 w-full h-full cursor-pointer">
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <Upload className="w-5 h-5" />
              <span className="text-xs">
                {fileName || 'Glisse-dépose ou clique pour choisir un CSV Maxymo'}
              </span>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileInput}
              disabled={importing}
            />
          </label>
        </div>

        <ImportPreview
          stats={stats}
          zoneId={zoneId}
          zoneOptions={zones}
          onZoneChange={setZoneId}
          importing={importing}
          imported={imported}
          onImport={handleImport}
          onReset={reset}
        />
        <ImportedSummary imported={imported} />
        <EmptyState show={records.length === 0 && !fileName} />
      </CardContent>
    </Card>
  );
}
