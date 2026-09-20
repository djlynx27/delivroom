# SAF Custom-Folder Picker & Incremental Scan Prefilter — Design Spec

Status: approved by Oualid 2026-09-20, proceeding directly to implementation.

## Problem

Two related but separable issues in the Maxymo/Lyft screenshot auto-scan
flow (`src/components/BulkScreenshotUploader.tsx`,
`src/lib/capacitorScanner.ts`):

1. The "Configurer l'auto-scan" folder-name dialog (shipped in `42708f8`,
   replacing a misleading `webkitdirectory` picker) is too much friction on
   the road — the driver wants a real native folder browser with a
   "Utiliser ce dossier" button, not typing/confirming a name blind.
2. `nativeScan()` reads and base64-decodes every candidate file's full
   bytes (`loadFilesInBatches`) BEFORE the existing incremental dedup filter
   (`findExistingFileNames`, name+size based, in
   `src/lib/screenshotDedup.ts`) ever runs — that filter currently only
   applies inside `BulkScreenshotUploader.tsx`'s `ingest()`, well after the
   expensive read already happened. On a 700+ file folder this means
   re-reading nearly everything on every scan even though almost all of it
   was already imported.

## Goals

1. A real Android SAF folder picker (`ACTION_OPEN_DOCUMENT_TREE` +
   `takePersistableUriPermission`) for the driver's custom/configured
   folder only — native "Utiliser ce dossier" experience, no typed name.
2. `nativeScan()` filters candidates by (name, size) against the existing
   `screenshot_uploads` registry immediately after listing, before any file
   bytes are read — independent of goal 1, ships first.

## Non-goals

- Migrating the standard scan paths (`Pictures/Screenshots`, `Pictures/Lyft`,
  `DCIM/Screenshots`, and the Maxymo default) to SAF — those keep using the
  existing `READ_MEDIA_IMAGES` blanket permission + `Filesystem.readdir`,
  unchanged. SAF grants are per-tree, not blanket; requiring the driver to
  grant 4 separate folder permissions instead of 1 is strictly worse UX for
  no benefit, since the blanket-permission path already works for those.
- Any change to the OCR/Gemini pipeline, hashing, or upload logic —
  `loadFilesInBatches`'s output (`File[]`) contract is preserved exactly,
  so `runAutoPipeline`/`ingest()` need no changes.
- Removing the "Dossier entier" (`webkitdirectory`, manual one-shot import)
  path — unrelated to the auto-scan config flow this spec touches.

## Architecture

### Incremental prefilter (ships independently, `capacitorScanner.ts` only)

`nativeScan()` currently: list all candidate files (cheap metadata) →
`loadFilesInBatches` (expensive: read + base64-decode every candidate) →
caller (`ingest()`) later filters by name+size. Reorder: list → filter by
`findExistingFileNames` (metadata-only Supabase query, already exists) →
THEN `loadFilesInBatches` on the survivors only. `nativeScan` moves from
`src/lib/capacitorScanner.ts` (no Supabase import today) to importing
`findExistingFileNames` directly — small, justified coupling since the
whole point is to prefilter before the expensive read this function itself
performs.

`forceFullRescan` (existing checkbox in `BulkScreenshotUploader.tsx`) must
bypass this prefilter the same way it already bypasses `ingest()`'s
post-filter — `nativeScan` gains a `skipPrefilter` parameter for this.

### SAF plugin (new native code)

New Kotlin plugin `SafFolderPickerPlugin` (`android/app/src/main/java/com/delivroom/app/SafFolderPickerPlugin.kt`), registered in `MainActivity.java` alongside `DelivroomBroadcastPlugin`, mirroring its existing style:

- `pickDirectory()` — `Intent(ACTION_OPEN_DOCUMENT_TREE)` via
  `startActivityForResult`/`@ActivityCallback` (standard Capacitor Plugin
  API, unchanged since Capacitor 3, still current in the installed
  Capacitor 8). On a result, `contentResolver.takePersistableUriPermission(uri, FLAG_GRANT_READ_URI_PERMISSION)`, returns `{ uri }`. Rejects on cancel.
