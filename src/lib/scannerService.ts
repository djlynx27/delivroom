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
  setConfiguredTreeUri,
  verifyNativeReadAccess,
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

export type ScanStatus =
  | 'unsupported'
  | 'not-configured'
  | 'granted'
  | 'permission-needed'
  | 'permission-revoked';

/** Current state for the admin banner — never prompts, just reports. */
export async function getScanStatus(): Promise<ScanStatus> {
  const kind = scannerKind();
  if (kind === 'unsupported') return 'unsupported';
  if (kind === 'native') {
    const path = getConfiguredPath();
    if (!path) return 'not-configured';
    const ok = await verifyNativeReadAccess();
    return ok ? 'granted' : 'permission-revoked';
  }
  const handle = await getStoredHandle();
  if (!handle) return 'not-configured';
  const ok = await ensureReadPermission(handle, false);
  return ok ? 'granted' : 'permission-needed';
}

/**
 * Re-request permission — used by the web/fs-access "1-tap grant" banner
 * button on the already-configured folder handle, no folder picker. Native
 * has no equivalent: Filesystem.requestPermissions() doesn't re-query
 * Android once it's (wrongly) cached as granted, confirmed on a real device
 * — see verifyNativeReadAccess's doc comment — so the native
 * 'permission-revoked' banner sends the driver to Android Settings instead
 * of calling this.
 */
export async function regrantPermission(): Promise<boolean> {
  if (isNative()) return false;
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
 * Native: open the real Android SAF folder picker for the driver's custom
 * folder (e.g. Maxymo's overlay-button output), persist the granted tree
 * URI, and request the blanket media-read permission the standard scan
 * paths still rely on.
 *
 * Web: open the directory picker. The browser returns a handle and we persist
 * it in IDB so subsequent app loads can read silently.
 */
export async function configureAutoScan(
  nativePathPrompt?: () => Promise<{ uri: string; label: string } | null>,
): Promise<ConfigureResult> {
  if (isNative()) {
    if (!nativePathPrompt) {
      return { ok: false, label: 'Sélecteur de dossier non disponible' };
    }
    const picked = await nativePathPrompt();
    if (!picked) return { ok: false };
    const granted = await ensureNativePermission();
    if (!granted) {
      return { ok: false, label: 'Permission de stockage refusée' };
    }
    setConfiguredTreeUri(picked.uri);
    setConfiguredPath(picked.label);
    return { ok: true, label: picked.label };
  }
  if (isFolderApiSupported()) {
    const handle = await pickFolder();
    if (!handle) return { ok: false };
    return { ok: true, label: handle.name };
  }
  return { ok: false, label: 'Pas supporté sur ce navigateur' };
}

export async function rescanConfigured(
  filter: string,
  skipPrefilter = false,
): Promise<File[]> {
  if (isNative()) {
    return await nativeScan(filter, skipPrefilter);
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
    setConfiguredTreeUri(null);
    return;
  }
  await clearStoredHandle();
}
