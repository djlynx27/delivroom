// One-off PC-side batch importer for a real historical backlog of Maxymo/
// Lyft screenshots (2026-09-20 incident: the S23 Ultra's own in-app batch
// kept losing the race against Gemini/PgBouncer latency under load — see
// project memory project_functions_invoke_15s_too_tight /
// project_auth_15s_timeout_too_tight). This is NOT a bypass of
// analyze-screenshot's business logic: it calls the exact same Edge
// Function, authenticated as the real driver (their own session token, not
// service_role), so zone-matching / auto-save / offer-signal recording all
// run through the same tested, RLS-respecting code path the app itself
// uses. The only thing that moves is WHERE the sequential loop and its
// pacing run — a PC process instead of the phone's WebView.
//
// Usage:
//   1. adb pull the screenshot folders to a local directory first.
//   2. tsx --env-file=.env.local src/scripts/batchImportScreenshots.ts \
//        --dir <local-pulled-folder> \
//        --access-token <driver's current access_token> \
//        --refresh-token <driver's current refresh_token>
//
// Node-only script (run via tsx, never bundled by Vite) — see
// seedSyntheticTrips.ts's identical header note on tsconfig.app.json.
/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Database, Json } from '../integrations/supabase/types';
import { createPacer } from '../lib/requestPacing';

const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;
const BUCKET = 'driver-screenshots';
// Mirrors BulkScreenshotUploader.tsx's own pacing (~54/min) under
// analyze-screenshot's 60/min limiter -- same server, same budget.
const ANALYZE_PACE_MS = 1_100;
const LEARNING_FUNCTIONS = ['score-calculator', 'weight-calibrator', 'ai-score-analysis'] as const;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function mimeFromName(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

interface ParsedArgs {
  dir: string;
  accessToken: string;
  refreshToken: string;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dir = get('--dir');
  const accessToken = get('--access-token');
  const refreshToken = get('--refresh-token');
  if (!dir || !accessToken || !refreshToken) {
    console.error(
      'Usage: tsx src/scripts/batchImportScreenshots.ts --dir <path> --access-token <token> --refresh-token <token>',
    );
    process.exit(1);
  }
  return { dir, accessToken, refreshToken };
}

async function walkImageFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkImageFiles(full)));
    } else if (IMAGE_EXT_RE.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function hashFileSync(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

// In-memory storage adapter -- this script never needs a session to
// survive past its own process lifetime.
function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

async function main() {
  const { dir, accessToken, refreshToken } = parseArgs();

  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies (--env-file=.env.local).');
  }

  const supabase = createClient<Database>(url, anonKey, {
    auth: { storage: memoryStorage(), persistSession: true, autoRefreshToken: true },
  });

  // Seeds the real driver's session -- autoRefreshToken keeps every
  // subsequent storage/functions/rest call authenticated as them for as
  // long as the script runs, using their own refresh_token, same as the
  // app itself would.
  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (sessionError || !sessionData.session) {
    throw new Error(`Session invalide ou expirée: ${sessionError?.message ?? 'no session'}`);
  }
  const userId = sessionData.session.user.id;
  console.log(`[batch-import] authentifié en tant que ${userId}`);

  console.log(`[batch-import] scan de ${dir}...`);
  const files = await walkImageFiles(dir);
  console.log(`[batch-import] ${files.length} fichier(s) image trouvé(s)`);

  const hashByFile = new Map<string, string>();
  for (const file of files) {
    hashByFile.set(file, hashFileSync(file));
  }

  // Bulk-check which hashes are already recorded, same dedup key as the
  // app (screenshotDedup.ts's findExistingUpload uses content_hash).
  const allHashes = [...hashByFile.values()];
  const knownHashes = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < allHashes.length; i += CHUNK) {
    const chunk = allHashes.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('screenshot_uploads')
      .select('content_hash')
      .in('content_hash', chunk);
    if (error) throw error;
    for (const row of data ?? []) knownHashes.add(row.content_hash);
  }

  const pending = files.filter((f) => !knownHashes.has(hashByFile.get(f)!));
  console.log(`[batch-import] ${pending.length} nouveau(x) fichier(s) à analyser (${files.length - pending.length} déjà en base)`);

  const pace = createPacer(ANALYZE_PACE_MS);
  let done = 0;
  let failed = 0;
  let autoSavedCount = 0;
  const startedAt = Date.now();

  async function importOneFile(
    filePath: string,
  ): Promise<{ ok: true; autoSaved: boolean } | { ok: false; error: string }> {
    const fileName = path.basename(filePath);
    const contentHash = hashByFile.get(filePath)!;
    const size = statSync(filePath).size;
    const mimeType = mimeFromName(fileName);
    const objectPath = `${userId}/${Date.now()}-${sanitizeFilename(fileName)}`;

    try {
      const buffer = readFileSync(filePath);
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, buffer, { contentType: mimeType, upsert: false });
      if (uploadErr) throw uploadErr;

      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(objectPath, 300);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error('no signed url');

      await pace();
      const { data, error: invokeErr } = await supabase.functions.invoke('analyze-screenshot', {
        body: { image_url: signed.signedUrl, auto_zone: true, content_hash: contentHash },
      });
      if (invokeErr) throw invokeErr;

      const analysis = (data as { analysis?: unknown; auto_saved?: boolean } | null) ?? {};

      const { error: recordErr } = await supabase.from('screenshot_uploads').insert({
        user_id: userId,
        content_hash: contentHash,
        file_path: objectPath,
        file_name: fileName,
        file_size_bytes: size,
        mime_type: mimeType,
        source: 'bulk',
        analyzed_at: new Date().toISOString(),
        analysis_result: (analysis.analysis ?? null) as Json | null,
      });
      if (recordErr && recordErr.code !== '23505') throw recordErr;

      return { ok: true, autoSaved: !!analysis.auto_saved };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  for (const filePath of pending) {
    const result = await importOneFile(filePath);
    if (result.ok) {
      done++;
      if (result.autoSaved) autoSavedCount++;
    } else {
      failed++;
      console.error(`[batch-import] échec sur ${path.basename(filePath)}: ${result.error}`);
    }

    if ((done + failed) % 25 === 0) {
      const elapsedMin = (Date.now() - startedAt) / 60_000;
      console.log(
        `[batch-import] ${done + failed}/${pending.length} traités (${done} ok, ${failed} échecs) — ${elapsedMin.toFixed(1)} min écoulées`,
      );
    }
  }

  console.log(`[batch-import] terminé : ${done} ok, ${failed} échecs, ${autoSavedCount} trip(s) auto-sauvée(s)`);

  if (autoSavedCount > 0) {
    console.log('[batch-import] déclenchement du recalcul (score-calculator, weight-calibrator, ai-score-analysis)...');
    for (const fn of LEARNING_FUNCTIONS) {
      const { error } = await supabase.functions.invoke(fn);
      if (error) console.error(`[batch-import] ${fn} a échoué:`, error.message);
      else console.log(`[batch-import] ${fn} ok`);
    }
    console.log(
      '[batch-import] Note: la synchro EMA/croyances (ema_patterns/zone_beliefs/weight_history) ' +
        'nécessite un tap manuel sur "Sync Supabase" dans Admin · Apprentissage IA — ' +
        'ce script ne la reproduit pas (dépend du contexte navigateur de learningSync.ts).',
    );
  } else {
    console.log('[batch-import] aucun trip auto-sauvé, recalcul non déclenché.');
  }
}

void main();
