-- Fixes found by the 2026-10-05 scoring audit (confirmed live on prod):
--
-- 1. recalculate_zone_scores() was failing ~23% of its runs (456 failed vs 1560
--    ok over 14 days, every failure "violates check constraint scores_score_check").
--    It inserted ROUND(raw_score, 2) UNCLAMPED into scores.score (CHECK 0..100)
--    while raw_score = base_score x time factor x day factor reaches ~138 for a
--    base_score of 82 at peak (22 of 86 zones can exceed 100). One bad row aborts
--    the whole run (single transaction), freezing scores/current_score during
--    exactly the peak hours. final_score was already clamped; now score is too.
--    Function body is otherwise IDENTICAL to 20260910122355.
--
-- 2. weight_history had two parallel shapes: `weights` jsonb (client sync, learned
--    values, 8 factors) and w_* scalars (read by get_latest_weights() and
--    weight-calibrator, only 5 factors). Client rows never set w_*, so they sat at
--    their column defaults and get_latest_weights() returned the DEFAULT weights
--    instead of the learned ones. Conversely weight-calibrator inserts w_* with no
--    `weights`, which is NOT NULL with no default -> its INSERT always failed (no
--    'post_shift'/'auto' row exists on prod). Fix: weights gets a '{}' default, and
--    get_latest_weights() prefers the jsonb value, falling back to the w_* column.
--
-- 3. handle_new_user() was SECURITY DEFINER with search_path=public; its body only
--    uses qualified names, so search_path='' is safe.
--
-- 4. TODO(multi-tenant): ema_patterns/zone_beliefs/weight_history write policies are
--    deliberately open to any authenticated (incl. anonymous) user — fine in
--    single-driver mode (see memory project_learning_rls_scoping_decision), must be
--    scoped before DailyVroom has other users. Documented via COMMENT ON POLICY.

-- ── 1. recalculate_zone_scores: clamp score to 0..100 ───────────────────────
CREATE OR REPLACE FUNCTION public.recalculate_zone_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hour        INT;
  v_dow         INT;       -- 0 = Sunday, 6 = Saturday
  v_time_factor NUMERIC;
  v_day_factor  NUMERIC;
  zone_rec      RECORD;
  event_boost   NUMERIC;
  raw_score     NUMERIC;
  final_val     NUMERIC;
BEGIN
  -- Current local time in Montreal
  v_hour := EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'America/Toronto'))::INT;
  v_dow  := EXTRACT(DOW  FROM (NOW() AT TIME ZONE 'America/Toronto'))::INT;

  -- ── Time-of-day demand multiplier ───────────────────────────
  v_time_factor := CASE
    WHEN v_hour BETWEEN  0 AND  2 THEN 1.20   -- bars closing
    WHEN v_hour BETWEEN  3 AND  5 THEN 0.60   -- dead hours
    WHEN v_hour BETWEEN  6 AND  8 THEN 1.10   -- morning rush
    WHEN v_hour BETWEEN  9 AND 10 THEN 0.90   -- mid-morning lull
    WHEN v_hour BETWEEN 11 AND 13 THEN 1.00   -- lunch
    WHEN v_hour BETWEEN 14 AND 16 THEN 0.85   -- afternoon lull
    WHEN v_hour BETWEEN 17 AND 19 THEN 1.30   -- evening peak
    WHEN v_hour BETWEEN 20 AND 23 THEN 1.15   -- dining / nightlife
    ELSE 1.00
  END;

  -- ── Day-of-week multiplier ───────────────────────────────────
  v_day_factor := CASE v_dow
    WHEN 0 THEN 0.85   -- Sunday
    WHEN 1 THEN 0.90   -- Monday
    WHEN 2 THEN 0.90   -- Tuesday
    WHEN 3 THEN 0.95   -- Wednesday
    WHEN 4 THEN 1.00   -- Thursday
    WHEN 5 THEN 1.30   -- Friday  (peak)
    WHEN 6 THEN 1.25   -- Saturday (peak)
    ELSE 1.00
  END;

  -- ── Score every zone ─────────────────────────────────────────
  FOR zone_rec IN
    SELECT id, type, base_score, latitude, longitude
    FROM   public.zones
  LOOP
    -- Event boost: sum contributions from active events within their
    -- boost radius of this zone (haversine in km).
    SELECT COALESCE(
      SUM(
        CASE
          WHEN (
            6371.0 * 2.0 * ASIN(SQRT(
              POWER(SIN((RADIANS(e.latitude)  - RADIANS(zone_rec.latitude))  / 2.0), 2) +
              COS(RADIANS(zone_rec.latitude)) * COS(RADIANS(e.latitude)) *
              POWER(SIN((RADIANS(e.longitude) - RADIANS(zone_rec.longitude)) / 2.0), 2)
            ))
          ) <= COALESCE(e.boost_radius_km, 3.0)
          THEN LEAST((e.boost_multiplier - 1.0) * 15.0, 20.0)
          ELSE 0.0
        END
      ),
      0.0
    )
    INTO event_boost
    FROM public.events e
    WHERE e.start_at <= NOW()
      AND e.end_at   >= NOW();

    -- Cap total event boost at 25 pts
    event_boost := LEAST(event_boost, 25.0);

    -- base_score × time × day + event boost, clamped to [0, 100]
    raw_score := COALESCE(zone_rec.base_score, 50)::NUMERIC
                 * v_time_factor
                 * v_day_factor;

    -- Off-peak commercial/mall penalty — most shopping centres are shut
    -- overnight; this catches every commercial zone, not just the one that
    -- triggered this incident.
    IF zone_rec.type = 'commercial' AND (v_hour >= 22 OR v_hour < 6) THEN
      raw_score := raw_score * 0.1;
    END IF;

    final_val := LEAST(100.0, GREATEST(0.0, ROUND(raw_score + event_boost)));

    -- Insert historical score row
    INSERT INTO public.scores
      (zone_id, score, weather_boost, event_boost, final_score, calculated_at)
    VALUES
      (zone_rec.id,
       LEAST(100.0, GREATEST(0.0, ROUND(raw_score, 2))),  -- clamp: scores_score_check is 0..100
       0.0,
       ROUND(event_boost, 2),
       final_val,
       NOW());

    -- Keep zone.current_score fresh for fast queries
    UPDATE public.zones
    SET    current_score = final_val::INT,
           updated_at    = NOW()
    WHERE  id = zone_rec.id;
  END LOOP;

  -- Purge score history older than 24 hours to keep the table lean
  DELETE FROM public.scores
  WHERE calculated_at < NOW() - INTERVAL '24 hours';
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_zone_scores() TO service_role;

