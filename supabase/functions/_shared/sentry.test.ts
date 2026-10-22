import { assertEquals, assertInstanceOf } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { toError } from './sentry.ts';

Deno.test('toError: keeps real Error instances untouched', () => {
  const e = new Error('boom');
  assertEquals(toError(e), e);
});

Deno.test('toError: wraps a PostgrestError-like object with its code', () => {
  const e = toError({ code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' });
  assertInstanceOf(e, Error);
  assertEquals(e.message, '[PGRST002] Could not query the database for the schema cache. Retrying.');
});

Deno.test('toError: non-object values become an Error', () => {
  assertEquals(toError('oops').message, 'oops');
});
