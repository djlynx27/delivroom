-- surge-detector was calling get_surge_baseline() once per zone inside a
-- sequential loop (70 zones = 70 round-trips), which is what pushed its
-- runtime to 9-15s every 5-minute cron cycle. Same query, batched: one
-- round-trip for every zone at once.
CREATE OR REPLACE FUNCTION public.get_surge_baselines_bulk(
  p_zone_ids text[],
  p_hour_slot integer,
  p_dow integer
)
RETURNS TABLE(zone_id text, baseline numeric)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  select z.zone_id, coalesce(avg(zcv.surge_multiplier), 1.0) as baseline
  from unnest(p_zone_ids) as z(zone_id)
  left join public.zone_context_vectors zcv
    on zcv.zone_id = z.zone_id
    and extract(hour from zcv.captured_at)::int between p_hour_slot - 1 and p_hour_slot + 1
    and extract(dow from zcv.captured_at)::int = p_dow
    and zcv.captured_at >= now() - interval '28 days'
  group by z.zone_id;
$function$;
