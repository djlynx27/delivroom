-- surge-detector's loadPriorSurgeState ran
--   select ... from zone_context_vectors where zone_id in (...)
--   order by captured_at desc limit <zones*3>
-- A global ORDER BY captured_at can't use the (zone_id, captured_at desc) index,
-- so every 5-minute cycle seq-scanned ~1M rows (267 MB) and hit the statement
-- timeout under load (Sentry issue 7720723821, 1170 events). It was also lossy:
-- the LIMIT was global, so a zone with no recent row could be missed.
-- Same result, but one index probe per zone via LATERAL: exactly the latest row
-- of each requested zone, using zone_context_vectors_zone_captured_idx.
CREATE OR REPLACE FUNCTION public.get_prior_surge_states_bulk(
  p_zone_ids text[]
)
RETURNS TABLE(zone_id text, surge_class text, surge_multiplier numeric)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  select z.zone_id, l.surge_class, l.surge_multiplier
  from unnest(p_zone_ids) as z(zone_id)
  cross join lateral (
    select zcv.surge_class, zcv.surge_multiplier
    from public.zone_context_vectors zcv
    where zcv.zone_id = z.zone_id
    order by zcv.captured_at desc
    limit 1
  ) l;
$function$;
