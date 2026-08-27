import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/react', () => ({ captureMessage: vi.fn() }));

import { logger, remoteTransport, sanitizeContext } from '@/lib/logger';
import * as Sentry from '@sentry/react';

describe('logger', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls console.debug for debug level', () => {
    logger.debug('test debug');
    expect(consoleSpy.debug).toHaveBeenCalledOnce();
    const args = consoleSpy.debug.mock.calls[0] as string[];
    expect(args[0]).toMatch(/\[DEBUG\]/);
    expect(args[1]).toBe('test debug');
  });

  it('calls console.info for info level', () => {
    logger.info('test info');
    expect(consoleSpy.info).toHaveBeenCalledOnce();
    const args = consoleSpy.info.mock.calls[0] as string[];
    expect(args[0]).toMatch(/\[INFO\]/);
    expect(args[1]).toBe('test info');
  });

  it('calls console.warn for warn level', () => {
    logger.warn('test warn');
    expect(consoleSpy.warn).toHaveBeenCalledOnce();
    const args = consoleSpy.warn.mock.calls[0] as string[];
    expect(args[0]).toMatch(/\[WARN\]/);
  });

  it('calls console.error for error level', () => {
    logger.error('test error');
    expect(consoleSpy.error).toHaveBeenCalledOnce();
    const args = consoleSpy.error.mock.calls[0] as string[];
    expect(args[0]).toMatch(/\[ERROR\]/);
  });

  it('includes ISO timestamp in the prefix', () => {
    logger.info('timestamp check');
    const args = consoleSpy.info.mock.calls[0] as string[];
    // ISO-8601 pattern e.g. 2026-03-21T10:32:11.000Z
    expect(args[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('passes context object as third argument when provided', () => {
    const ctx = { zone: 'Plateau', score: 87 };
    logger.info('with context', ctx);
    const args = consoleSpy.info.mock.calls[0] as unknown[];
    expect(args[2]).toEqual(ctx);
  });

  it('omits third argument when no context is provided', () => {
    logger.warn('no context');
    const args = consoleSpy.warn.mock.calls[0] as unknown[];
    expect(args).toHaveLength(2);
  });
});

describe('remoteTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards warn/error to Sentry but skips debug/info', () => {
    const captureSpy = vi.mocked(Sentry.captureMessage);

    remoteTransport({
      level: 'error',
      message: 'boom',
      timestamp: new Date().toISOString(),
    });
    remoteTransport({
      level: 'debug',
      message: 'noisy',
      timestamp: new Date().toISOString(),
    });

    expect(captureSpy).toHaveBeenCalledOnce();
    expect(captureSpy).toHaveBeenCalledWith(
      'boom',
      expect.objectContaining({ level: 'error' })
    );
  });
});

describe('sanitizeContext', () => {
  it('redacts sensitive keys but keeps the rest', () => {
    const clean = sanitizeContext({
      zone: 'Plateau',
      authToken: 'abc123',
      latitude: 45.5,
      driverEmail: 'x@y.com',
    });
    expect(clean).toEqual({
      zone: 'Plateau',
      authToken: '[redacted]',
      latitude: '[redacted]',
      driverEmail: '[redacted]',
    });
  });

  it('returns undefined for undefined input', () => {
    expect(sanitizeContext(undefined)).toBeUndefined();
  });
});
