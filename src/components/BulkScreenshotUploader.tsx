import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert } from '@/integrations/supabase/types';
import { findExistingUpload, hashFile, recordUpload } from '@/lib/screenshotDedup';
import { normalizeStartedAt, resolveZoneIdFromAnalysis } from '@/lib/tripSave';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import {
  ensureNotificationPermission,
  registerMaxymoPeriodicSync,
  unregisterMaxymoPeriodicSync,
} from '@/lib/backgroundSync';
import { onAppResume, triggerImmediateBackgroundScan } from '@/lib/capacitorScanner';
import {
  clearAutoScanConfig,
  configureAutoScan as configureScanner,
  getConfiguredLabel,
  isAutoScanConfigured,
  rescanConfigured,
  scannerKind,
  silentRescan,
} from '@/lib/scannerService';
import { drainSharedFiles } from '@/lib/shareInbox';
import { insertTripsResilient } from '@/lib/tripBulkInsert';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Folder,
  FolderSearch,
  FolderUp,
  Loader2,
  RefreshCw,
  Save,
  Share2,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file, same as single uploader
// No hard cap on batch size — the driver wants to select every Maxymo/Lyft
// screenshot at once and let SHA-256 dedup skip the already-processed ones.
// Above this many files we just show a heads-up (long run), never drop any.
const LARGE_BATCH_WARN = 300;
const DEFAULT_FILTER = 'Maxymo';        // pre-fill the filter for Maxymo's default filename prefix

const PLATFORMS = ['lyft', 'imoove', 'hypra', 'doordash', 'uber', 'autre'] as const;
type Platform = (typeof PLATFORMS)[number];

// Extend HTMLInputElement to declare the non-standard webkitdirectory attribute
// React's typings don't include it, but Chromium-based browsers + recent Android
// expose it for folder selection.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

type FileStatus =
  | 'pending'
  | 'hashing'
  | 'duplicate'
  | 'uploading'
  | 'analyzing'
  | 'done'
  | 'failed'
  | 'skipped';

interface FileItem {
  id: string;
  file: File;
  status: FileStatus;
  message?: string;
  hash?: string;
  filePath?: string;
  analysis?: AnalysisResultMinimal | null;
  tripSaved?: boolean;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

interface AnalysisResultMinimal {
  is_fallback?: boolean;
  matched_zone_id?: string | null;
  extracted_data?: {
    earnings?: number | null;
    tips?: number | null;
    distance_km?: number | null;
    date?: string | null;
    pickup_address?: string | null;
    dropoff_address?: string | null;
    pickup_zone_id?: string | null;
    dropoff_zone_id?: string | null;
  } | null;
}

// A screenshot is worth saving as a trip only if the AI actually read a fare
// off it (heatmaps and fallbacks carry no earnings).
function hasTripEarnings(a: AnalysisResultMinimal | null | undefined): boolean {
  if (!a || a.is_fallback) return false;
  return (a.extracted_data?.earnings ?? 0) > 0;
}

async function uploadOne(file: File): Promise<{ signedUrl: string; objectPath: string }> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error('Authentification requise');
  }
  const objectPath = `${authData.user.id}/${Date.now()}-${sanitizeFilename(file.name)}`;
  const { error: uploadErr } = await supabase.storage
    .from('driver-screenshots')
    .upload(objectPath, file, { contentType: file.type, upsert: false });
  if (uploadErr) throw uploadErr;
  const { data: signed, error: signErr } = await supabase.storage
    .from('driver-screenshots')
    .createSignedUrl(objectPath, 300);
  if (signErr || !signed?.signedUrl) {
    throw signErr ?? new Error('Impossible de générer une URL signée');
  }
  return { signedUrl: signed.signedUrl, objectPath };
}

async function analyzeOne(signedUrl: string): Promise<AnalysisResultMinimal | null> {
  const { data, error } = await supabase.functions.invoke('analyze-screenshot', {
    body: { image_url: signedUrl, auto_zone: true },
  });
  if (error) throw error;
  return (data as { analysis?: AnalysisResultMinimal })?.analysis ?? null;
}

