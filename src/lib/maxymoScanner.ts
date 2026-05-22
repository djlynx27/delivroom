// File System Access API wrapper for auto-scanning the Maxymo screenshot
// folder.
//
// Why FS Access API rather than the Capacitor Filesystem plugin:
// - Chrome WebView (what TWA runs on) supports FileSystemDirectoryHandle.
// - The handle is structured-cloneable so we can persist it in IDB and
//   re-use it on subsequent app loads without re-prompting the user.
// - No APK rebuild needed — works in the existing TWA distribution.
//
// If permissions can't be persisted across app restarts on a specific build
// (e.g. some Android shells revoke handles after force-stop), the hook just
// re-prompts on the next user gesture — no data loss.

const DB_NAME = 'delivroom-folder-handle';
const STORE = 'handles';
const HANDLE_KEY = 'maxymo-folder';
const SEEN_KEY = 'seen-file-keys';

export const MAXYMO_SYNC_TAG = 'maxymo-scan';

/**
 * Stable identifier for a file, used to diff scan results across runs.
 * lastModified + size + name is unique enough for the folder-scan use case
 * (a duplicate would either really BE a duplicate, or two distinct files
 * with literally identical name + size + timestamp which is implausible).
 */
export function fileKey(file: File | { name: string; size: number; lastModified: number }): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function isFolderApiSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFolderApiSupported()) return null;
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch (err) {
    console.error('[maxymoScanner] getStoredHandle failed:', err);
    return null;
  }
}

async function setStoredHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    if (handle) {
      store.put(handle, HANDLE_KEY);
    } else {
      store.delete(HANDLE_KEY);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Prompt the user to pick a folder. Must be called from a user gesture (click)
 * or the browser will reject. Returns null if the user cancelled.
 */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFolderApiSupported()) return null;
  try {
    // mode: 'read' is enough to enumerate the directory
    const handle = await (window as unknown as {
      showDirectoryPicker: (opts: { mode: 'read'; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: 'read', startIn: 'pictures' });
    await setStoredHandle(handle);
    return handle;
  } catch (err) {
    // AbortError = user cancelled, swallow silently
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    console.error('[maxymoScanner] pickFolder failed:', err);
    return null;
  }
}

export async function clearStoredHandle(): Promise<void> {
  await setStoredHandle(null);
}

interface HandleWithPermissions extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

/**
 * Make sure we still have read permission on the stored handle. Returns false
 * if permission is denied (the caller should prompt the user to re-pick).
 */
export async function ensureReadPermission(
  handle: FileSystemDirectoryHandle,
  promptIfNeeded = false,
): Promise<boolean> {
  const h = handle as HandleWithPermissions;
  if (!h.queryPermission) return true; // older API, assume granted
  const current = await h.queryPermission({ mode: 'read' });
  if (current === 'granted') return true;
  if (!promptIfNeeded || !h.requestPermission) return false;
  const after = await h.requestPermission({ mode: 'read' });
  return after === 'granted';
}

/**
 * Read the set of file keys we've already notified the user about. Used by
 * the periodicsync handler to avoid re-notifying the same screenshots after
 * every scan.
 */
export async function getSeenKeys(): Promise<Set<string>> {
  try {
    const db = await openDb();
    const keys = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(SEEN_KEY);
      req.onsuccess = () => resolve((req.result as string[] | undefined) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return new Set(keys);
  } catch (err) {
    console.error('[maxymoScanner] getSeenKeys failed:', err);
    return new Set();
  }
}

export async function setSeenKeys(keys: Set<string>): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(Array.from(keys), SEEN_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.error('[maxymoScanner] setSeenKeys failed:', err);
  }
}

/**
 * Walk the directory shallowly (no recursion into subfolders — Maxymo writes
 * flat) and return every file whose name contains the filter substring.
 */
export async function scanFolder(
  handle: FileSystemDirectoryHandle,
  nameFilter: string,
): Promise<File[]> {
  const out: File[] = [];
  const needle = nameFilter.trim().toLowerCase();
  for await (const entry of (handle as unknown as {
    values(): AsyncIterable<FileSystemHandle>;
  }).values()) {
    if (entry.kind !== 'file') continue;
    if (needle && !entry.name.toLowerCase().includes(needle)) continue;
    try {
      const file = await (entry as FileSystemFileHandle).getFile();
      if (!file.type.startsWith('image/')) continue;
      out.push(file);
    } catch (err) {
      console.warn('[maxymoScanner] could not read', entry.name, err);
    }
  }
  // Newest first — typically what the user wants to import
  out.sort((a, b) => b.lastModified - a.lastModified);
  return out;
}
