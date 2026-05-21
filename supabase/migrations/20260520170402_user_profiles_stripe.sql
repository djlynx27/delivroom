-- Migration A2 : user_profiles + Stripe subscription schema

-- ============================================
-- TABLE : user_profiles
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Infos de base
  full_name TEXT,
  display_name TEXT,
  avatar_url TEXT,

  -- Stripe
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  stripe_current_period_end TIMESTAMPTZ,
  subscription_status TEXT DEFAULT 'inactive'
    CHECK (subscription_status IN ('active', 'inactive', 'trialing', 'past_due', 'canceled', 'unpaid')),

  -- App-specific
  vehicle_type TEXT DEFAULT 'car',
  preferred_zones UUID[],
  onboarding_completed BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS obligatoire
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users voient et modifient seulement leur propre profil
CREATE POLICY "user_profiles_self_access" ON public.user_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index sur user_id et stripe_customer_id
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer ON public.user_profiles(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_subscription_status ON public.user_profiles(subscription_status);

-- ============================================
-- TRIGGER : auto-create profile sur signup
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Créer le trigger sur auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- TRIGGER : updated_at auto-update
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_profiles_updated ON public.user_profiles;
CREATE TRIGGER on_user_profiles_updated
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================
-- TABLE : stripe_events (log webhook events)
-- ============================================
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  processed BOOLEAN DEFAULT false,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS : seul le service role peut écrire les events (webhook)
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

-- Les users ne peuvent pas lire les stripe_events directement
-- (seul le backend via service_role_key y accède)
CREATE POLICY "stripe_events_service_only" ON public.stripe_events
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Index pour déduplications des webhooks
CREATE INDEX IF NOT EXISTS idx_stripe_events_stripe_id ON public.stripe_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON public.stripe_events(event_type);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON public.stripe_events(processed);

-- ============================================
-- VIEW : subscription_status (pour le frontend)
-- ============================================
CREATE OR REPLACE VIEW public.my_subscription AS
SELECT
  up.user_id,
  up.stripe_customer_id,
  up.stripe_subscription_id,
  up.subscription_status,
  up.stripe_current_period_end,
  CASE
    WHEN up.subscription_status = 'active' THEN true
    WHEN up.subscription_status = 'trialing' THEN true
    ELSE false
  END AS is_active
FROM public.user_profiles up
WHERE up.user_id = auth.uid();

-- RLS sur la view (hérite de user_profiles)
-- La view filtre déjà via WHERE user_id = auth.uid()
