-- zone_discoveries: log addresses that AI sees in screenshots but can't match
-- to the existing 61-zone catalog. Drives a future flow where the driver
-- can promote frequent discoveries to real zones.
--
-- 2026-05-22: created in response to analyze-screenshot finding pickup/dropoff
-- addresses outside the current sparse catalog (e.g. residential
-- Saint-Laurent / Laval streets).

CREATE TABLE IF NOT EXISTS public.zone_discoveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address         text NOT NULL,
  context         text NOT NULL CHECK (context IN ('pickup', 'dropoff', 'other')),
  city_hint       text REFERENCES public.cities(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  count           integer NOT NULL DEFAULT 1,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'promoted', 'rejected')),
  promoted_zone_id text REFERENCES public.zones(id) ON DELETE SET NULL,
  notes           text
);

-- Unique per (normalized address, context) so we can upsert and increment count
CREATE UNIQUE INDEX IF NOT EXISTS zone_discoveries_addr_context_idx
  ON public.zone_discoveries (lower(address), context);

CREATE INDEX IF NOT EXISTS zone_discoveries_status_idx
  ON public.zone_discoveries (status, last_seen_at DESC);

ALTER TABLE public.zone_discoveries ENABLE ROW LEVEL SECURITY;

-- Each driver only sees their own discoveries
CREATE POLICY zone_discoveries_select_own ON public.zone_discoveries
  FOR SELECT
  USING (user_id = auth.uid());

-- Inserts and updates happen exclusively via the Edge Function
-- (service_role) so we deliberately do NOT add INSERT/UPDATE policies for
-- anon or authenticated. Future admin UI will go through an Edge Function
-- with service_role to promote rows.
