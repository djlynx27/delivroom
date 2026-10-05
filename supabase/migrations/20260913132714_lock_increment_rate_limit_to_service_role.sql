-- increment_rate_limit is SECURITY DEFINER and was left executable by
-- anon/authenticated (PostgREST default grant on new functions). Any anon
-- key holder could call /rest/v1/rpc/increment_rate_limit directly and
-- manipulate edge_rate_limits, bypassing the limiter it's meant to enforce.
-- Only Edge Functions call it, always via a service_role client (see
-- supabase/functions/_shared/rateLimit.ts) — restrict accordingly.

REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, TIMESTAMPTZ) TO service_role;
