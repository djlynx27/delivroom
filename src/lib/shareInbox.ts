// Tiny IndexedDB-backed inbox used to ferry files from the Service Worker
// (which receives the Web Share Target POST) to the page that actually owns
// the bulk uploader UI.
//
// Why IDB rather than postMessage:
// - The share intent often launches the app fresh, so there's no client to
//   postMessage to at SW time. We need a place to park the files until the
//   page boots and asks for them.
// - File / Blob objects are structured-cloneable and survive a round-trip
//   through IDB just fine.

const DB_NAME = 'delivroom-share-inbox';
const STORE = 'pending';
const DB_VERSION = 1;

interface SharedBatch {
  id?: number;
  files: File[];
  receivedAt: number;
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

/**
 * Park a batch of shared files for the page to pick up on next load.
 */
export async function pushSharedFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ files, receivedAt: Date.now() } satisfies Omit<SharedBatch, 'id'>);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Drain every pending batch and return the files in arrival order. Called by
 * the bulk uploader when it boots with ?from=share.
 */
export async function drainSharedFiles(): Promise<File[]> {
  const db = await openDb();
  const files: File[] = [];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const batch = cursor.value as SharedBatch;
        files.push(...batch.files);
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return files;
}