-- ── 2. weight_history / get_latest_weights ───────────────────────────────────
ALTER TABLE public.weight_history ALTER COLUMN weights SET DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.get_latest_weights()
RETURNS TABLE (
  w_time        NUMERIC,
  w_day         NUMERIC,
  w_weather     NUMERIC,
  w_events      NUMERIC,
  w_historical  NUMERIC,
  calibrated_at TIMESTAMPTZ,
  mae           NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  -- jsonb keys are the client's WeightConfig names; only used when numeric so a
  -- malformed value can never make this function throw.
  SELECT
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'timeOfDay') = 'number' THEN (wh.weights->>'timeOfDay')::numeric END, wh.w_time),
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'dayOfWeek') = 'number' THEN (wh.weights->>'dayOfWeek')::numeric END, wh.w_day),
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'weather') = 'number' THEN (wh.weights->>'weather')::numeric END, wh.w_weather),
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'events') = 'number' THEN (wh.weights->>'events')::numeric END, wh.w_events),
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'historicalEarnings') = 'number' THEN (wh.weights->>'historicalEarnings')::numeric END, wh.w_historical),
    wh.created_at AS calibrated_at,
    COALESCE(wh.mae, wh.prediction_mae)
  FROM public.weight_history wh
  ORDER BY wh.created_at DESC
  LIMIT 1;
$$;

-- ── 3. handle_new_user search_path ───────────────────────────────────────────
ALTER FUNCTION public.handle_new_user() SET search_path = '';

-- ── 4. Document the deliberately open learning-table write policies ──────────
COMMENT ON POLICY "ema_patterns_insert" ON public.ema_patterns IS 'TODO(multi-tenant): any authenticated (incl. anonymous) user can write the shared model; scope before DailyVroom has other users.';
COMMENT ON POLICY "ema_patterns_update" ON public.ema_patterns IS 'TODO(multi-tenant): see ema_patterns_insert.';
COMMENT ON POLICY "zone_beliefs_insert" ON public.zone_beliefs IS 'TODO(multi-tenant): see ema_patterns_insert.';
COMMENT ON POLICY "zone_beliefs_update" ON public.zone_beliefs IS 'TODO(multi-tenant): see ema_patterns_insert.';
COMMENT ON POLICY "weight_history_insert" ON public.weight_history IS 'TODO(multi-tenant): see ema_patterns_insert. Also: source=manual is spoofable.';
