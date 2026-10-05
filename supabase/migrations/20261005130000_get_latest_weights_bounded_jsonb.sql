-- Follow-up to 20261005120000 (security review finding): that migration made
-- get_latest_weights() prefer the weight_history.weights jsonb over the w_*
-- columns, but chk_weights_positive only covers w_*, and weight_history_insert is
-- open to any authenticated (incl. anonymous) user. A negative/huge jsonb weight
-- would have been served as-is to weight-calibrator. Read-side sanitization: a
-- jsonb value is only used when it is numeric AND within [0, 1]; otherwise the
-- matching w_* column (CHECK-protected) is used. Same signature/return shape.
-- (Chosen over a CHECK on `weights` so a legitimate client/calibrator INSERT with
-- a slightly out-of-range weight can never be rejected.)

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
  SELECT
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'timeOfDay') = 'number' AND (wh.weights->>'timeOfDay')::numeric BETWEEN 0 AND 1 THEN (wh.weights->>'timeOfDay')::numeric END, wh.w_time),
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'dayOfWeek') = 'number' AND (wh.weights->>'dayOfWeek')::numeric BETWEEN 0 AND 1 THEN (wh.weights->>'dayOfWeek')::numeric END, wh.w_day),
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'weather') = 'number' AND (wh.weights->>'weather')::numeric BETWEEN 0 AND 1 THEN (wh.weights->>'weather')::numeric END, wh.w_weather),
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'events') = 'number' AND (wh.weights->>'events')::numeric BETWEEN 0 AND 1 THEN (wh.weights->>'events')::numeric END, wh.w_events),
    COALESCE(CASE WHEN jsonb_typeof(wh.weights->'historicalEarnings') = 'number' AND (wh.weights->>'historicalEarnings')::numeric BETWEEN 0 AND 1 THEN (wh.weights->>'historicalEarnings')::numeric END, wh.w_historical),
    wh.created_at AS calibrated_at,
    COALESCE(wh.mae, wh.prediction_mae)
  FROM public.weight_history wh
  ORDER BY wh.created_at DESC
  LIMIT 1;
$$;
