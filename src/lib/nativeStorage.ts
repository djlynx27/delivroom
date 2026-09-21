import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { SupportedStorage } from '@supabase/supabase-js';

// The anonymous driver identity (Supabase's signInAnonymously() session/JWT)
// lives wherever supabase.auth's `storage` option points it -- plain
// localStorage on a native Capacitor build is a WebView, subject to the same
// memory-pressure eviction storagePersistence.ts works around for the rest
// of the app's data. SharedPreferences (via this plugin) is not. Falls back
// to localStorage untouched on the web build, where this concern doesn't
// apply and Preferences isn't meaningfully different from it anyway.
//
// One-time transparent migration: an existing session already sitting in
// localStorage from a build predating this change must not be lost the
// first time a native build reads it -- getItem copies it into Preferences
// before returning, so it's the source of truth from then on.
export function createNativeStorage(): SupportedStorage {
  if (!Capacitor.isNativePlatform()) {
    return {
      getItem: (key) => Promise.resolve(localStorage.getItem(key)),
      setItem: (key, value) => {
        localStorage.setItem(key, value);
        return Promise.resolve();
      },
      removeItem: (key) => {
        localStorage.removeItem(key);
        return Promise.resolve();
      },
    };
  }

  return {
    async getItem(key) {
      const { value } = await Preferences.get({ key });
      if (value !== null) return value;

      const legacyValue = localStorage.getItem(key);
      if (legacyValue !== null) {
        await Preferences.set({ key, value: legacyValue });
        return legacyValue;
      }
      return null;
    },
    async setItem(key, value) {
      await Preferences.set({ key, value });
    },
    async removeItem(key) {
      await Preferences.remove({ key });
    },
  };
}
