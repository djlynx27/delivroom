REVOKE EXECUTE ON FUNCTION public.cleanup_old_screenshot_uploads() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_screenshot_uploads() TO service_role;