- `listFiles({ treeUri })` — `DocumentFile.fromTreeUri`, depth-bounded
  recursive walk (depth 2, matching the Maxymo `Pictures/maxymo/lyft`
  nesting precedent from the old `resolveFolderPathByFileName`'s removed
  `FILE_SEARCH_MAX_DEPTH`), filtering to `image/*` children. Returns
  `{ files: [{ name, size, mtime, uri }] }` — same shape as
  `ListedFile`/`Filesystem.readdir`'s entries, so `capacitorScanner.ts`
  needs minimal branching.
- `readFile({ uri })` — `contentResolver.openInputStream`, reads bytes,
  `Base64.encodeToString(..., NO_WRAP)`, returns `{ data }` — same shape as
  `Filesystem.readFile`'s result, so `loadFile()`'s `base64ToBlob` call site
  is reused unchanged.

New Gradle dependency: `androidx.documentfile:documentfile` (not currently
in `android/app/build.gradle`) for `DocumentFile`. No new
AndroidManifest permissions needed — SAF tree access doesn't require a
manifest permission declaration, only the runtime picker + persisted grant.

### `capacitorScanner.ts` integration

- `CONFIG_KEY` (`maxymo-folder-path`) currently stores a guessed
  External-Storage-relative path string (e.g. `"Pictures/maxymo"`).
  Replaced by a new `SAF_TREE_URI_KEY` storing the persisted
  `content://...` tree URI string once the driver picks via the new plugin.
  `getConfiguredPath()`/`setConfiguredPath()` callers in
  `BulkScreenshotUploader.tsx` (`configureAutoScan`, labels) are updated to
  the new picker flow — old string-path configs from before this change are
  simply treated as unconfigured (driver re-picks once; no migration
  needed, matches how the folder-name dialog already required a fresh pick
  after `42708f8`).
- `nativeScan()` gains a SAF branch: if a tree URI is configured, list it
  via the plugin's `listFiles` and merge its (prefiltered, per above)
  candidates with the existing `DEFAULT_SCAN_PATHS` candidates from
  `Filesystem.readdir` before the shared `loadFilesInBatches` call.
  `loadFile()` branches on whether a candidate's `uri` is a `content://` URI
  (call the plugin's `readFile`) or an External-Storage relative path (call
  `Filesystem.readFile`, unchanged) — one small type discriminator, not a
  parallel code path.
- Permission-revoked handling: if `listFiles`/`readFile` throws (grant
  revoked, e.g. driver moved/deleted the folder), same degrade-gracefully
  pattern as `ensureNativePermission`'s existing failure handling — log and
  return no candidates from that source, rest of the scan (standard paths)
  is unaffected.

### `BulkScreenshotUploader.tsx` integration

`configureAutoScan`'s `promptNativePath()` (the Dialog from `42708f8`) is
replaced by a direct call to the new plugin's `pickDirectory()`, keeping
the same `Promise<string | null>`-shaped contract at the call site so
`configureScanner`/`scannerService.ts` need no changes — only what's
*inside* `promptNativePath` changes, same as `42708f8`'s own diff shape.
The folder-name Dialog UI (state, JSX) is removed entirely.

## Testing

- Incremental prefilter: unit test on `nativeScan`'s prefilter logic with a
  mocked `findExistingFileNames`, confirming known (name,size) pairs are
  excluded before any read call fires (spy on the read function, assert
  call count).
- SAF plugin: no Vitest coverage possible (native Kotlin, no JS logic to
  unit test beyond the thin JS-side branching in `capacitorScanner.ts`,
  which the above test also exercises for the merge/branch logic with a
  mocked plugin).

## Diff estimate

- New: `android/app/src/main/java/com/delivroom/app/SafFolderPickerPlugin.kt`
- Modified: `android/app/src/main/java/com/delivroom/app/MainActivity.java`
  (register plugin), `android/app/build.gradle` (documentfile dep),
  `src/lib/capacitorScanner.ts` (prefilter + SAF branch),
  `src/components/BulkScreenshotUploader.tsx` (swap dialog for
  `pickDirectory()` call, remove dialog state/JSX)
- New test file for the prefilter logic.
