import { toast } from 'sonner';

/**
 * Discrete build indicator — `v{package.json version} ({short git SHA})`.
 * SHA comes from __COMMIT_SHA__ (injected by vite.config.ts: Vercel's
 * VERCEL_GIT_COMMIT_SHA in production, local `git rev-parse --short HEAD`
 * otherwise). Tap to copy the full label — useful when reporting a bug
 * against a specific deploy.
 */
export function VersionBadge() {
  function handleClick() {
    const label = `v${__APP_VERSION__} (${__COMMIT_SHA__})`;
    void navigator.clipboard
      ?.writeText(label)
      .then(() => toast.success('Version copiée', { description: label }))
      .catch(() => {
        // Clipboard permission denied or unavailable — the label is already
        // visible on screen, nothing else to fall back to.
      });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-[10px] text-muted-foreground font-mono tracking-wide opacity-60 hover:opacity-100 transition-opacity"
    >
      v{__APP_VERSION__} ({__COMMIT_SHA__})
    </button>
  );
}
