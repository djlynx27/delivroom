import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';

import App from './App.tsx';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Release name is injected at build time by @sentry/vite-plugin (defaults
    // to the git commit SHA). Tagging runtime events with the release that
    // shipped the source maps means stack traces can be properly demangled.
    release: import.meta.env.SENTRY_RELEASE as string | undefined,
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
