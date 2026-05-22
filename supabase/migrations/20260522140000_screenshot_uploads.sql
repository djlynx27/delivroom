-- screenshot_uploads: track every screenshot uploaded by a driver, keyed by
-- content hash so we can dedupe re-uploads of the same file (Maxymo will
-- happily re-export the same Lyft offer multiple times — analysing it twice
-- would double-count it in scoring).
--
-- 2026-05-22: created to back the bulk screenshot importer.

CREATE TABLE IF NOT EXISTS public.screenshot_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_hash    text NOT NULL,                       -- SHA-256 hex of file bytes
  file_path       text NOT NULL,                       -- path inside driver-screenshots bucket
  file_name       text,                                -- original filename (for UX)
  file_size_bytes integer,
  mime_type       text,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  analyzed_at     timestamptz,
  analysis_result jsonb,                               -- cached AnalysisResult JSON
  trip_id         uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  source          text NOT NULL DEFAULT 'manual'       -- 'manual' | 'bulk' for future filtering
                    CHECK (source IN ('manual', 'bulk')),
  notes           text
);

-- Per-user content uniqueness — drives the dedup check
CREATE UNIQUE INDEX IF NOT EXISTS screenshot_uploads_user_hash_idx
  ON public.screenshot_uploads (user_id, content_hash);

CREATE INDEX IF NOT EXISTS screenshot_uploads_user_uploaded_idx
  ON public.screenshot_uploads (user_id, uploaded_at DESC);

ALTER TABLE public.screenshot_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY screenshot_uploads_select_own ON public.screenshot_uploads
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY screenshot_uploads_insert_own ON public.screenshot_uploads
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY screenshot_uploads_update_own ON public.screenshot_uploads
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY screenshot_uploads_delete_own ON public.screenshot_uploads
  FOR DELETE
  USING (user_id = auth.uid());
