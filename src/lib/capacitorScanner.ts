// Capacitor-native implementation of the Maxymo scanner. Used inside the
// installed Android APK where we have direct filesystem access (no ambient
// permission decay like the FS Access API) and can wire up native
// background tasks + local notifications.
//
// In the web/TWA build this module is still imported but Capacitor.isNativePlatform()
// returns false so callers fall back to maxymoScanner.ts.

import { App } from '@capacitor/app';
import { BackgroundRunner } from '@capacitor/background-runner';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';
import { fileKey, findExistingFileNames } from '@/lib/screenshotDedup';
import SafFolderPicker from '@/lib/safFolderPicker';

const RUNNER_LABEL = 'com.delivroom.app.scanner';

// @capacitor/background-runner dropped `.set()` from its TS definitions
// (KV-store API), but Capacitor plugin bridges dispatch by method-name
// string regardless of the declared TS interface, so the native side may
// still implement it. Narrow, explicit type instead of `any` to keep this
// call compiling without pretending the whole plugin surface changed.
type RunnerWithKvStore = typeof BackgroundRunner & {
  set(options: { label: string; key: string; value: string }): Promise<void>;
};

/**
 * Mirror a value into the background runner's KV store so the periodic
 * runners/maxymo-scan.js can read it. Safe to call when not running on
 * native — short-circuits silently.
 */
async function syncToRunner(key: string, value: string | null): Promise<void> {
  if (!isNative()) return;
  const runner = BackgroundRunner as RunnerWithKvStore;
  try {
    if (value === null) {
      // No documented delete; setting to empty string is the workaround
      await runner.set({ label: RUNNER_LABEL, key, value: '' });
    } else {
      await runner.set({ label: RUNNER_LABEL, key, value });
    }
  } catch (err) {
    console.warn('[capacitorScanner] syncToRunner failed', key, err);
  }
}

// CONFIG_KEY now stores the SAF-picked folder's display LABEL only (e.g.
// "Maxymo") — the folder itself is scanned via SAF_TREE_URI_KEY's persisted
// content:// tree URI (see setConfiguredTreeUri), not a Filesystem-relative
// path. A pre-SAF-picker install may still have an old relative-path string
// here (from before 42708f8/this SAF change) — harmless, it just displays
// as the label until the driver re-picks a folder, which also happens to
// double as prompting them once for the new picker.
const CONFIG_KEY = 'maxymo-folder-path';
const SAF_TREE_URI_KEY = 'maxymo-saf-tree-uri';
const SEEN_KEY = 'maxymo-seen-keys';
// Capacitor Preferences is overkill for a few strings — localStorage is
// fine because the WebView has its own isolated storage per app.

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function getConfiguredPath(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(CONFIG_KEY);
}

export function setConfiguredPath(path: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (path) {
    localStorage.setItem(CONFIG_KEY, path);
  } else {
    localStorage.removeItem(CONFIG_KEY);
  }
  // Also mirror to the background runner's KV so the periodic task can scan
  // the right folder when fired from a cold start.
  void syncToRunner('maxymo-folder-path', path);
}

export function getConfiguredTreeUri(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(SAF_TREE_URI_KEY);
}

export function setConfiguredTreeUri(uri: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (uri) {
    localStorage.setItem(SAF_TREE_URI_KEY, uri);
  } else {
    localStorage.removeItem(SAF_TREE_URI_KEY);
  }
  void syncToRunner('maxymo-saf-tree-uri', uri);
}

/**
 * Ask the OS for read access to the user's media files. Filesystem plugin
 * routes this to the right manifest permission for the active Android
 * version (READ_MEDIA_IMAGES on 13+, READ_EXTERNAL_STORAGE on older).
 */
export async function ensureNativePermission(): Promise<boolean> {
  if (!isNative()) return false;
  const current = await Filesystem.checkPermissions();
  if (current.publicStorage === 'granted') return true;
  const after = await Filesystem.requestPermissions();
  return after.publicStorage === 'granted';
}

// Set once a scan actually finds real files somewhere — lets
// verifyNativeReadAccess tell "this folder is genuinely empty" apart from
// "permission got silently revoked" (see its doc comment) without a false
// positive on a fresh install that hasn't scanned anything yet.
const EVER_SAW_FILES_KEY = 'maxymo-ever-saw-files';

