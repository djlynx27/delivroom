// Background runner — runs in a Hermes V8 isolate, NOT the WebView.
// API is limited: CapacitorKV for storage, Filesystem for files, Notifications.
// No DOM, no React, no localStorage. Keep this file self-contained.
//
// The runner fires the 'scheduledScan' event every 30 minutes (subject to
// OS throttling — Android WorkManager floor is ~15 min). When the user
// configures the Maxymo folder path through the in-app UI, the WebView
// stores it into CapacitorKV so this runner can read it.

addEventListener('scheduledScan', async (resolve, reject) => {
  try {
    const path = CapacitorKV.get('maxymo-folder-path');
    if (!path) {
      // No folder configured yet — nothing to scan
      resolve();
      return;
    }

    const result = await CapacitorFilesystem.readdir({
      path,
      directory: 'EXTERNAL_STORAGE',
    });
    const entries = result.files || [];

    // Filter: image files whose name contains "Maxymo" (case-insensitive)
    const matches = entries.filter((e) => {
      if (!e.name) return false;
      if (!/\.(jpe?g|png|webp)$/i.test(e.name)) return false;
      return e.name.toLowerCase().includes('maxymo');
    });

    if (!matches.length) {
      resolve();
      return;
    }

    // Compare against seen keys (stored as JSON array under 'maxymo-seen-keys')
    const seenRaw = CapacitorKV.get('maxymo-seen-keys');
    const seen = new Set(seenRaw ? JSON.parse(seenRaw) : []);

    const newFiles = matches.filter((m) => {
      const key = `${m.name}|${m.size || 0}|${m.mtime || 0}`;
      return !seen.has(key);
    });

    if (!newFiles.length) {
      resolve();
      return;
    }

    // Mark every file as seen so we don't re-notify in 30 min about the same
    // batch. The user importing them is independent.
    for (const m of matches) {
      seen.add(`${m.name}|${m.size || 0}|${m.mtime || 0}`);
    }
    CapacitorKV.set('maxymo-seen-keys', JSON.stringify([...seen]));

    // Pop a system notification with a deep link the WebView picks up on
    // launch (App.addListener('appStateChange') + the ?from=auto-scan query
    // already wired in BulkScreenshotUploader).
    await CapacitorNotifications.schedule({
      notifications: [
        {
          id: Date.now() & 0x7fffffff,
          title: 'Delivroom',
          body:
            newFiles.length === 1
              ? '1 nouveau screenshot Maxymo à importer'
              : `${newFiles.length} nouveaux screenshots Maxymo à importer`,
          extra: { url: '/admin/imports?from=auto-scan' },
        },
      ],
    });

    resolve();
  } catch (err) {
    console.error('[maxymo-scan runner] failed:', err);
    reject(err);
  }
});
