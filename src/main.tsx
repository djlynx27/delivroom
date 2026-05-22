import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';

import App from './App.tsx';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

// Diagnostic — visible in browser console so we can confirm the build picked
// up the env var. Logs the first 30 chars only so the full DSN isn't dumped
// to the console on every page load.
if (SENTRY_DSN) {
  console.info('[Sentry] init with DSN:', SENTRY_DSN.slice(0, 30) + '…');
} else {
  console.warn('[Sentry] VITE_SENTRY_DSN missing at build time — error tracking disabled');
}

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Performance — sample 10 % of transactions to stay under the free quota
    tracesSampleRate: 0.1,
    // Session Replay disabled for now (costs storage, we'll enable selectively
    // when investigating a specific bug)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Strip PII (driver addresses, GPS coords) before sending — Delivroom
    // handles location data and we don't want it leaving Quebec
    sendDefaultPii: false,
    beforeSend(event) {
      // Drop events from local dev unless explicitly opted in
      if (event.environment === 'development' && !import.meta.env.VITE_SENTRY_DEV) {
        return null;
      }
      return event;
    },
  });
}

registerSW({
  immediate: true,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
