import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fixed-window rate limit backed by public.increment_rate_limit (see
// migration 20260826000003_edge_rate_limits.sql). Fails open on an infra
// hiccup — a broken limiter shouldn't take down the feature it's guarding.
export async function isRateLimited(
  client: SupabaseClient,
  fnName: string,
  limitPerMinute: number
): Promise<boolean> {
  const windowStart = new Date();
  windowStart.setSeconds(0, 0);

  const { data, error } = await client.rpc('increment_rate_limit', {
    p_fn: fnName,
    p_window_start: windowStart.toISOString(),
  });

  if (error) {
    console.error(`rate limit check failed for ${fnName}, failing open`, error);
    return false;
  }
  return (data as number) > limitPerMinute;
}