/**
 * Active probe for real Android media-read access, run in addition to (not
 * instead of) Filesystem.checkPermissions() — confirmed on a real device
 * that checkPermissions() can keep reporting "granted" after Android
 * silently auto-revokes READ_MEDIA_IMAGES (its unused-permissions reset, for
 * an app that hasn't been opened in a while), and that Filesystem.readdir()
 * doesn't throw in that case either — it just returns an empty file list,
 * identical to a genuinely empty folder. The only signal JS can reliably
 * get without popping a permission dialog on every launch is a regression:
 * every configured/default scan path suddenly reporting zero files, on a
 * device where a scan has previously found real ones.
 */
export async function verifyNativeReadAccess(): Promise<boolean> {
  if (!isNative()) return true;
  let total = 0;
  for (const path of getScanPaths()) {
    try {
      const { files } = await Filesystem.readdir({ path, directory: Directory.ExternalStorage });
      total += files.filter((f) => f.type === 'file').length;
    } catch {
      // Folder missing/unreadable isn't itself a permission signal.
    }
  }
  if (total > 0) {
    localStorage.setItem(EVER_SAW_FILES_KEY, '1');
    return true;
  }
  return localStorage.getItem(EVER_SAW_FILES_KEY) !== '1';
}


interface ListedFile {
  name: string;
  size: number;
  mtime: number;
  uri: string;
  /** Folder this file was found in — readFile needs the full `path/name`. */
  dir: string;
}

// Where Android actually drops a screenshot depends on the capture method,
// not on the driver's own choice: the physical Vol-Down+Power / palm-swipe
// gesture always lands in Pictures/Screenshots regardless of which app is in
// the foreground, while a Lyft in-app share can land in Pictures/Lyft. The
// driver's custom folder (e.g. Maxymo's overlay-button output) is scanned
// via SAF instead (see readSafFolderSafe) — these are the paths reachable
// through the blanket READ_MEDIA_IMAGES permission alone.
export const DEFAULT_SCAN_PATHS = ['Pictures/maxymo/lyft', 'Pictures/Screenshots', 'Pictures/Lyft', 'DCIM/Screenshots'];

/** Every standard OS/app screenshot location a scan should check. Exported
 * standalone so it's testable without a device filesystem. */
export function getScanPaths(): string[] {
  return DEFAULT_SCAN_PATHS;
}

/** A missing/inaccessible folder (not every device has Pictures/Lyft, say)
 * is not an error — it just contributes nothing to the scan. */
async function readdirSafe(path: string): Promise<ListedFile[]> {
  try {
    const result = await Filesystem.readdir({ path, directory: Directory.ExternalStorage });
    return result.files
      .filter((e) => e.name && /\.(jpe?g|png|webp)$/i.test(e.name))
      .map((e) => ({
        name: e.name,
        size: e.size ?? 0,
        mtime: e.mtime ?? 0,
        uri: e.uri ?? `${path}/${e.name}`,
        dir: path,
      }));
  } catch (err) {
    console.warn('[capacitorScanner] readdir skipped for', path, err);
    return [];
  }
}

// Decodes base64 straight to bytes instead of building a
// "data:...;base64,<payload>" string and round-tripping it through fetch() —
// that doubled the live memory footprint per file (the base64 string, the
// data: URL copy of it, and the fetch's internal buffering all alive at
// once). Confirmed on a real device: scanning a folder with 2000+ real
// screenshots and an empty name filter crashed the app — every candidate's
// bytes were being decoded concurrently via Promise.all with no cap at all.
function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function loadFile(c: ListedFile): Promise<File | null> {
  try {
    const data = c.uri.startsWith('content://')
      ? (await SafFolderPicker.readFile({ uri: c.uri })).data
      : (
          await Filesystem.readFile({
            path: `${c.dir}/${c.name}`,
            directory: Directory.ExternalStorage,
          })
        ).data as string;
    const mime = mimeFromName(c.name);
    const blob = base64ToBlob(data, mime);
    return new File([blob], c.name, { type: mime, lastModified: c.mtime || Date.now() });
  } catch (err) {
    console.warn('[capacitorScanner] could not load', c.name, err);
    return null;
  }
}

/** Lists the driver's SAF-picked custom folder, if configured — degrades
 * silently (empty list) if unconfigured or the persisted grant was revoked
 * (folder moved/deleted, permission reset elsewhere), same as a missing
 * standard folder in readdirSafe. `dir` stays empty since SAF entries carry
 * their own full content:// uri, unlike readdirSafe's relative paths. */
async function readSafFolderSafe(): Promise<ListedFile[]> {
  const treeUri = getConfiguredTreeUri();
  if (!treeUri) return [];
  try {
    const { files } = await SafFolderPicker.listFiles({ treeUri });
    return files.map((f) => ({ name: f.name, size: f.size, mtime: f.mtime, uri: f.uri, dir: '' }));
  } catch (err) {
    console.warn('[capacitorScanner] SAF listFiles failed', err);
    return [];
  }
}

