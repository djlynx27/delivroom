import { supabase } from '@/integrations/supabase/client';
import { bufferToBase64Url } from '@/hooks/useNotifications';

/**
 * Fires the server-side push for the 15-min dead-time alert (see
 * supabase/functions/zone-idle-alert) so the driver is notified even if
 * Delivroom is backgrounded behind Lyft/Uber at the moment the threshold is
 * crossed. Best-effort: DeadTimeTimer already shows the same warning
 * in-app regardless, so a failed push must never surface as an error there.
 *
 * Always reads and sends this device's OWN already-registered push
 * subscription endpoint (never invents/accepts one from elsewhere) — that's
 * what scopes zone-idle-alert's delivery to this one device instead of
 * every driver's subscription (see that function's header comment; this app
 * signs visitors in anonymously, so the request's JWT alone proves nothing
 * about who's calling). No subscription registered yet -> nothing to do.
 */
export async function triggerZoneIdlePush(zoneName: string | null): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const authKey = subscription.getKey('auth');
    if (!authKey) return;

    await supabase.functions.invoke('zone-idle-alert', {
      body: {
        zoneName,
        endpoint: subscription.endpoint,
        auth: bufferToBase64Url(authKey),
      },
    });
  } catch (err) {
    console.warn('zone-idle-alert push failed (non-blocking):', err);
  }
}
