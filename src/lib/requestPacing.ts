/**
 * Enforces a minimum spacing between calls to a rate-limited resource, for
 * a caller that's already sequential (no concurrency to throttle) but can
 * still submit faster than the resource's own per-minute budget when each
 * step is quick. See analyze-screenshot's 60/min limit
 * (supabase/functions/_shared/rateLimit.ts) — a large bulk-import batch
 * confirmed this necessary on-device (eed257b fixed the server from
 * silently swallowing the overflow as 200s; this keeps the client under
 * the budget in the first place instead of leaning on that retry path).
 */
export function createPacer(minIntervalMs: number) {
  let lastCallAt = 0;

  return async function pace(): Promise<void> {
    const wait = minIntervalMs - (Date.now() - lastCallAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastCallAt = Date.now();
  };
}
