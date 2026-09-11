import { supabase } from '@/integrations/supabase/client';

/**
 * Fires the server-side push for the 15-min dead-time alert (see
 * supabase/functions/zone-idle-alert) so the driver is notified even if
 * Delivroom is backgrounded behind Lyft/Uber at the moment the threshold is
 * crossed. Best-effort: DeadTimeTimer already shows the same warning
 * in-app regardless, so a failed push must never surface as an error there.
 */
export async function triggerZoneIdlePush(zoneName: string | null): Promise<void> {
  try {
    await supabase.functions.invoke('zone-idle-alert', {
      body: { zoneName },
    });
  } catch (err) {
    console.warn('zone-idle-alert push failed (non-blocking):', err);
  }
}
