/// <reference types="vite/client" />

// Injected by vite.config.ts's `define` — short git commit SHA (Vercel's
// VERCEL_GIT_COMMIT_SHA in production, local `git rev-parse --short HEAD`
// otherwise). See VersionBadge.tsx.
declare const __COMMIT_SHA__: string;
// Injected from package.json's `version` field.
declare const __APP_VERSION__: string;
