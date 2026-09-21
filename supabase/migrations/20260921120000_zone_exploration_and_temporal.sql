-- supabase/migrations/20260921120000_zone_exploration_and_temporal.sql
--
-- Bayesian exploration bonus & temporal (POI) zones — see
-- docs/superpowers/specs/2026-09-21-bayesian-exploration-and-temporal-zones-design.md
--
-- 1. is_temporal/active_windows generalize MEDICAL_SHIFT_HOURS (hardcoded
--    in src/lib/scoringEngine.ts) into a data-driven mechanism usable by
--    any future POI (CEGEP, school) without touching source code.
-- 2. Seeds CHUM / Hôpital Cité-de-la-Santé with the exact windows the old
--    hardcoded logic produced, so this is a behavior-preserving refactor.

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS is_temporal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_windows jsonb NOT NULL DEFAULT '[]';

-- Old MEDICAL_SHIFT_HOURS = [7, 15, 19, 23] logic: triggered when
-- diff(hour, shiftHour) === 0, or diff === 1 gated by the :30 half-hour
-- split (shiftHour > hour && min >= 30, or shiftHour < hour && min <= 30).
-- That resolves to a fixed 6:30–8:30 / 14:30–16:30 / 18:30–20:30 /
-- 22:30–00:30 window per shift hour, with the old *= 1.3 multiplier.
UPDATE public.zones
SET is_temporal = true,
    active_windows = '[
      {"days": [], "startHour": 6,  "startMin": 30, "endHour": 8,  "endMin": 30, "weight_multiplier": 1.3},
      {"days": [], "startHour": 14, "startMin": 30, "endHour": 16, "endMin": 30, "weight_multiplier": 1.3},
      {"days": [], "startHour": 18, "startMin": 30, "endHour": 20, "endMin": 30, "weight_multiplier": 1.3},
      {"days": [], "startHour": 22, "startMin": 30, "endHour": 0,  "endMin": 30, "weight_multiplier": 1.3}
    ]'::jsonb
WHERE name IN ('CHUM Hôpital', 'Hôpital Cité-de-la-Santé');
