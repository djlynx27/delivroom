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
import { supabase } from '@/integrations/supabase/client';
import { findExistingUpload, hashFile, recordUpload } from '@/lib/screenshotDedup';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Folder,
  FolderUp,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file, same as single uploader
const MAX_BATCH_SIZE = 100;             // safety cap so the UI stays responsive
const DEFAULT_FILTER = 'Maxymo';        // pre-fill the filter for Maxymo's default filename prefix

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
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

interface AnalysisResultMinimal {
  is_fallback?: boolean;
  extracted_data?: {
    earnings?: number | null;
    pickup_address?: string | null;
    dropoff_address?: string | null;
  };
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
  const [items, setItems] = useState<FileItem[]>([]);
  const [running, setRunning] = useState(false);
  const [nameFilter, setNameFilter] = useState(DEFAULT_FILTER);
  const [folderStats, setFolderStats] = useState<{
    totalInFolder: number;
    matched: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

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
    if (filtered.length > MAX_BATCH_SIZE) {
      toast.warning(
        `${filtered.length} fichiers trouvés — limité à ${MAX_BATCH_SIZE} pour cette session`,
      );
      filtered = filtered.slice(0, MAX_BATCH_SIZE);
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

  function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    ingest(Array.from(e.target.files ?? []), { fromFolder: false });
  }

  function pickFolder(e: React.ChangeEvent<HTMLInputElement>) {
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
          Sélectionne plusieurs screenshots d'un coup (jusqu'à {MAX_BATCH_SIZE}). Les doublons sont
          détectés via hash SHA-256 et ne consomment pas de Gemini.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
              onChange={pickFiles}
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
              onChange={pickFolder}
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
                  <StatusBadge status={it.status} />
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