export function BulkScreenshotUploader() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<FileItem[]>([]);
  const [running, setRunning] = useState(false);
  const [nameFilter, setNameFilter] = useState(DEFAULT_FILTER);
  const [platform, setPlatform] = useState<Platform>('lyft');
  const [savingTrips, setSavingTrips] = useState(false);
  const [folderStats, setFolderStats] = useState<{
    totalInFolder: number;
    matched: number;
  } | null>(null);
  const [fromShare, setFromShare] = useState(false);
  const [autoScanConfigured, setAutoScanConfigured] = useState(false);
  const [autoScanLabel, setAutoScanLabel] = useState<string | null>(null);
  const [autoScanning, setAutoScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const kind = scannerKind();

  // On mount: refresh the configured-state from the active scanner backend
  // (FS Access handle in IDB for web, localStorage path for native) and run a
  // silent scan if anything is configured. Listen to both the DOM
  // visibilitychange (web) and Capacitor's appStateChange (native APK) so a
  // freshly captured Maxymo screenshot shows up immediately when the user
  // returns to the app, regardless of which shell is hosting us.
  useEffect(() => {
    let cancelled = false;

    async function attemptScan() {
      const configured = await isAutoScanConfigured();
      if (cancelled || !configured) return;
      setAutoScanConfigured(true);
      const label = await getConfiguredLabel();
      if (label) setAutoScanLabel(label);
      const files = await silentRescan(nameFilter || '');
      if (cancelled || !files.length) return;
      ingest(files, { fromFolder: true });
    }

    void attemptScan();

    function onVisibility() {
      if (document.visibilityState === 'visible') void attemptScan();
    }
    document.addEventListener('visibilitychange', onVisibility);
    const removeAppListener = onAppResume(() => { void attemptScan(); });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      removeAppListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function promptNativePath(): Promise<string | null> {
    const current = autoScanLabel?.replace(/^📁 /, '') ?? 'Pictures/Maxymo';
    const path = window.prompt(
      'Chemin du dossier Maxymo (sous External Storage)\nex: Pictures/Maxymo, DCIM/Screenshots',
      current,
    );
    return path?.trim() || null;
  }

  async function configureAutoScan() {
    const result = await configureScanner(promptNativePath);
    if (!result.ok) {
      if (result.label) toast.error(result.label);
      return;
    }
    setAutoScanConfigured(true);
    if (result.label) setAutoScanLabel(`📁 ${result.label}`);
    toast.success('Auto-scan configuré');
    await runConfiguredScan(false);

    // Best-effort web-side background sync + notification permission. On
    // native APK the Capacitor side handles its own background; these calls
    // are still safe (they short-circuit when SW/periodicSync are absent).
    const notifState = await ensureNotificationPermission();
    const periodicOk = await registerMaxymoPeriodicSync();
    if (kind === 'native') {
      toast.info('Notif natives activées — scan reliable même app fermée');
      // Kick the background runner once now so we don't wait 30 min for the
      // first notification cycle.
      void triggerImmediateBackgroundScan();
    } else if (periodicOk && notifState === 'granted') {
      toast.info('Notif activées — scan opportuniste en background');
    } else if (notifState === 'granted') {
      toast.info('Notif activées — scan déclenché au retour dans l\'app');
    }
  }

  async function rescan() {
    await runConfiguredScan(false);
  }

  async function disableAutoScan() {
    await clearAutoScanConfig();
    await unregisterMaxymoPeriodicSync();
    setAutoScanConfigured(false);
    setAutoScanLabel(null);
    toast.info('Auto-scan désactivé');
  }

  async function runConfiguredScan(silent: boolean): Promise<void> {
    setAutoScanning(true);
    try {
      const files = await rescanConfigured(nameFilter || '');
      if (!files.length) {
        if (!silent) toast.info(`Aucun fichier${nameFilter ? ` "${nameFilter}"` : ''} dans le dossier`);
        return;
      }
      ingest(files, { fromFolder: true });
      if (!silent) toast.success(`Scan terminé — ${files.length} fichier(s) candidat(s)`);
    } catch (err) {
      console.error('[autoScan] failed:', err);
      toast.error('Échec du scan automatique');
    } finally {
      setAutoScanning(false);
    }
  }

  // Handle the two ?from=… deep-link entry points: ?from=share is the SW
  // Web Share Target redirect (files in IDB), ?from=auto-scan is the periodic
  // notification click (auto-scan effect above takes care of the actual scan,
  // we just toast here to acknowledge the entry).
  useEffect(() => {
    const from = searchParams.get('from');
    if (from !== 'share' && from !== 'auto-scan') return;
    let cancelled = false;
    void (async () => {
      if (from === 'share') {
        const sharedFiles = await drainSharedFiles();
        if (cancelled) return;
        if (sharedFiles.length) {
          setFromShare(true);
          ingest(sharedFiles, { fromFolder: false });
          toast.success(`${sharedFiles.length} screenshot(s) reçu(s) depuis la galerie`);
        }
      } else if (from === 'auto-scan') {
        toast.info('Nouveau lot Maxymo détecté en arrière-plan');
      }
      searchParams.delete('from');
      setSearchParams(searchParams, { replace: true });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    setItems([]);
    setFolderStats(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }

  function ingest(rawFiles: File[], opts: { fromFolder: boolean }) {
    if (!rawFiles.length) return;
    let filtered = rawFiles;
    // Keep only image files (a folder dump will also include other things)
    filtered = filtered.filter((f) => f.type.startsWith('image/'));
    if (opts.fromFolder && nameFilter.trim()) {
      const needle = nameFilter.trim().toLowerCase();
      filtered = filtered.filter((f) => f.name.toLowerCase().includes(needle));
    }
    if (opts.fromFolder) {
      setFolderStats({ totalInFolder: rawFiles.length, matched: filtered.length });
    } else {
      setFolderStats(null);
    }
    if (!filtered.length) {
      if (opts.fromFolder) {
        toast.warning(`Aucun fichier ne matche "${nameFilter}" dans ce dossier`);
      } else {
        toast.error('Aucune image dans la sélection');
      }
      return;
    }
    if (filtered.length > LARGE_BATCH_WARN) {
      toast.info(
        `${filtered.length} fichiers — gros lot, l'analyse peut prendre un moment. Les doublons sont sautés automatiquement, rien n'est jeté.`,
      );
    }
    const newItems: FileItem[] = filtered.map((file, i) => {
      const oversize = file.size > MAX_FILE_SIZE;
      return {
        id: `${Date.now()}-${i}-${sanitizeFilename(file.name)}`,
        file,
        status: oversize ? 'skipped' : 'pending',
        message: oversize ? `Trop gros (${(file.size / 1024 / 1024).toFixed(1)} MB > 10 MB)` : undefined,
      };
    });
    setItems(newItems);
  }

  function handleFilesInput(e: React.ChangeEvent<HTMLInputElement>) {
    ingest(Array.from(e.target.files ?? []), { fromFolder: false });
  }

  function handleFolderInput(e: React.ChangeEvent<HTMLInputElement>) {
    ingest(Array.from(e.target.files ?? []), { fromFolder: true });
  }

  function updateItem(id: string, patch: Partial<FileItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function processOne(item: FileItem): Promise<void> {
    try {
      updateItem(item.id, { status: 'hashing' });
      const contentHash = await hashFile(item.file);
      updateItem(item.id, { hash: contentHash });

      const existing = await findExistingUpload(contentHash);
      if (existing) {
        updateItem(item.id, {
          status: 'duplicate',
          message: `Déjà uploadé le ${new Date(existing.uploaded_at).toLocaleDateString('fr-CA')}`,
          filePath: existing.file_path,
        });
        return;
      }

      updateItem(item.id, { status: 'uploading' });
      const uploaded = await uploadOne(item.file);
      updateItem(item.id, { filePath: uploaded.objectPath });

      updateItem(item.id, { status: 'analyzing' });
      const analysis = await analyzeOne(uploaded.signedUrl);

      await recordUpload({
        contentHash,
        filePath: uploaded.objectPath,
        fileName: item.file.name,
        fileSizeBytes: item.file.size,
        mimeType: item.file.type,
        source: 'bulk',
        analysisResult: analysis,
      });

      const earnings = analysis?.extracted_data?.earnings;
      const summaryBits: string[] = [];
      if (analysis?.is_fallback) summaryBits.push('analyse IA indisponible');
      if (earnings != null) summaryBits.push(`${earnings.toFixed(2)} $`);
      updateItem(item.id, {
        status: 'done',
        message: summaryBits.length ? summaryBits.join(' · ') : undefined,
        analysis,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateItem(item.id, { status: 'failed', message: msg });
    }
  }

  async function runBatch() {
    setRunning(true);
    try {
      for (const item of items) {
        if (item.status === 'skipped') continue;
        if (item.status === 'done' || item.status === 'duplicate' || item.status === 'failed') continue;
        // eslint-disable-next-line no-await-in-loop
        await processOne(item);
      }
      qc.invalidateQueries({ queryKey: ['trips-feed'] });
      qc.invalidateQueries({ queryKey: ['trip-history'] });
    } finally {
      setRunning(false);
    }
  }

  // Re-run analysis for a single failed screenshot — reuses processOne as-is
  // (hash → dedup check → upload → analyze → record) rather than reprocessing
  // the whole batch to retry the 4 that failed out of 382. Tracked separately
  // from `running` (the full-batch flag) so retrying one card doesn't disable
  // every other retry button; `retryingIds` is only used to disable the
  // clicked button itself against a double-tap, since processOne's own
  // status transitions (failed -> hashing -> ... ) already reflect progress.
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  async function retryOne(item: FileItem) {
    setRetryingIds((prev) => new Set(prev).add(item.id));
    try {
      await processOne(item);
      qc.invalidateQueries({ queryKey: ['trips-feed'] });
      qc.invalidateQueries({ queryKey: ['trip-history'] });
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  // A screenshot is only eligible for bulk save once its OWN analysis pass
  // actually completed successfully — a 'failed' or 'duplicate' item never
  // gets `analysis` populated by processOne, so `hasTripEarnings` alone
  // already excludes them today, but that's an implicit invariant of
  // processOne's control flow, not something this filter defends on its own.
  // Checking `status === 'done'` explicitly means a future change to
  // processOne can't silently let a failed/duplicate item slip into the
  // insert just because it happens to carry a stale `analysis` value.
  function isSavableAsTrip(it: FileItem): boolean {
    return it.status === 'done' && !it.tripSaved && hasTripEarnings(it.analysis);
  }

  // Persist every analyzed screenshot that carries a fare as a row in `trips`,
  // so a bulk backlog actually feeds the zone-suggestion learning loop (the
  // per-screenshot analysis alone only archives). Zone comes from the
  // screenshot itself (AI-matched → pickup → dropoff); no GPS, since these are
  // historical. Items with no fare or no resolvable zone are skipped and
  // reported. tripSaved guards against double-inserting on a repeat click.
  async function handleSaveAllAsTrips() {
    const candidates = items.filter(isSavableAsTrip);
    if (!candidates.length) {
      toast.info('Aucune course à sauvegarder (aucun revenu détecté)');
      return;
    }

    setSavingTrips(true);
    try {
      const rows: { id: string; row: TablesInsert<'trips'> }[] = [];
      let skippedNoZone = 0;
      for (const it of candidates) {
        const a = it.analysis;
        if (!a) continue;
        const zoneId = resolveZoneIdFromAnalysis(a);
        if (!zoneId) {
          skippedNoZone += 1;
          continue;
        }
        const d = a.extracted_data ?? {};
        rows.push({
          id: it.id,
          row: {
            zone_id: zoneId,
            started_at: normalizeStartedAt(d.date),
            earnings: d.earnings ?? null,
            tips: d.tips ?? null,
            distance_km: d.distance_km ?? null,
            platform,
            notes: `Import bulk — ${it.file.name}`.slice(0, 500),
          },
        });
      }

      if (!rows.length) {
        toast.warning(
          `Aucune zone identifiable sur ${skippedNoZone} course(s) — rien sauvegardé`,
        );
        return;
      }

      const { savedIds, failedCount } = await insertTripsResilient(
        rows,
        async (rowsArr) => supabase.from('trips').insert(rowsArr),
        async (row) => supabase.from('trips').insert(row),
      );

      setItems((prev) =>
        prev.map((it) =>
          savedIds.has(it.id) ? { ...it, tripSaved: true } : it,
        ),
      );
      qc.invalidateQueries({ queryKey: ['trips-feed'] });
      qc.invalidateQueries({ queryKey: ['trip-history'] });

      const parts = [`${savedIds.size} course(s) sauvegardée(s)`];
      if (skippedNoZone) parts.push(`${skippedNoZone} sans zone ignorée(s)`);
      if (failedCount) parts.push(`${failedCount} rejetée(s) par la base`);
      if (failedCount) {
        toast.warning(`${parts.join(' · ')} — le reste a été sauvegardé quand même`);
      } else {
        toast.success(`${parts.join(' · ')} — le moteur va apprendre`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Échec de la sauvegarde des courses',
      );
    } finally {
      setSavingTrips(false);
    }
  }

  // How many analyzed items are still eligible to be saved as trips.
  const savableTripCount = items.filter(isSavableAsTrip).length;

  function copyFailedSummary() {
    const failed = items.filter((i) => i.status === 'failed');
    if (!failed.length) {
      toast.info('Aucune erreur à copier');
      return;
    }
    const text = failed.map((i) => `${i.file.name} → ${i.message ?? 'unknown'}`).join('\n');
    void navigator.clipboard.writeText(text);
    toast.success(`${failed.length} erreur(s) copiées`);
  }

  const counts = {
    total: items.length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    duplicate: items.filter((i) => i.status === 'duplicate').length,
    done: items.filter((i) => i.status === 'done').length,
    failed: items.filter((i) => i.status === 'failed').length,
    inflight: items.filter((i) =>
      i.status === 'hashing' || i.status === 'uploading' || i.status === 'analyzing'
    ).length,
    pending: items.filter((i) => i.status === 'pending').length,
  };
  const processed = counts.done + counts.duplicate + counts.failed + counts.skipped;
  const progressPct = items.length ? Math.round((processed / items.length) * 100) : 0;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <FolderUp className="w-4 h-4 text-primary" /> Import bulk Maxymo
        </CardTitle>
        <CardDescription className="text-xs">
          Sélectionne autant de screenshots que tu veux d'un coup — aucune limite. Les doublons sont
          détectés via hash SHA-256 et ne consomment pas de Gemini.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {fromShare && (
          <div className="flex items-start gap-2 bg-primary/5 border border-primary/30 rounded-md p-2">
            <Share2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="text-primary font-medium">Reçu depuis la galerie</p>
              <p className="text-muted-foreground text-[10px]">
                Fichiers partagés via le share sheet Android. Tu peux lancer le batch directement.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Filtre nom de fichier (mode dossier)
          </label>
          <Input
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="Maxymo, Lyft, Screenshot…"
            disabled={running}
            className="h-8 text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            Quand tu choisis un dossier entier, seuls les fichiers dont le nom contient ce texte
            sont importés. Vide = tout prendre.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center justify-center gap-2 w-full h-20 rounded-lg border-2 border-dashed border-border bg-background cursor-pointer hover:border-primary/50 transition-colors">
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <FolderUp className="w-5 h-5" />
              <span className="text-[10px]">Fichiers</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFilesInput}
              disabled={running}
            />
          </label>

          <label className="flex items-center justify-center gap-2 w-full h-20 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 cursor-pointer hover:border-primary/60 transition-colors">
            <div className="flex flex-col items-center gap-1 text-primary/80">
              <Folder className="w-5 h-5" />
              <span className="text-[10px]">Dossier entier</span>
            </div>
            <input
              ref={folderInputRef}
              type="file"
              accept="image/*"
              multiple
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={handleFolderInput}
              disabled={running}
            />
          </label>
        </div>

        {folderStats && (
          <p className="text-[10px] text-muted-foreground bg-background border border-border rounded-md p-2">
            Dossier scanné : <span className="font-medium text-foreground">{folderStats.totalInFolder}</span> fichier(s) →
            <span className="font-medium text-foreground"> {folderStats.matched}</span> match{folderStats.matched > 1 ? 'ent' : 'e'} le filtre{nameFilter ? ` "${nameFilter}"` : ''}
          </p>
        )}

        {/* Auto-scan — works in two modes:
            - Native (Capacitor APK): persistent path + local notifications +
              true background tasks (no permission decay).
            - Web/TWA (FS Access API): persistent FileSystemDirectoryHandle
              with browser-managed ambient permission. */}
        {kind !== 'unsupported' && (
          <div className="space-y-1.5 pt-2 border-t border-border">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Zap className="w-3 h-3" /> Auto-scan du dossier Maxymo
              {kind === 'native' && (
                <span className="text-[9px] bg-primary/15 text-primary border border-primary/30 px-1.5 rounded">
                  native
                </span>
              )}
            </label>
            {autoScanLabel && (
              <p className="text-[10px] text-muted-foreground font-mono break-all">{autoScanLabel}</p>
            )}
            {autoScanConfigured ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-8 flex-1"
                  onClick={rescan}
                  disabled={running || autoScanning}
                >
                  {autoScanning
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <FolderSearch className="w-3 h-3" />}
                  Rescanner maintenant
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-8"
                  onClick={configureAutoScan}
                  disabled={running || autoScanning}
                >
                  Changer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-8"
                  onClick={disableAutoScan}
                  disabled={running || autoScanning}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-xs h-8 w-full border-primary/30 text-primary hover:bg-primary/10"
                onClick={configureAutoScan}
                disabled={running || autoScanning}
              >
                <Zap className="w-3 h-3" /> Configurer l'auto-scan du dossier
              </Button>
            )}
            <p className="text-[10px] text-muted-foreground">
              Une fois configuré, l'app scanne automatiquement ton dossier Maxymo à chaque ouverture
              et te propose les nouveaux fichiers à importer.
            </p>
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <Button onClick={runBatch} disabled={running || counts.pending === 0} className="flex-1 gap-2">
                {running
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <RefreshCw className="w-4 h-4" />}
                {running
                  ? `Traitement ${processed}/${items.length}…`
                  : counts.pending === 0
                    ? 'Tout traité'
                    : `Lancer le batch (${counts.pending} à traiter)`}
              </Button>
              <Button onClick={reset} variant="outline" disabled={running}>
                Réinitialiser
              </Button>
            </div>

            <Progress value={progressPct} className="h-1.5" />

            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <Badge variant="outline">{counts.total} total</Badge>
              {counts.done > 0 && <Badge variant="default" className="bg-green-500/15 text-green-400 border-green-500/30">{counts.done} traités</Badge>}
              {counts.duplicate > 0 && <Badge variant="secondary">{counts.duplicate} doublons</Badge>}
              {counts.skipped > 0 && <Badge variant="outline" className="text-amber-400 border-amber-500/30">{counts.skipped} ignorés</Badge>}
              {counts.failed > 0 && (
                <Badge variant="destructive" className="cursor-pointer" onClick={copyFailedSummary}>
                  {counts.failed} échecs <Copy className="w-2.5 h-2.5 ml-1" />
                </Badge>
              )}
            </div>

            {/* Save analyzed screenshots as trips so the batch feeds the
                learning loop (analysis alone only archives). */}
            {(savableTripCount > 0 || items.some((it) => it.tripSaved)) && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                    <SelectTrigger className="h-9 w-28 bg-background border-border text-xs shrink-0">
                      <SelectValue placeholder="Plateforme" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleSaveAllAsTrips}
                    variant="outline"
                    className="flex-1 gap-2 border-green-500/50 text-green-400 hover:bg-green-500/10"
                    disabled={savingTrips || running || savableTripCount === 0}
                  >
                    {savingTrips
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Save className="w-4 h-4" />}
                    {savingTrips
                      ? 'Sauvegarde…'
                      : savableTripCount === 0
                        ? 'Courses sauvegardées'
                        : `Tout sauvegarder comme courses (${savableTripCount})`}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Enregistre les courses avec revenus détectés dans ton historique pour améliorer les suggestions de zones. Zone lue depuis le screenshot ; celles sans zone sont ignorées.
                </p>
              </div>
            )}

            <ul className="max-h-72 overflow-y-auto space-y-1 text-xs">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-center justify-between gap-2 bg-background rounded-md border border-border p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] truncate">{it.file.name}</p>
                    {it.message && (
                      <p className="text-[10px] text-muted-foreground truncate">{it.message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {it.status === 'failed' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        title="Ressayer"
                        onClick={() => void retryOne(it)}
                        disabled={retryingIds.has(it.id)}
                      >
                        <RefreshCw className={`w-3 h-3 ${retryingIds.has(it.id) ? 'animate-spin' : ''}`} />
                      </Button>
                    )}
                    <StatusBadge status={it.status} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: FileStatus }) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="text-[10px]">en attente</Badge>;
    case 'hashing':
      return <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />hash</Badge>;
    case 'uploading':
      return <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />upload</Badge>;
    case 'analyzing':
      return <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />IA</Badge>;
    case 'done':
      return <Badge className="text-[10px] bg-green-500/15 text-green-400 border border-green-500/30 gap-1"><CheckCircle2 className="w-2.5 h-2.5" />traité</Badge>;
    case 'duplicate':
      return <Badge variant="secondary" className="text-[10px]">doublon</Badge>;
    case 'failed':
      return <Badge variant="destructive" className="text-[10px] gap-1"><XCircle className="w-2.5 h-2.5" />échec</Badge>;
    case 'skipped':
      return <Badge variant="outline" className="text-[10px] gap-1 text-amber-400 border-amber-500/30"><AlertCircle className="w-2.5 h-2.5" />ignoré</Badge>;
  }
}
