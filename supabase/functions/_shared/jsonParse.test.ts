import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { lenientJsonParse } from './jsonParse.ts';

Deno.test('lenientJsonParse: parses strict JSON directly', () => {
  assertEquals(lenientJsonParse('{"a":1}'), { a: 1 });
});

Deno.test('lenientJsonParse: strips ```json fences', () => {
  assertEquals(lenientJsonParse('```json\n{"a":1}\n```'), { a: 1 });
});

Deno.test('lenientJsonParse: strips plain ``` fences', () => {
  assertEquals(lenientJsonParse('```\n{"a":1}\n```'), { a: 1 });
});

Deno.test('lenientJsonParse: finds the first balanced {...} block amid prose', () => {
  const raw = 'Sure, here you go:\n{"a":1,"b":{"c":2}}\nHope that helps!';
  assertEquals(lenientJsonParse(raw), { a: 1, b: { c: 2 } });
});

Deno.test('lenientJsonParse: braces inside string values do not break balancing', () => {
  const raw = '{"note":"use { and } carefully","a":1}';
  assertEquals(lenientJsonParse(raw), { note: 'use { and } carefully', a: 1 });
});

Deno.test('lenientJsonParse: returns null for unparseable garbage', () => {
  assertEquals(lenientJsonParse('not json at all'), null);
});

Deno.test('lenientJsonParse: returns null when braces never close', () => {
  assertEquals(lenientJsonParse('{"a":1'), null);
});
