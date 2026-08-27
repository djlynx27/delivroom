/**
 * Structured Logger — ISO 25010 Observability (Metrics, Logs, Traces)
 *
 * Provides a thin structured-logging layer over console that:
 * - Adds log levels (debug, info, warn, error)
 * - Stamps ISO-8601 timestamps
 * - Attaches structured context objects (JSON-serialisable)
 * - Suppresses debug output in production
 * - Forwards warn/error to Sentry so they show up in the same place as
 *   render-crash reports, instead of only ever reaching the console.
 */

import * as Sentry from '@sentry/react';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Context keys that could carry PII (GPS coords, auth tokens, emails) never
// leave the device — main.tsx already sets sendDefaultPii: false for Sentry
// events, this is the same rule applied to our own structured context.
const SENSITIVE_KEY_PATTERN =
  /token|password|secret|email|latitude|longitude|lat$|lng$|coords?/i;

export function sanitizeContext(
  context?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    clean[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : value;
  }
  return clean;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

type Transport = (entry: LogEntry) => void;

const IS_PROD = import.meta.env.PROD;

/** Console transport — always active */
const consoleTransport: Transport = (entry) => {
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
  const fn = entry.level === 'error'
    ? console.error
    : entry.level === 'warn'
      ? console.warn
      : entry.level === 'debug'
        ? console.debug
        : console.info;

  if (entry.context) {
    fn(prefix, entry.message, entry.context);
  } else {
    fn(prefix, entry.message);
  }
};

/** Remote transport — forwards warn/error to Sentry (no-op if Sentry.init was never called, e.g. dev without a DSN) */
export const remoteTransport: Transport = (entry) => {
  if (entry.level !== 'warn' && entry.level !== 'error') return;
  Sentry.captureMessage(entry.message, {
    level: entry.level === 'error' ? 'error' : 'warning',
    extra: sanitizeContext(entry.context),
  });
};

const transports: Transport[] = IS_PROD
  ? [consoleTransport, remoteTransport]
  : [consoleTransport];

function emit(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  // Suppress debug logs in production
  if (IS_PROD && level === 'debug') return;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
  };

  for (const transport of transports) {
    try {
      transport(entry);
    } catch {
      // Never let logging crash the app
    }
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    emit('debug', message, context),

  info: (message: string, context?: Record<string, unknown>) =>
    emit('info', message, context),

  warn: (message: string, context?: Record<string, unknown>) =>
    emit('warn', message, context),

  error: (message: string, context?: Record<string, unknown>) =>
    emit('error', message, context),
} as const;
