// Requests persistent storage (Navigator Storage API) so the browser/WebAPK
// stops treating IndexedDB/localStorage (the anon Supabase session lives
// there) as evictable under memory pressure. Without this, Chrome can wipe
// it on a low-memory reclaim, silently resetting the driver's anonymous
// identity mid-shift ("persistent storage NOT granted" warning).

export type PersistenceResult = 'granted' | 'denied' | 'unsupported';

/** Requests persistent storage and reports the outcome. Never throws —
 * a rejected/unsupported API is a degraded state to log, not a fatal one. */
export async function requestPersistentStorage(): Promise<PersistenceResult> {
  if (!navigator.storage?.persist) {
    console.warn('[storagePersistence] Storage API non disponible (unsupported).');
    return 'unsupported';
  }

  try {
    const persisted = await navigator.storage.persist();
    if (persisted) {
      // console.info never reaches `adb logcat` on this Capacitor/WebView
      // build — only warn/error do (see project memory
      // project_android_debug_logcat_gotchas). Deliberately warn-level for
      // a success case so on-device verification actually works.
      console.warn('[storagePersistence] persisted: true');
      return 'granted';
    }
    console.warn('[storagePersistence] persisted: false');
    return 'denied';
  } catch (error) {
    console.warn('[storagePersistence] persist() a échoué:', error);
    return 'denied';
  }
}
