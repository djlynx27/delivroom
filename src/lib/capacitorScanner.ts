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

const CONFIG_KEY = 'maxymo-folder-path';
const SEEN_KEY = 'maxymo-seen-keys';
// Capacitor Preferences is overkill for two strings — localStorage is fine
// because the WebView has its own isolated storage per app.

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
export async function verifyNativeReadAccess(configuredPath: string | null): Promise<boolean> {
  if (!isNative()) return true;
  let total = 0;
  for (const path of getScanPaths(configuredPath)) {
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
// configured path (whatever the driver picked for the overlay-button output,
// typically Pictures/Maxymo) is scanned too, on top of these — not instead.
export const DEFAULT_SCAN_PATHS = ['Pictures/Screenshots', 'Pictures/Lyft', 'Pictures/Maxymo', 'DCIM/Screenshots'];

/** Every folder a scan should check: the configured one (if any) plus the
 * standard OS/app screenshot locations, deduplicated. Exported standalone so
 * the folder-selection logic is testable without a device filesystem. */
export function getScanPaths(configuredPath: string | null): string[] {
  const all = configuredPath ? [configuredPath, ...DEFAULT_SCAN_PATHS] : DEFAULT_SCAN_PATHS;
  return Array.from(new Set(all));
}

// Roots the graphical "Autre…" folder picker probes for a direct-child match
// by name (see resolveFolderPathByName). One level deep only — a full
// recursive walk of external storage to find an arbitrarily nested folder
// would be slow and disproportionate for this; DEFAULT_SCAN_PATHS already
// covers every folder Android/Maxymo actually write to.
const COMMON_PICKER_ROOTS = ['Pictures', 'DCIM', 'Download', ''];

/**
 * The browser's webkitdirectory folder picker never exposes a file's real
 * absolute path (privacy sandboxing) — only the picked folder's own name via
 * `webkitRelativePath`. This re-derives the External-Storage-relative path
 * `nativeScan` needs by checking whether a same-named subdirectory exists
 * under one of the common roots. Returns null if no match is found (folder
 * lives somewhere nativeScan can't reach without a real SAF plugin).
 */
export async function resolveFolderPathByName(leafName: string): Promise<string | null> {
  if (!isNative()) return null;
  for (const root of COMMON_PICKER_ROOTS) {
    try {
      const { files } = await Filesystem.readdir({ path: root, directory: Directory.ExternalStorage });
      const match = files.some((f) => f.type === 'directory' && f.name === leafName);
      if (match) return root ? `${root}/${leafName}` : leafName;
    } catch {
      // Root itself missing/unreadable — try the next candidate.
    }
  }
  return null;
}

/**
 * Fallback for when the picker returned no usable `webkitRelativePath` at
 * all (confirmed on a real device: Samsung's Files app, used by the Android
 * WebView's generic document chooser, returns files with an empty relative
 * path instead of the "<folder>/<file>" Chrome's own picker gives) —
 * enumerates subfolder names one level under the common roots (that listing
 * is reliable), then `stat`s the guessed "<subfolder>/<fileName>" path
 * directly. Deliberately uses `stat`, not `readdir`, on the subfolder itself:
 * confirmed on-device that `readdir` on a non-media-only nested folder comes
 * back empty under Android scoped storage even though the file is there and
 * `stat` finds it fine — a plugin/OS quirk this works around, not a bug in
 * the search logic. Same "good enough, not exhaustive" ceiling otherwise as
 * resolveFolderPathByName.
 */
export async function resolveFolderPathByFileName(fileName: string): Promise<string | null> {
  if (!isNative()) return null;
  for (const root of COMMON_PICKER_ROOTS) {
    let files;
    try {
      files = (await Filesystem.readdir({ path: root, directory: Directory.ExternalStorage })).files;
    } catch {
      continue;
    }
    try {
      await Filesystem.stat({ path: root ? `${root}/${fileName}` : fileName, directory: Directory.ExternalStorage });
      return root;
    } catch {
      // Not directly in this root — check its subfolders below.
    }
    for (const sub of files.filter((f) => f.type === 'directory')) {
      const subPath = root ? `${root}/${sub.name}` : sub.name;
      try {
        await Filesystem.stat({ path: `${subPath}/${fileName}`, directory: Directory.ExternalStorage });
        return subPath;
      } catch {
        // Not in this subfolder — try the next one.
      }
    }
  }
  return null;
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

async function loadFile(c: ListedFile): Promise<File | null> {
  try {
    const read = await Filesystem.readFile({
      path: `${c.dir}/${c.name}`,
      directory: Directory.ExternalStorage,
    });
    const dataUrl = `data:${mimeFromName(c.name)};base64,${read.data}`;
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], c.name, { type: blob.type, lastModified: c.mtime || Date.now() });
  } catch (err) {
    console.warn('[capacitorScanner] could not load', c.name, err);
    return null;
  }
}

/**
 * Walk every scan folder (configured + standard screenshot locations)
 * shallowly and return their image files (filtered by name substring).
 * Files are loaded into memory as File objects so the existing bulk
 * uploader pipeline can consume them unchanged.
 */
export async function nativeScan(nameFilter: string): Promise<File[]> {
  if (!isNative()) return [];
  const paths = getScanPaths(getConfiguredPath());

  const needle = nameFilter.trim().toLowerCase();
  const perFolder = await Promise.all(paths.map(readdirSafe));
  const candidates = perFolder
    .flat()
    .filter((e) => !needle || e.name.toLowerCase().includes(needle))
    .sort((a, b) => b.mtime - a.mtime);

  const loaded = await Promise.all(candidates.map(loadFile));
  return loaded.filter((f): f is File => f !== null);
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
