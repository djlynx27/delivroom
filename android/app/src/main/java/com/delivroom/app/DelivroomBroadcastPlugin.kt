package com.delivroom.app

import android.content.Intent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// Sends a plain Android broadcast intent -- used by shiftGeoWatcher.ts to
// notify MacroDroid (which registers its own receiver at runtime via its
// "Intent Received" trigger, same mechanism already used for
// com.delivroom.SHOW_OVERLAY, sent today from the PC bridge via ADB) that
// the driver has arrived in the recommended zone and the Nearby Drivers
// capture macro should fire. No app-level permission needed: this mirrors
// the already-working ADB broadcast, just sent from on-device instead of a
// PC, so it works even when the PC/Tailscale bridge is off.
@CapacitorPlugin(name = "DelivroomBroadcast")
class DelivroomBroadcastPlugin : Plugin() {
    @PluginMethod
    fun sendBroadcast(call: PluginCall) {
        val action = call.getString("action")
        if (action == null) {
            call.reject("action is required")
            return
        }
        context.sendBroadcast(Intent(action))
        call.resolve()
    }
}
