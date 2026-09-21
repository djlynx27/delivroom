import { requestPersistentStorage } from '@/lib/storagePersistence';
import { useEffect } from 'react';

/** Fire-and-forget, same pattern as useAnonAuth: kicks off the persistent-
 * storage request once on mount and never gates rendering on its result. */
export function useStoragePersistence(): void {
  useEffect(() => {
    void requestPersistentStorage();
  }, []);
}
