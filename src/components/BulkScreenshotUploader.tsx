import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { isSavableAsTrip, runAutoPipeline } from '@/lib/bulkImportPipeline';
import {
  fileKey,
  findExistingFileNames,
  findExistingUpload,
  hashFile,
  recordUpload,
} from '@/lib/screenshotDedup';
import {
  computeEndedAt,
  normalizeStartedAt,
  resolveDurationMinutes,
  resolveZoneIdFromAnalysis,
} from '@/lib/tripSave';
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
  getScanStatus,
  isAutoScanConfigured,
  regrantPermission,
  rescanConfigured,
  scannerKind,
  silentRescan,
  type ScanStatus,
} from '@/lib/scannerService';
import { drainSharedFiles } from '@/lib/shareInbox';
import { insertTripsResilient } from '@/lib/tripBulkInsert';
import {
  drainUploadQueue,
  enqueueFailedUpload,
  registerRetrySync,
} from '@/lib/uploadRetryQueue';
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
    pickup_time_minutes?: number | null;
    ride_time_minutes?: number | null;
    hours_worked?: number | null;
  } | null;
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
  // Bypasses the filename+size registry pre-filter for a folder scan — for a
  // one-time historical backfill (e.g. re-running extraction after adding a
  // new field) where "already seen by name" isn't the same as "nothing new
  // to extract". The SHA-256 content-hash dedup in processOne still applies
  // underneath, so real duplicates stay cheap (no re-upload, no re-Gemini).
  const [forceFullRescan, setForceFullRescan] = useState(false);
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
  const [scanStatus, setScanStatus] = useState<ScanStatus>('not-configured');
  const [lastSyncCount, setLastSyncCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // Mirrors `items` synchronously (see updateItemsState) so the end-of-batch
  // auto pipeline always reads the freshest statuses instead of a stale
  // closure over the `items` state from whichever render kicked off the run.
  const itemsRef = useRef<FileItem[]>([]);
  const kind = scannerKind();

  function updateItemsState(updater: (prev: FileItem[]) => FileItem[]) {
    setItems((prev) => {
      const next = updater(prev);
      itemsRef.current = next;
      return next;
    });
  }

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
      const status = await getScanStatus();
      if (cancelled) return;
      setScanStatus(status);
      if (status !== 'granted') return;
      const files = await silentRescan(nameFilter || '');
      if (cancelled || !files.length) return;
      void ingest(files, { fromFolder: true });
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
    setScanStatus(await getScanStatus());
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
    setScanStatus('not-configured');
    setLastSyncCount(null);
    toast.info('Auto-scan désactivé');
  }

  // Banner's 1-tap grant button: re-request permission on the already-picked
  // handle (no folder picker) then run a scan immediately.
  async function requestPermission() {
    const ok = await regrantPermission();
    if (!ok) {
      toast.error('Permission refusée');
      return;
    }
    setScanStatus('granted');
    toast.success('Permission accordée');
    await runConfiguredScan(false);
  }

  async function runConfiguredScan(silent: boolean): Promise<void> {
    setAutoScanning(true);
    try {
      const files = await rescanConfigured(nameFilter || '');
      setScanStatus(await getScanStatus());
      if (!files.length) {
        if (!silent) toast.info(`Aucun fichier${nameFilter ? ` "${nameFilter}"` : ''} dans le dossier`);
        return;
      }
      // await'd: ingest itself decides what's actually new (registry
      // pre-filter) and toasts accordingly — a count based on the raw
      // pre-filter `files.length` here would be misleading once
      // already-imported files are dropped.
      await ingest(files, { fromFolder: true });
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
          void ingest(sharedFiles, { fromFolder: false });
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
    updateItemsState(() => []);
    setFolderStats(null);
    setLastSyncCount(null);
    // La plateforme n'est pas détectée par screenshot — un seul sélecteur
    // s'applique à tout le lot. Sans ce reset, un lot Hypra suivi d'un lot
    // Lyft hérite silencieusement du choix précédent (bug rapporté : courses
    // Lyft loggées "Hypra"). Revenir au défaut force une re-confirmation.
    setPlatform('lyft');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }

  async function ingest(rawFiles: File[], opts: { fromFolder: boolean }): Promise<void> {
    if (!rawFiles.length) return;
    let filtered = rawFiles;
    // Keep only image files (a folder dump will also include other things)
    filtered = filtered.filter((f) => f.type.startsWith('image/'));
    if (opts.fromFolder && nameFilter.trim()) {
      const needle = nameFilter.trim().toLowerCase();
      filtered = filtered.filter((f) => f.name.toLowerCase().includes(needle));
    }

    // Incremental scan: drop files the import registry already has a row
    // for (name + size) before they ever reach the queue — cheaper than
    // hashing every file in a large folder just to find out most were
    // already imported, and keeps a rescan silent about what it skipped.
    // Skipped entirely in forceFullRescan mode (see its declaration) — the
    // content-hash dedup in processOne remains the safety net either way.
    let alreadyImported = 0;
    if (opts.fromFolder && filtered.length && !forceFullRescan) {
      const known = await findExistingFileNames(
        filtered.map((f) => ({ name: f.name, size: f.size })),
      );
      const before = filtered.length;
      filtered = filtered.filter((f) => !known.has(fileKey(f.name, f.size)));
      alreadyImported = before - filtered.length;
    }

    if (opts.fromFolder) {
      setFolderStats({ totalInFolder: rawFiles.length, matched: filtered.length });
      setLastSyncCount(filtered.length);
    } else {
      setFolderStats(null);
    }
    if (!filtered.length) {
      if (opts.fromFolder) {
        toast.info(
          alreadyImported > 0
            ? `Aucun nouveau fichier — ${alreadyImported} déjà importé(s)`
            : `Aucun fichier ne matche "${nameFilter}" dans ce dossier`,
        );
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
    updateItemsState(() => newItems);

    // Auto-trigger: a folder scan (manual pick, rescan, or the silent
    // auto-scan on mount) no longer waits on a "Lancer le batch" click —
    // pass the freshly-filtered list directly rather than reading `items`
    // state, which wouldn't reflect this setItems call yet.
    if (opts.fromFolder && newItems.some((it) => it.status === 'pending')) {
      void runBatchFor(newItems);
    }
  }

  function handleFilesInput(e: React.ChangeEvent<HTMLInputElement>) {
    void ingest(Array.from(e.target.files ?? []), { fromFolder: false });
  }

  function handleFolderInput(e: React.ChangeEvent<HTMLInputElement>) {
    void ingest(Array.from(e.target.files ?? []), { fromFolder: true });
  }

  function updateItem(id: string, patch: Partial<FileItem>) {
    updateItemsState((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function processOne(item: FileItem): Promise<void> {
    try {
      updateItem(item.id, { status: 'hashing' });
      const contentHash = await hashFile(item.file);
      updateItem(item.id, { hash: contentHash });

      const existing = await findExistingUpload(contentHash);
      if (existing) {
        // A previous session already paid for the upload + Gemini call for
        // these bytes — reuse its stored analysis instead of re-fetching
        // either. This is what lets a "duplicate" screenshot still become a
        // savable trip candidate below (isSavableAsTrip), e.g. when it was
        // uploaded before duration_minutes extraction existed, or before an
        // earlier save attempt was rejected (RLS, network) and never retried.
        const existingAnalysis = existing.analysis_result as AnalysisResultMinimal | null;
        updateItem(item.id, {
          status: 'duplicate',
          message: `Déjà uploadé le ${new Date(existing.uploaded_at).toLocaleDateString('fr-CA')}`,
          filePath: existing.file_path,
          analysis: existingAnalysis,
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
      // Queue for automatic retry via Background Sync — content-hash dedup
      // at the top of this function makes a redundant retry harmless (it
      // just resolves as 'duplicate') if the driver also hits the manual
      // "Ressayer" button before the queued retry runs.
      void enqueueFailedUpload(item.file)
        .then(() => registerRetrySync())
        .catch((queueErr) => console.error('[uploadRetryQueue] enqueue failed:', queueErr));
    }
  }

  // After trips are saved, kick the zone scoring recalculation so the
  // learning loop (EMA/Bayesian + TrendAgent/RushHourAgent) reflects them
  // right away instead of waiting for the next cron tick. Best-effort: a
  // failure here doesn't affect what's already saved, just delays the score
  // refresh. Keyed on trips actually saved, not screenshots uploaded — a
  // batch that uploaded 40 screenshots but extracted 0 fares has nothing new
  // for score-calculator to recompute.
  async function triggerRetrain(savedCount: number): Promise<void> {
    if (savedCount <= 0) return;
    const toastId = toast.loading(`Recalcul des zones (${savedCount} nouvelle(s) course(s))…`);
    try {
      await supabase.functions.invoke('score-calculator');
      toast.success('Scores de zones mis à jour', { id: toastId });
    } catch (err) {
      console.error('[retrain] score-calculator failed:', err);
      toast.error('Recalcul des zones échoué (les courses restent sauvegardées)', { id: toastId });
    }
  }

  // Shared zero-touch tail: auto-save every analyzed screenshot that carries
  // a fare, refresh every query the learning loop reads from, then retrain.
  // See src/lib/bulkImportPipeline.ts — one implementation, every batch
  // completion (manual run, silent auto-scan, upload-retry queue) routes
  // through it so none of them can drift out of sync with each other.
  async function runPostBatchPipeline(freshItems: FileItem[]): Promise<void> {
    setSavingTrips(true);
    try {
      await runAutoPipeline(freshItems, {
        saveTrips: persistTrips,
        invalidate: (key) => qc.invalidateQueries({ queryKey: [key] }),
        retrain: triggerRetrain,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Échec de la sauvegarde automatique des courses',
      );
    } finally {
      setSavingTrips(false);
    }
  }

  async function runBatchFor(list: FileItem[]): Promise<void> {
    setRunning(true);
    try {
      for (const item of list) {
        if (item.status === 'skipped') continue;
        if (item.status === 'done' || item.status === 'duplicate' || item.status === 'failed') continue;
        // eslint-disable-next-line no-await-in-loop
        await processOne(item);
      }
      await runPostBatchPipeline(itemsRef.current);
    } finally {
      setRunning(false);
    }
  }

  // Manual re-run button — reprocesses whatever's currently pending in
  // state (e.g. after a failure), distinct from the auto-run in ingest()
  // which passes its own freshly-filtered list to avoid a stale closure.
  async function runBatch(): Promise<void> {
    await runBatchFor(items);
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

  // Drains uploadRetryQueue's IndexedDB queue and retries every item —
  // called on mount (covers "the app becomes active again" after a failure)
  // and whenever the Service Worker's Background Sync `sync` handler wakes
  // this page (covers "the network comes back" while the tab is merely
  // backgrounded, not fully closed — see sw.ts's notifyClientsToRetryUploads).
  async function drainAndRetryQueue(): Promise<void> {
    const queued = await drainUploadQueue();
    if (!queued.length) return;

    const newItems: FileItem[] = queued.map((q, i) => ({
      id: `retry-${Date.now()}-${i}-${sanitizeFilename(q.file.name)}`,
      file: q.file,
      status: 'pending',
    }));
    updateItemsState((prev) => [...prev, ...newItems]);
    toast.info(
      `${newItems.length} import(s) en attente repris automatiquement`,
    );

    for (const item of newItems) {
      await processOne(item);
    }
    await runPostBatchPipeline(itemsRef.current);
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.data?.type === 'delivroom:retry-failed-uploads') {
        void drainAndRetryQueue();
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage);
    void drainAndRetryQueue();
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist a batch of already-screened savable candidates as `trips` rows,
  // so they actually feed the zone-suggestion learning loop (the
  // per-screenshot analysis alone only archives). Zone comes from the
  // screenshot itself (AI-matched → pickup → dropoff); no GPS, since these
  // are historical. Items with no resolvable zone, or already saved in a
  // prior session, are skipped and reported. Returns how many rows actually
  // landed — the number the post-batch pipeline uses to decide whether a
  // retrain is warranted. Shared by the manual "Tout sauvegarder" button and
  // the automatic post-batch pipeline (runPostBatchPipeline) — exactly one
  // insert path either way.
  async function persistTrips(candidates: FileItem[]): Promise<number> {
    // RLS on trips requires user_id = auth.uid() on insert — every row
    // needs it explicitly, the client can't leave it to a column default.
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      toast.error('Session expirée — reconnecte-toi avant de sauvegarder');
      return 0;
    }

    // Guard against re-inserting a trip for a screenshot that already has a
    // trips row — one query up front, matched by the exact notes string
    // this same code writes below, rather than a per-file round trip.
    const { data: existingNotesRows } = await supabase
      .from('trips')
      .select('notes')
      .eq('user_id', userId)
      .like('notes', 'Import bulk — %');
    const alreadySavedNotes = new Set(
      (existingNotesRows ?? []).map((r) => r.notes).filter((n): n is string => !!n),
    );

    const rows: { id: string; row: TablesInsert<'trips'> }[] = [];
    let skippedNoZone = 0;
    let skippedAlreadySaved = 0;
    for (const it of candidates) {
      const a = it.analysis;
      if (!a) continue;
      const notes = `Import bulk — ${it.file.name}`.slice(0, 500);
      if (alreadySavedNotes.has(notes)) {
        skippedAlreadySaved += 1;
        continue;
      }
      const zoneId = resolveZoneIdFromAnalysis(a);
      if (!zoneId) {
        skippedNoZone += 1;
        continue;
      }
      const d = a.extracted_data ?? {};
      const startedAt = normalizeStartedAt(d.date);
      const durationMinutes = resolveDurationMinutes(d);
      rows.push({
        id: it.id,
        row: {
          user_id: userId,
          zone_id: zoneId,
          started_at: startedAt,
          earnings: d.earnings ?? null,
          tips: d.tips ?? null,
          distance_km: d.distance_km ?? null,
          duration_minutes: durationMinutes,
          ended_at: computeEndedAt(startedAt, durationMinutes),
          platform,
          notes,
        },
      });
    }

    if (!rows.length) {
      if (skippedAlreadySaved > 0 && skippedNoZone === 0) {
        toast.info(`${skippedAlreadySaved} course(s) déjà sauvegardée(s) précédemment — rien à faire`);
      } else if (skippedNoZone > 0) {
        toast.warning(`Aucune zone identifiable sur ${skippedNoZone} course(s) — rien sauvegardé`);
      }
      return 0;
    }

    const { savedIds, failedCount } = await insertTripsResilient(
      rows,
      async (rowsArr) => supabase.from('trips').insert(rowsArr),
      async (row) => supabase.from('trips').insert(row),
    );

    updateItemsState((prev) =>
      prev.map((it) => (savedIds.has(it.id) ? { ...it, tripSaved: true } : it)),
    );

    const parts = [`${savedIds.size} course(s) sauvegardée(s)`];
    if (skippedAlreadySaved) parts.push(`${skippedAlreadySaved} déjà sauvegardée(s)`);
    if (skippedNoZone) parts.push(`${skippedNoZone} sans zone ignorée(s)`);
    if (failedCount) parts.push(`${failedCount} rejetée(s) par la base`);
    if (failedCount) {
      toast.warning(`${parts.join(' · ')} — le reste a été sauvegardé quand même`);
    } else {
      toast.success(`${parts.join(' · ')} — le moteur va apprendre`);
    }
    return savedIds.size;
  }

  // Manual fallback button — in the normal zero-touch flow, runPostBatchPipeline
  // already auto-saves everything the moment a batch finishes, so this is only
  // needed if the driver reopens the app on a batch left half-saved.
  async function handleSaveAllAsTrips() {
    if (!items.some(isSavableAsTrip)) {
      toast.info('Aucune course à sauvegarder (aucun revenu détecté)');
      return;
    }
    await runPostBatchPipeline(items);
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
        {/* Sync status banner — always visible when a scanner backend exists,
            so the driver never wonders whether the folder is actually being
            watched. */}
        {kind !== 'unsupported' && autoScanConfigured && (
          <>
            {autoScanning ? (
              <div className="flex items-center gap-2 bg-primary/5 border border-primary/30 rounded-md p-2 text-xs text-primary">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                Scan du dossier en cours…
              </div>
            ) : scanStatus === 'permission-needed' ? (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-md p-2 text-xs text-amber-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="flex-1">Permission requise pour scanner le dossier Maxymo/Lyft</span>
                <Button size="sm" className="h-7 text-xs" onClick={requestPermission}>
                  Autoriser
                </Button>
              </div>
            ) : scanStatus === 'granted' && lastSyncCount != null ? (
              <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-md p-2 text-xs text-green-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {lastSyncCount} nouveau{lastSyncCount > 1 ? 'x' : ''} fichier{lastSyncCount > 1 ? 's' : ''} synchronisé{lastSyncCount > 1 ? 's' : ''}
              </div>
            ) : null}
          </>
        )}

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

        {/* Auto-scan is the zero-touch path — once configured, the handle is
            persisted (IndexedDB) and every check on mount / rescan is a
            silent queryPermission() first (see maxymoScanner.ensureReadPermission);
            the browser prompt only ever fires if Chrome itself decided the
            grant decayed, which no amount of app code can skip (WICG spec).
            Shown first so it's the default path, not an afterthought below
            the manual pickers.
            - Native (Capacitor APK): persistent path + local notifications +
              true background tasks (no permission decay).
            - Web/TWA (FS Access API): persistent FileSystemDirectoryHandle
              with browser-managed ambient permission. */}
        {kind !== 'unsupported' && (
          <div className="space-y-1.5">
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
              Une fois configuré, l'app scanne automatiquement ton dossier Maxymo <em>et</em> les
              dossiers de captures standards (Screenshots, Lyft) à chaque ouverture — peu importe
              la méthode de capture (bouton overlay, Vol-Down+Power, geste paume) — et te propose
              les nouveaux fichiers à importer, sans redemander la permission.
            </p>
          </div>
        )}

        {/* PWA-on-Android reality check: Chrome for Android ships no File
            System Access API (no showDirectoryPicker), so there is no handle
            to persist and no background folder scan to offer — scannerKind()
            returns 'unsupported' on the very device this app runs on as a
            WebAPK. Saying so explicitly beats silently hiding the auto-scan
            block and leaving the driver wondering where it went; the manual
            import below is the supported path there, and the native APK
            (Capacitor) is the one that gets true background scanning. */}
        {kind === 'unsupported' && (
          <div className="flex items-start gap-2 bg-muted/40 border border-border rounded-md p-2">
            <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-[10px] text-muted-foreground">
              <p className="text-foreground font-medium text-xs">Import manuel sur cette plateforme</p>
              <p>
                Ce navigateur n'expose pas d'accès dossier persistant — l'auto-scan en arrière-plan
                n'est disponible que dans l'APK Android. Utilise l'import ci-dessous, ou le partage
                Android (share sheet) depuis la galerie.
              </p>
            </div>
          </div>
        )}

        {/* Manual pickers: "Dossier entier" is the raw browser folder picker
            (no handle to persist, no way around the native prompt every
            time — a fundamentally different, one-shot API from the FS
            Access handle above). Collapsed by default once auto-scan is
            configured so it stops competing with the zero-touch path;
            still front-and-center for first-time setup or unsupported
            browsers (kind === 'unsupported'). */}
        <details
          className="space-y-3"
          open={!autoScanConfigured}
        >
          <summary className="text-[10px] uppercase tracking-wide text-muted-foreground cursor-pointer pt-2 border-t border-border">
            Import manuel (fichiers / dossier)
          </summary>
          <div className="space-y-3 pt-1.5">
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

            <label className="flex items-start gap-2 text-[10px] text-muted-foreground cursor-pointer">
              <Checkbox
                checked={forceFullRescan}
                onCheckedChange={(v) => setForceFullRescan(v === true)}
                disabled={running}
                className="mt-0.5"
              />
              <span>
                <span className="text-foreground font-medium">Scan complet</span> — ignore le registre
                des fichiers déjà vus et repasse tout le dossier (utile pour rattraper un backlog
                historique). Les doublons de contenu restent détectés par hash, aucun re-coût Gemini.
              </span>
            </label>

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
          </div>
        </details>

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
