ALTER TABLE public.screenshot_uploads
  ADD COLUMN IF NOT EXISTS storage_purged_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_screenshot_uploads_purge_candidates
  ON public.screenshot_uploads (analyzed_at)
  WHERE storage_purged_at IS NULL;
