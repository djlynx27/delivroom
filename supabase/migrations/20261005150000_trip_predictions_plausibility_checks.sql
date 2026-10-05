-- Follow-up to 20261005140000 (security review: data poisoning). trip_predictions
-- INSERT is open to any signed-in (incl. anonymous) session and feeds
-- weight-calibrator, so reject absurd values at the schema level. These bound the
-- damage of crafted rows; they cannot detect plausible-but-false data (that needs
-- the multi-tenant RLS lockdown, see the TODO on the insert policy).
--
-- Bounds: $/h in [0, 300] (note: a very short, well-paid ride can exceed 300 $/h,
-- e.g. $12 in 2 min — such a row is rejected and silently dropped by
-- usePostTripFeedback, which catches the error AFTER the trip itself is saved).
-- error/abs_error are written rounded to 3 decimals by the client while
-- actual_earnings_per_h is stored at 2, so consistency is checked with a 0.01
-- tolerance instead of strict equality. NULLs pass (all columns are nullable).
ALTER TABLE public.trip_predictions
  ADD CONSTRAINT chk_tp_actual_eph_range CHECK (actual_earnings_per_h BETWEEN 0 AND 300),
  ADD CONSTRAINT chk_tp_predicted_eph_range CHECK (predicted_earnings_per_h BETWEEN 0 AND 300),
  ADD CONSTRAINT chk_tp_hour_range CHECK (hour_of_day BETWEEN 0 AND 23),
  ADD CONSTRAINT chk_tp_dow_range CHECK (day_of_week BETWEEN 0 AND 6),
  ADD CONSTRAINT chk_tp_zone_score_range CHECK (zone_score_at_start BETWEEN 0 AND 100),
  ADD CONSTRAINT chk_tp_error_range CHECK (error BETWEEN -300 AND 300),
  ADD CONSTRAINT chk_tp_abs_error_consistent CHECK (
    abs_error IS NULL OR (abs_error >= 0 AND abs_error <= 300 AND (error IS NULL OR abs(abs_error - abs(error)) <= 0.01))
  );
