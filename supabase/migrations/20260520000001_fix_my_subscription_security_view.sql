-- Fix Security Definer view for public.my_subscription
-- This makes the view execute with the querying user's permissions
-- so RLS applies to the current authenticated user.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_views
    WHERE schemaname = 'public'
      AND viewname = 'my_subscription'
  ) THEN
    EXECUTE 'ALTER VIEW public.my_subscription SET (security_invoker = true)';
  END IF;
END
$$;
