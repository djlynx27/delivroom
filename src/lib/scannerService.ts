// Unified Maxymo scanner service. Routes to the Capacitor-native plugin when
// we're inside the installed Android APK, falls back to the web File System
// Access API when running as a TWA / PWA. The UI doesn't need to know which
// one is active.

import {
  ensureNativePermission,
  getConfiguredPath,
  isNative,
  nativeScan,
  setConfiguredPath,
} from '@/lib/capacitorScanner';
import {
  clearStoredHandle,
  ensureReadPermission,
  getStoredHandle,
  isFolderApiSupported,
  pickFolder,
  scanFolder,
} from '@/lib/maxymoScanner';

export type ScannerKind = 'native' | 'fs-access' | 'unsupported';

export function scannerKind(): ScannerKind {
  if (isNative()) return 'native';
  if (isFolderApiSupported()) return 'fs-access';
  return 'unsupported';
}

export interface ConfigureResult {
  ok: boolean;
  label?: string;        // human-readable identifier of what got configured
}

export async function isAutoScanConfigured(): Promise<boolean> {
  if (isNative()) return !!getConfiguredPath();
  return !!(await getStoredHandle());
}

export type ScanStatus = 'unsupported' | 'not-configured' | 'granted' | 'permission-needed';

/** Current state for the admin banner — never prompts, just reports. */
export async function getScanStatus(): Promise<ScanStatus> {
  const kind = scannerKind();
  if (kind === 'unsupported') return 'unsupported';
  if (kind === 'native') {
    return getConfiguredPath() ? 'granted' : 'not-configured';
  }
  const handle = await getStoredHandle();
  if (!handle) return 'not-configured';
  const ok = await ensureReadPermission(handle, false);
  return ok ? 'granted' : 'permission-needed';
}

/**
 * Re-request permission on the already-configured folder handle (no folder
 * picker) — used by the "1-tap grant" banner button. Native permission decay
 * doesn't happen the same way (see capacitorScanner.ts), so this is a no-op
 * there.
 */
export async function regrantPermission(): Promise<boolean> {
  if (isNative()) return true;
  const handle = await getStoredHandle();
  if (!handle) return false;
  return ensureReadPermission(handle, true);
}

export async function getConfiguredLabel(): Promise<string | null> {
  if (isNative()) {
    const path = getConfiguredPath();
    return path ? `📁 ${path}` : null;
  }
  const handle = await getStoredHandle();
  return handle ? `📁 ${handle.name}` : null;
}

/**
 * Native: prompt for a folder path (Maxymo's directory under External Storage,
 * e.g. "Pictures/Maxymo"). Also request read media permission.
 *
 * Web: open the directory picker. The browser returns a handle and we persist
 * it in IDB so subsequent app loads can read silently.
 */
export async function configureAutoScan(
  nativePathPrompt?: () => Promise<string | null>,
): Promise<ConfigureResult> {
  if (isNative()) {
    const path = nativePathPrompt ? await nativePathPrompt() : 'Pictures/Maxymo';
    if (!path) return { ok: false };
    const granted = await ensureNativePermission();
    if (!granted) {
      return { ok: false, label: 'Permission de stockage refusée' };
    }
    setConfiguredPath(path);
    return { ok: true, label: path };
  }
  if (isFolderApiSupported()) {
    const handle = await pickFolder();
    if (!handle) return { ok: false };
    return { ok: true, label: handle.name };
  }
  return { ok: false, label: 'Pas supporté sur ce navigateur' };
}

export async function rescanConfigured(filter: string): Promise<File[]> {
  if (isNative()) {
    return await nativeScan(filter);
  }
  const handle = await getStoredHandle();
  if (!handle) return [];
  const ok = await ensureReadPermission(handle, true);
  if (!ok) return [];
  return await scanFolder(handle, filter);
}

export async function silentRescan(filter: string): Promise<File[]> {
  if (isNative()) {
    return await nativeScan(filter);
  }
  const handle = await getStoredHandle();
  if (!handle) return [];
  const ok = await ensureReadPermission(handle, false);
  if (!ok) return [];
  return await scanFolder(handle, filter);
}

export async function clearAutoScanConfig(): Promise<void> {
  if (isNative()) {
    setConfiguredPath(null);
    return;
  }
  await clearStoredHandle();
}
