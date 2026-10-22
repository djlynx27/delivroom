-- get_surge_baselines_bulk aggregates ~500K rows (28 days x 86 zones) of
-- zone_context_vectors every 5-minute surge-detector cycle (853 ms, 13K heap
-- pages read). The existing (zone_id, captured_at desc) index finds the rows
-- but every one needs a heap fetch for surge_multiplier. Carrying that column
-- in the index lets the planner do an index-only scan: same query, same
-- results, no heap access.
CREATE INDEX IF NOT EXISTS zone_context_vectors_zone_captured_mult_idx
  ON public.zone_context_vectors (zone_id, captured_at DESC)
  INCLUDE (surge_multiplier);
