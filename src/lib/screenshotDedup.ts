import { supabase } from '@/integrations/supabase/client';

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
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
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
      analysis_result: input.analysisResult ?? null,
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
