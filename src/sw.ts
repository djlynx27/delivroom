/// <reference lib="webworker" />
import {
  ensureReadPermission,
  fileKey,
  getSeenKeys,
  getStoredHandle,
  MAXYMO_SYNC_TAG,
  scanFolder,
  setSeenKeys,
} from '@/lib/maxymoScanner';
import { pushSharedFiles } from '@/lib/shareInbox';
import { RETRY_UPLOAD_SYNC_TAG } from '@/lib/uploadRetryQueue';
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

interface PeriodicSyncEvent extends ExtendableEvent {
  tag: string;
}

// Background Sync (one-off, Chromium-only) isn't in the standard TS
// webworker lib yet — same situation as PeriodicSyncEvent above.
interface SyncEvent extends ExtendableEvent {
  tag: string;
  lastChance: boolean;
}

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{
    url: string;
    revision: string | null;
  }>;
};

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback: serve the precached index.html for any navigation
// (deep links like /today, /admin/...). Without this, injectManifest doesn't
// add a navigateFallback, so an offline/flaky-network navigation resolves to
// nothing → black screen. Excludes API-ish and share-target paths.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/share-import/, /^\/\.well-known\//],
  })
);

// Web Share Target — when the user shares images from their gallery to
// Delivroom, the browser POSTs a multipart form to /share-import. We catch it
// here, stash the files in IndexedDB, and redirect to the bulk uploader page
// which drains the inbox on mount.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-import') {
    event.respondWith(handleShareTarget(event.request));
  }
});

async function handleShareTarget(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((v): v is File => v instanceof File);
    await pushSharedFiles(files);
  } catch (err) {
    console.error('[share-target] failed to ingest:', err);
  }
  return Response.redirect('/admin/imports?from=share', 303);
}

self.addEventListener('push', (event) => {
  const payload = (() => {
    try {
      return event.data?.json() as {
        title?: string;
        body?: string;
        url?: string;
        tag?: string;
      };
    } catch {
      return {
        title: 'Delivroom',
        body: event.data?.text() ?? 'Nouvelle alerte',
      };
    }
  })();

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Delivroom', {
      body: payload.body ?? 'Nouvelle alerte',
      icon: '/pwa-icon-192.png',
      badge: '/pwa-icon-192.png',
      tag: payload.tag ?? 'delivroom-push',
      data: { url: payload.url ?? '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string | undefined) ?? '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existingClient = clients.find((client) => 'focus' in client);
        if (existingClient) {
          existingClient.postMessage({
            type: 'delivroom:navigate',
            url: targetUrl,
          });
          return existingClient.focus();
        }

        return self.clients.openWindow(targetUrl);
      })
  );
});

// Periodic Background Sync — fires on Chromium-based browsers when site
// engagement is high enough. We use it to opportunistically rescan the
// configured Maxymo folder and notify the driver about new screenshots.
//
// Limitations (intentional, documented in maxymoScanner.ts):
// - The FS Access permission is ambient and may decay to 'prompt' when the
//   app has been fully swiped out; in that case ensureReadPermission returns
//   false and we just silently skip this run.
// - Browser decides the actual sync cadence (Chrome min 12 h).
self.addEventListener('periodicsync', (event: Event) => {
  const syncEvent = event as PeriodicSyncEvent;
  if (syncEvent.tag !== MAXYMO_SYNC_TAG) return;
  syncEvent.waitUntil(runPeriodicMaxymoScan());
});

async function runPeriodicMaxymoScan(): Promise<void> {
  try {
    const handle = await getStoredHandle();
    if (!handle) return;
    const ok = await ensureReadPermission(handle, false);
    if (!ok) {
      console.info('[periodic-scan] permission decayed, skipping');
      return;
    }
    const files = await scanFolder(handle, 'Maxymo');
    if (!files.length) return;

    const seen = await getSeenKeys();
    const newFiles = files.filter((f) => !seen.has(fileKey(f)));
    if (!newFiles.length) return;

    // Mark these as notified so the next run doesn't beep about the same files
    const updated = new Set(seen);
    for (const f of files) updated.add(fileKey(f));
    await setSeenKeys(updated);

    await self.registration.showNotification('Delivroom', {
      body: `${newFiles.length} nouveau${newFiles.length > 1 ? 'x' : ''} screenshot${newFiles.length > 1 ? 's' : ''} Maxymo à importer`,
      icon: '/pwa-icon-192.png',
      badge: '/pwa-icon-192.png',
      tag: 'delivroom-maxymo-scan',
      data: { url: '/admin/imports?from=auto-scan' },
    });
  } catch (err) {
    console.error('[periodic-scan] failed:', err);
  }
}

// Background Sync — fires (with the browser's own retry/backoff) once
// connectivity is back after a queued screenshot upload failed. The SW
// itself has no access to localStorage, so it can't hold the Supabase
// session needed to actually re-upload/re-analyze/re-record a file — it can
// only wake an open page to drain the retry queue with that page's own
// authenticated context (see uploadRetryQueue.ts), or, if nothing is open,
// tell the driver to reopen the app.
self.addEventListener('sync', (event: Event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag !== RETRY_UPLOAD_SYNC_TAG) return;
  syncEvent.waitUntil(notifyClientsToRetryUploads());
});

async function notifyClientsToRetryUploads(): Promise<void> {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  if (clients.length === 0) {
    await self.registration.showNotification('Delivroom', {
      body: "Des imports en attente n'ont pas pu être envoyés — rouvre l'app pour terminer.",
      icon: '/pwa-icon-192.png',
      badge: '/pwa-icon-192.png',
      tag: 'delivroom-retry-pending',
      data: { url: '/admin/imports' },
    });
    return;
  }

  for (const client of clients) {
    client.postMessage({ type: 'delivroom:retry-failed-uploads' });
  }
}
