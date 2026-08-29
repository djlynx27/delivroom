// IndexedDB-backed queue for screenshot uploads that failed mid-import
// (network blip, Gemini timeout, transient Supabase error). Mirrors
// shareInbox.ts's pattern: File objects survive an IDB round-trip fine, and
// IDB (unlike React state) survives the tab closing.
//
// Why the Service Worker can only coordinate this, not perform it alone:
// the actual upload/analyze/record pipeline needs an authenticated Supabase
// client, and supabase-js's browser client stores its session in
// localStorage — which a Service Worker has no access to. So `sw.ts`'s
// `sync` handler just wakes any open page (postMessage) to drain this queue
// with its own already-authenticated context; if no page is open it shows a
// notification instead. See BulkScreenshotUploader.tsx for the drain side.

const DB_NAME = 'delivroom-upload-retry';
const STORE = 'pending';
const DB_VERSION = 1;

export const RETRY_UPLOAD_SYNC_TAG = 'delivroom-retry-failed-uploads';

interface QueuedUploadRecord {
  id?: number;
  file: File;
  queuedAt: number;
}

export interface QueuedUpload {
  file: File;
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Queue a file whose upload/analyze pipeline just failed, for later retry. */
export async function enqueueFailedUpload(file: File): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ file, queuedAt: Date.now() } satisfies Omit<QueuedUploadRecord, 'id'>);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Drain every queued upload for retry, in the order they failed. */
export async function drainUploadQueue(): Promise<QueuedUpload[]> {
  const db = await openDb();
  const items: QueuedUpload[] = [];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const record = cursor.value as QueuedUploadRecord;
        items.push({ file: record.file, queuedAt: record.queuedAt });
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return items;
}

/** Best-effort registration of a one-off Background Sync for the retry
 * queue. Returns false on unsupported browsers (Safari/Firefox have no
 * SyncManager) rather than throwing — the queued file still gets picked up
 * next time the page itself mounts, so this is a pure enhancement. */
export async function registerRetrySync(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const syncManager = (
      registration as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;
    if (!syncManager) return false;
    await syncManager.register(RETRY_UPLOAD_SYNC_TAG);
    return true;
  } catch (err) {
    console.info('[uploadRetryQueue] background sync registration failed:', err);
    return false;
  }
}
