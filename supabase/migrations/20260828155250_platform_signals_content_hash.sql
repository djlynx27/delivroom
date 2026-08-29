-- ============================================================
-- Migration: platform_signals_content_hash
-- Delivroom (hibzhsjgipybfihhzpxr)
--
-- ingest-lyft-screenshots (external MacroDroid entrypoint) has no
-- idempotency guard: if the automation retries a POST (timeout, flaky
-- mobile network), the same 3 screenshots get re-sent and re-billed to
-- Gemini Vision even though the content is byte-identical. content_hash
-- lets the Edge Function skip the Gemini call and replay the existing
-- signal when the same snapshot arrives again within a short window.
-- ============================================================

ALTER TABLE public.platform_signals
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE INDEX IF NOT EXISTS idx_platform_signals_content_hash
  ON public.platform_signals(content_hash, captured_at DESC)
  WHERE content_hash IS NOT NULL;
