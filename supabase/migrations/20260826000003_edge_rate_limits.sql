-- Fixed-window rate limiter for the Gemini-calling Edge Functions
-- (score-calculator, ai-score-analysis, analyze-screenshot,
-- generate-daily-report). They're deployed --no-verify-jwt-free callable
-- by anyone with the public anon key with nothing throttling repeated
-- calls, which is a cost/quota-exhaustion risk on the Gemini API key.

CREATE TABLE IF NOT EXISTS public.edge_rate_limits (
  fn           TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (fn, window_start)
);

ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: only reachable via the SECURITY DEFINER function below, or
-- the service_role key (which bypasses RLS) — never directly by a client.

CREATE OR REPLACE FUNCTION public.increment_rate_limit(p_fn TEXT, p_window_start TIMESTAMPTZ)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pruned AS (
    DELETE FROM public.edge_rate_limits WHERE window_start < now() - interval '1 hour'
  )
  INSERT INTO public.edge_rate_limits (fn, window_start, count)
  VALUES (p_fn, p_window_start, 1)
  ON CONFLICT (fn, window_start) DO UPDATE SET count = edge_rate_limits.count + 1
  RETURNING count;
$$;
