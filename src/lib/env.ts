// Which build this is — commercial (DailyVroom, delivroom.vercel.app) or
// lab (Delivroom Lab, the personal native APK). Set via VITE_APP_TARGET at
// build time (see .env.lab + package.json's build:apk script); unset
// defaults to commercial, since the plain `vite build` Vercel runs never
// sets it.
export type AppTarget = 'commercial' | 'lab';

export function getAppTarget(): AppTarget {
  return import.meta.env.VITE_APP_TARGET === 'lab' ? 'lab' : 'commercial';
}

export function isLabBuild(): boolean {
  return getAppTarget() === 'lab';
}

export function isCommercialBuild(): boolean {
  return getAppTarget() === 'commercial';
}
