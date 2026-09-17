// Thin registerPlugin wrapper for the native DelivroomBroadcastPlugin
// (android/app/src/main/java/com/delivroom/app/DelivroomBroadcastPlugin.kt).
// Same shape as the BackgroundGeolocation registration in
// shiftGeoWatcher.ts -- this plugin has no JS-side implementation, native
// Android only.

import { registerPlugin } from '@capacitor/core';

export interface DelivroomBroadcastPlugin {
  sendBroadcast(options: { action: string }): Promise<void>;
}

const DelivroomBroadcast = registerPlugin<DelivroomBroadcastPlugin>('DelivroomBroadcast');

export default DelivroomBroadcast;
