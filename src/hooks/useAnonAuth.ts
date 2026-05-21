import { supabase } from '@/integrations/supabase/client';
import { useEffect, useState } from 'react';

type AuthStatus = 'loading' | 'ready' | 'error';

export function useAnonAuth(): { status: AuthStatus; error: string | null } {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function ensureSession() {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        if (!cancelled) setStatus('ready');
        return;
      }

      const { error: signInError } = await supabase.auth.signInAnonymously();
      if (cancelled) return;

      if (signInError) {
        console.error('[useAnonAuth] signInAnonymously failed:', signInError);
        setError(signInError.message);
        setStatus('error');
        return;
      }
      setStatus('ready');
    }

    void ensureSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, error };
}
