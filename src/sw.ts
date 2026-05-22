/// <reference lib="webworker" />
import { pushSharedFiles } from '@/lib/shareInbox';
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

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
