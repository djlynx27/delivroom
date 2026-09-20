// Thin registerPlugin wrapper for the native SafFolderPickerPlugin
// (android/app/src/main/java/com/delivroom/app/SafFolderPickerPlugin.kt).
// Same shape as DelivroomBroadcast/BackgroundGeolocation's registration --
// no JS-side implementation, native Android only. Scoped to the custom
// auto-scan folder only, see
// docs/superpowers/specs/2026-09-20-saf-folder-picker-design.md.

import { registerPlugin } from '@capacitor/core';

export interface SafListedFile {
  name: string;
  size: number;
  mtime: number;
  uri: string;
}

export interface SafFolderPickerPlugin {
  /** Opens ACTION_OPEN_DOCUMENT_TREE; resolves once the driver taps "Utiliser
   * ce dossier", after takePersistableUriPermission has already run natively.
   * Rejects on cancel. `name` is the picked folder's own display name, for
   * showing a human label without decoding the content:// URI. */
  pickDirectory(): Promise<{ uri: string; name: string }>;
  /** Depth-bounded (2) walk of `treeUri` for image files. Rejects if the
   * persisted grant was revoked (folder moved/deleted, permission reset). */
  listFiles(options: { treeUri: string }): Promise<{ files: SafListedFile[] }>;
  /** Same `{ data: base64 }` shape as @capacitor/filesystem's readFile. */
  readFile(options: { uri: string }): Promise<{ data: string }>;
}

const SafFolderPicker = registerPlugin<SafFolderPickerPlugin>('SafFolderPicker');

export default SafFolderPicker;
