-- Migration A1 : RLS fix pour trips + sessions + notifications
-- Ajouter user_id là où il manque + corriger les policies

-- ============================================
-- TABLE : trips
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'trips'
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.trips ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Activer RLS sur trips
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- Supprimer les policies existantes si elles existent
DROP POLICY IF EXISTS "trips_user_isolation" ON public.trips;
DROP POLICY IF EXISTS "users own trips" ON public.trips;

-- Policy : users voient seulement leurs propres trips
CREATE POLICY "trips_user_isolation" ON public.trips
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index sur user_id pour performance
CREATE INDEX IF NOT EXISTS idx_trips_user_id ON public.trips(user_id);

-- ============================================
-- TABLE : sessions
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'sessions'
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.sessions ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Activer RLS sur sessions
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Supprimer les policies existantes
DROP POLICY IF EXISTS "sessions_user_isolation" ON public.sessions;
DROP POLICY IF EXISTS "users own sessions" ON public.sessions;

-- Policy : users voient seulement leurs propres sessions
CREATE POLICY "sessions_user_isolation" ON public.sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index sur user_id
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);

-- ============================================
-- TABLE : notifications
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'notifications'
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Activer RLS sur notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Supprimer les policies existantes
DROP POLICY IF EXISTS "notifications_user_isolation" ON public.notifications;
DROP POLICY IF EXISTS "users own notifications" ON public.notifications;

-- Policy : users voient seulement leurs propres notifications
CREATE POLICY "notifications_user_isolation" ON public.notifications
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index sur user_id
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
