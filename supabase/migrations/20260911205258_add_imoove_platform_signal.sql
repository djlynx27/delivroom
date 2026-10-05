-- ============================================================
-- Allow 'imoove' in platform_signals.platform
-- ============================================================
-- Imoove (Taxi Express Plan F) is one of the 3 platforms this driver
-- actually runs (see global CLAUDE.md §5) but chk_platform's original list
-- ('lyft', 'doordash', 'skipthedishes', 'hypra', 'uber', 'other') never
-- included it -- any signal insert for imoove would fail at the DB layer,
-- independent of the platform-signal-collector/frontend gaps fixed
-- alongside this migration.

ALTER TABLE public.platform_signals
  DROP CONSTRAINT chk_platform;

ALTER TABLE public.platform_signals
  ADD CONSTRAINT chk_platform CHECK (
    platform IN ('lyft', 'doordash', 'skipthedishes', 'hypra', 'uber', 'imoove', 'other')
  );
