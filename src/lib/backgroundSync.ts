// Browser-side helpers to opt the app into Periodic Background Sync for the
// Maxymo folder rescan. Periodic Background Sync is Chromium-only and gated
// behind a site-engagement metric; this code is defensive everywhere so it
// stays a no-op on unsupported browsers or denied permissions.

import { MAXYMO_SYNC_TAG } from '@/lib/maxymoScanner';

interface PeriodicSyncRegistration {
  register: (tag: string, options: { minInterval: number }) => Promise<void>;
  unregister: (tag: string) => Promise<void>;
}

interface RegistrationWithSync extends ServiceWorkerRegistration {
  periodicSync?: PeriodicSyncRegistration;
}

async function getRegistration(): Promise<RegistrationWithSync | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.ready) as RegistrationWithSync;
  } catch {
    return null;
  }
}

/**
 * Best-effort registration of the periodic Maxymo scan. Returns true if the
 * browser accepted the registration, false otherwise (unsupported, permission
 * denied, browser dropped it for low engagement, etc.).
 */
export async function registerMaxymoPeriodicSync(): Promise<boolean> {
  const reg = await getRegistration();
  if (!reg?.periodicSync) return false;

  // Periodic Background Sync needs its own permission grant on Chrome
  // ('periodic-background-sync'). Skip silently if denied.
  try {
    const permission = await navigator.permissions.query({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      name: 'periodic-background-sync' as any,
    });
    if (permission.state === 'denied') return false;
  } catch {
    // Browser doesn't know this permission name yet — try registering anyway,
    // the call below will throw if not allowed.
  }

  try {
    // 12 h is the practical minimum Chrome honours
    await reg.periodicSync.register(MAXYMO_SYNC_TAG, {
      minInterval: 12 * 60 * 60 * 1000,
    });
    return true;
  } catch (err) {
    console.info('[backgroundSync] periodic sync not registered:', err);
    return false;
  }
}

export async function unregisterMaxymoPeriodicSync(): Promise<void> {
  const reg = await getRegistration();
  if (!reg?.periodicSync) return;
  try {
    await reg.periodicSync.unregister(MAXYMO_SYNC_TAG);
  } catch {
    // ignore
  }
}

/**
 * Ask the user for Notification permission so periodic-sync can pop a system
 * notification. Returns the resulting state. Existing 'denied' is respected
 * (we never re-prompt — would just annoy the user).
 */
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  return await Notification.requestPermission();
}
