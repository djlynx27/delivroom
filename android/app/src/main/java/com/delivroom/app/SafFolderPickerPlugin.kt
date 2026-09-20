package com.delivroom.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

// Real Android Storage Access Framework folder picker for the Maxymo
// auto-scan custom folder only -- the standard scan paths (Pictures/
// Screenshots, Pictures/Lyft, DCIM/Screenshots, the Maxymo default) keep
// using the existing blanket READ_MEDIA_IMAGES permission via
// @capacitor/filesystem, unchanged. SAF grants are per-tree, not blanket,
// so requiring it for every standard folder too would trade one grant
// dialog for four. See docs/superpowers/specs/2026-09-20-saf-folder-picker-design.md.
//
// listFiles/readFile return the same shape @capacitor/filesystem's
// readdir/readFile already do (name/size/mtime/uri, and { data: base64 }
// respectively) so capacitorScanner.ts's existing File-loading code needs
// only a thin branch on URI scheme, not a parallel implementation.
@CapacitorPlugin(name = "SafFolderPicker")
class SafFolderPickerPlugin : Plugin() {
    // Maxymo's real overlay-button output lands two levels under the picked
    // root (see the removed FILE_SEARCH_MAX_DEPTH in capacitorScanner.ts,
    // same on-device finding) -- bounded recursion keeps a pathological tree
    // from making this scan unbounded.
    private val maxDepth = 2

    @PluginMethod
    fun pickDirectory(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        startActivityForResult(call, intent, "pickDirectoryResult")
    }

    @ActivityCallback
    private fun pickDirectoryResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("cancelled")
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            call.reject("no uri returned")
            return
        }
        context.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION,
        )
        val ret = JSObject()
        ret.put("uri", uri.toString())
        ret.put("name", DocumentFile.fromTreeUri(context, uri)?.name ?: "Dossier")
        call.resolve(ret)
    }

    @PluginMethod
    fun listFiles(call: PluginCall) {
        val treeUriStr = call.getString("treeUri")
        if (treeUriStr == null) {
            call.reject("treeUri is required")
            return
        }
        val root = DocumentFile.fromTreeUri(context, Uri.parse(treeUriStr))
        if (root == null) {
            call.reject("cannot open tree")
            return
        }
        val files = JSArray()
        try {
            collectImageFiles(root, files, maxDepth)
        } catch (e: SecurityException) {
            call.reject("permission revoked: ${e.message}")
            return
        }
        val ret = JSObject()
        ret.put("files", files)
        call.resolve(ret)
    }

    private fun collectImageFiles(dir: DocumentFile, out: JSArray, depthLeft: Int) {
        for (child in dir.listFiles()) {
            if (child.isDirectory) {
                if (depthLeft > 0) collectImageFiles(child, out, depthLeft - 1)
            } else if (child.isFile && child.type?.startsWith("image/") == true) {
                val entry = JSObject()
                entry.put("name", child.name)
                entry.put("size", child.length())
                entry.put("mtime", child.lastModified())
                entry.put("uri", child.uri.toString())
                out.put(entry)
            }
        }
    }

    @PluginMethod
    fun readFile(call: PluginCall) {
        val uriStr = call.getString("uri")
        if (uriStr == null) {
            call.reject("uri is required")
            return
        }
        try {
            val bytes = context.contentResolver.openInputStream(Uri.parse(uriStr))?.use { it.readBytes() }
            if (bytes == null) {
                call.reject("cannot open file")
                return
            }
            val ret = JSObject()
            ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("read failed: ${e.message}")
        }
    }
}