// Hard cap on concurrent file reads/decodes — each one holds a full base64
// string + decoded bytes in memory at once, so scanning thousands of real
// screenshots at once (nameFilter empty = "take everything") was blowing
// past what the WebView process could hold. Sequential batches keep peak
// memory bounded to this many files regardless of folder size.
const LOAD_BATCH_SIZE = 15;

async function loadFilesInBatches(candidates: ListedFile[]): Promise<File[]> {
  const loaded: File[] = [];
  for (let i = 0; i < candidates.length; i += LOAD_BATCH_SIZE) {
    const batch = candidates.slice(i, i + LOAD_BATCH_SIZE);
    const results = await Promise.all(batch.map(loadFile));
    for (const file of results) {
      if (file) loaded.push(file);
    }
  }
  return loaded;
}

/**
 * Walk every scan folder (configured + standard screenshot locations)
 * shallowly and return their image files (filtered by name substring).
 * Files are loaded into memory as File objects so the existing bulk
 * uploader pipeline can consume them unchanged.
 *
 * Prefilters candidates against the screenshot_uploads registry (name+size,
 * same check `ingest()` in BulkScreenshotUploader.tsx already does) BEFORE
 * reading any file bytes — previously every candidate's full content was
 * read + base64-decoded first and only discarded afterward, so a 700+ file
 * folder re-paid that cost on every scan even with almost nothing new.
 * `skipPrefilter` mirrors the "Scan complet" checkbox, which must still be
 * able to force a full re-read.
 */
export async function nativeScan(
  nameFilter: string,
  skipPrefilter = false,
): Promise<File[]> {
  if (!isNative()) return [];
  const paths = getScanPaths();

  const needle = nameFilter.trim().toLowerCase();
  const [perFolder, safFiles] = await Promise.all([
    Promise.all(paths.map(readdirSafe)),
    readSafFolderSafe(),
  ]);
  let candidates = [...perFolder.flat(), ...safFiles]
    .filter((e) => !needle || e.name.toLowerCase().includes(needle))
    .sort((a, b) => b.mtime - a.mtime);

  if (!skipPrefilter && candidates.length) {
    const known = await findExistingFileNames(
      candidates.map((c) => ({ name: c.name, size: c.size })),
    );
    candidates = candidates.filter((c) => !known.has(fileKey(c.name, c.size)));
  }

  return loadFilesInBatches(candidates);
}

function mimeFromName(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

/** Pop a system notification (Android tray + lockscreen). */
export async function nativeNotify(
  title: string,
  body: string,
  deepLink = '/admin/imports?from=auto-scan',
): Promise<void> {
  if (!isNative()) return;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      const after = await LocalNotifications.requestPermissions();
      if (after.display !== 'granted') return;
    }
    await LocalNotifications.schedule({
      notifications: [{
        id: Date.now() & 0x7fffffff,
        title,
        body,
        smallIcon: 'ic_stat_icon_config_sample',
        extra: { url: deepLink },
      }],
    });
  } catch (err) {
    console.error('[capacitorScanner] notify failed', err);
  }
}

/**
 * Register a listener that fires when the app goes from background → foreground.
 * Capacitor delivers this even when the FS Access ambient permission would
 * have decayed — exactly the gap we wanted to close.
 */
export function onAppResume(callback: () => void): () => void {
  const handle = App.addListener('appStateChange', (state) => {
    if (state.isActive) callback();
  });
  return () => {
    void handle.then((h) => h.remove());
  };
}

export function getSeenKeysNative(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  const raw = localStorage.getItem(SEEN_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function setSeenKeysNative(keys: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  const serialized = JSON.stringify(Array.from(keys));
  localStorage.setItem(SEEN_KEY, serialized);
  // Mirror to the runner KV so the periodic task can dedupe its notifications
  void syncToRunner('maxymo-seen-keys', serialized);
}

/**
 * Kick the runner once after configuration so we don't have to wait the full
 * 30 min for the first periodic fire. Safe-no-op when not on native.
 */
export async function triggerImmediateBackgroundScan(): Promise<void> {
  if (!isNative()) return;
  try {
    await BackgroundRunner.dispatchEvent({
      label: RUNNER_LABEL,
      event: 'scheduledScan',
      details: {},
    });
  } catch (err) {
    console.warn('[capacitorScanner] dispatchEvent failed', err);
  }
}
