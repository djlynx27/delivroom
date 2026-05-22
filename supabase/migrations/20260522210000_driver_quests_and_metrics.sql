-- Two related tables that together turn Delivroom into a driver-side ops
-- dashboard for Lyft / Uber / Hypra rebate programs + account health.
--
-- 2026-05-22: created in response to the "decision-agent + quest tracker
-- + health tracker" trio of asks. Both tables are user-scoped (RLS) and
-- writable only by the owning driver via the WebView client.

-- ── driver_quests ───────────────────────────────────────────────────────
-- One row per active bonus quest the driver is working toward. Examples:
-- - Lyft Weekly Quest: "30 rides Mon→Sun for $80 bonus"
-- - Uber Quest: "10 rides Fri→Sat for $50 bonus"
-- - Hypra Plan F monthly target

CREATE TABLE IF NOT EXISTS public.driver_quests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('lyft', 'uber', 'hypra', 'imoove', 'doordash', 'ubereats', 'skip')),
  name          text NOT NULL,                       -- e.g. "Weekly 30 rides"
  current_count integer NOT NULL DEFAULT 0,
  target_count  integer NOT NULL,
  bonus_amount  numeric NOT NULL DEFAULT 0,          -- CAD
  deadline      timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'completed', 'failed', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_quests_user_status_idx
  ON public.driver_quests (user_id, status, deadline);

ALTER TABLE public.driver_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_quests_select_own ON public.driver_quests
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY driver_quests_insert_own ON public.driver_quests
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY driver_quests_update_own ON public.driver_quests
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY driver_quests_delete_own ON public.driver_quests
  FOR DELETE USING (user_id = auth.uid());

-- ── driver_metrics ──────────────────────────────────────────────────────
-- Snapshot of driver-account health per platform. Used to alert the driver
-- BEFORE they fall under a threshold that causes Lyft to skip them in
-- matching or, worse, deactivate the account.

CREATE TABLE IF NOT EXISTS public.driver_metrics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform          text NOT NULL CHECK (platform IN ('lyft', 'uber', 'hypra', 'imoove', 'doordash', 'ubereats', 'skip')),
  acceptance_rate   numeric,                          -- 0..100
  cancellation_rate numeric,                          -- 0..100
  rating            numeric,                          -- 0..5
  trips_completed   integer,
  measured_at       timestamptz NOT NULL DEFAULT now(),
  source            text NOT NULL DEFAULT 'manual'    -- 'manual' | 'ocr'
                      CHECK (source IN ('manual', 'ocr')),
  notes             text
);

-- Latest snapshot per (user, platform) is the one we read in the UI; the
-- table is append-only so we keep a small history for trend graphs.
CREATE INDEX IF NOT EXISTS driver_metrics_user_platform_idx
  ON public.driver_metrics (user_id, platform, measured_at DESC);

ALTER TABLE public.driver_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_metrics_select_own ON public.driver_metrics
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY driver_metrics_insert_own ON public.driver_metrics
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY driver_metrics_update_own ON public.driver_metrics
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY driver_metrics_delete_own ON public.driver_metrics
  FOR DELETE USING (user_id = auth.uid());
