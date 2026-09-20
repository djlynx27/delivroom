import { ensureAuthSession } from '@/hooks/useAnonAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { Session } from '@supabase/supabase-js';

export interface ExistingUpload {
  id: string;
  file_path: string;
  uploaded_at: string;
  analyzed_at: string | null;
  analysis_result: unknown;
}

/**
 * SHA-256 hash of the file bytes, hex-encoded.
 *
 * Used to dedupe screenshot re-uploads — a Maxymo export of the same Lyft
 * offer produces a byte-identical file each time, so we can detect doubles
 * cheaply before paying the Gemini API.
 */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Look up a previous upload by (current user, content hash). Returns null
 * if this file has never been seen.
 */
export async function findExistingUpload(
  contentHash: string,
): Promise<ExistingUpload | null> {
  const { data, error } = await supabase
    .from('screenshot_uploads')
    .select('id, file_path, uploaded_at, analyzed_at, analysis_result')
    .eq('content_hash', contentHash)
    .maybeSingle();
  if (error) {
    console.error('[screenshotDedup] lookup failed:', error);
    return null;
  }
  return data;
}

/**
 * Bulk pre-filter for an incremental folder scan: checks which (name, size)
 * candidates already have a screenshot_uploads row for the current user, in
 * one query — cheaper than hashing every file in a large folder just to
 * find out most were already imported. RLS scopes the result to the
 * signed-in user, same as findExistingUpload above.
 */
export async function findExistingFileNames(
  candidates: { name: string; size: number }[],
): Promise<Set<string>> {
  if (!candidates.length) return new Set();
  const names = Array.from(new Set(candidates.map((c) => c.name)));
  const { data, error } = await supabase
    .from('screenshot_uploads')
    .select('file_name, file_size_bytes')
    .in('file_name', names);
  if (error) {
    console.error('[screenshotDedup] bulk filename lookup failed:', error);
    return new Set();
  }
  return new Set((data ?? []).map((r) => fileKey(r.file_name, r.file_size_bytes)));
}

export function fileKey(name: string, size: number): string {
  return `${name}::${size}`;
}

/**
 * Resolves the current user id for an authenticated write. Uses
 * getSession() (reads the locally persisted/auto-refreshed session, no
 * network call) instead of getUser() (a network round-trip to the auth
 * server) — a bulk batch previously called getUser() once per file
 * (hundreds of times per run), and any transient hiccup on that one
 * specific call surfaced as a false "Authentification requise", even
 * though the real upload/analyze calls would have worked fine with the
 * same valid session.
 *
 * Two distinct recovery paths matter here, not one: a session that EXISTS
 * but expired needs refreshSession() (uses its refresh token); a batch
 * started right after app launch can race useAnonAuth's own background
 * signInAnonymously() and see NO session at all yet — refreshSession() has
 * nothing to refresh in that case and just returns null again, so it must
 * go through ensureAuthSession() instead, which shares useAnonAuth's own
 * in-flight sign-in rather than racing a second one.
 */
type AuthRecoveryPath = 'ensureAuthSession' | 'refreshSession' | 'existing';

function pickAuthRecoveryPath(session: Session | null): AuthRecoveryPath {
  if (!session) return 'ensureAuthSession';
  if (session.expires_at != null && session.expires_at * 1000 < Date.now()) {
    return 'refreshSession';
  }
  return 'existing';
}

// Diagnostic for the exact "Authentification requise" case reported on a
// real 1200+ file batch — captures which recovery path was taken and why it
// still came up empty, instead of guessing again.
function warnNoUserId(path: AuthRecoveryPath, hadInitialSession: boolean, session: Session | null) {
  console.warn('[screenshotDedup] getAuthedUserId: no user id resolved', {
    path,
    hadInitialSession,
    isAnonymous: session?.user?.is_anonymous ?? null,
  });
}

export async function getAuthedUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  const path = pickAuthRecoveryPath(session);
  if (path === 'ensureAuthSession') {
    session = await ensureAuthSession();
  } else if (path === 'refreshSession') {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed.session;
  }
  const userId = session?.user?.id ?? null;
  if (!userId) warnNoUserId(path, !!data.session, session);
  return userId;
}

export interface RecordUploadInput {
  contentHash: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  source: 'manual' | 'bulk';
  analysisResult?: unknown;
  tripId?: string | null;
}

/**
 * Persist a new screenshot_uploads row after a successful upload + analysis.
 * Returns the inserted id, or null on failure (failure is non-fatal — the
 * file is still uploaded, we just lose the dedup record).
 */
export async function recordUpload(
  input: RecordUploadInput,
): Promise<string | null> {
  const userId = await getAuthedUserId();
  if (!userId) {
    console.warn('[screenshotDedup] no auth user, skipping record');
    return null;
  }
  const { data, error } = await supabase
    .from('screenshot_uploads')
    .insert({
      user_id: userId,
      content_hash: input.contentHash,
      file_path: input.filePath,
      file_name: input.fileName,
      file_size_bytes: input.fileSizeBytes,
      mime_type: input.mimeType,
      source: input.source,
      analyzed_at: input.analysisResult ? new Date().toISOString() : null,
      analysis_result: (input.analysisResult ?? null) as Json | null,
      trip_id: input.tripId ?? null,
    })
    .select('id')
    .single();
  if (error) {
    // Conflict on the unique (user_id, content_hash) — race with another tab.
    // Not an error to surface to the user.
    if (error.code === '23505') return null;
    console.error('[screenshotDedup] insert failed:', error);
    return null;
  }
  return data.id;
}
