import { isCommercialBuild, isLabBuild } from '@/lib/env';
import type { ReactNode } from 'react';

/** Renders children only in the Lab (native APK) build — see src/lib/env.ts. */
export function LabOnly({ children }: { children: ReactNode }) {
  return isLabBuild() ? <>{children}</> : null;
}

/** Renders children only in the commercial (DailyVroom PWA) build. */
export function CommercialOnly({ children }: { children: ReactNode }) {
  return isCommercialBuild() ? <>{children}</> : null;
}
