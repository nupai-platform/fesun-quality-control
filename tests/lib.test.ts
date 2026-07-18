import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertionMatches,
  jsonPointerGet,
  maxRisk,
  redactSensitive,
  sha256,
  stableStringify,
  type PacketAssertion,
} from '../scripts/lib.ts';

test('stableStringify and sha256 are deterministic', () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(sha256('x').length, 64);
});

test('JSON Pointer and strict assertion operators', () => {
  const raw = { status: 'completed', count: 2, tags: ['a', 'b'], nested: { 'a/b': true } };
  assert.equal(jsonPointerGet(raw, '/nested/a~1b'), true);
  const base: Omit<PacketAssertion, 'operator' | 'expected'> = {
    id: 'status', selector: '/status', required_collectors: ['playwright_attachment'], min_independent_sources: 1,
  };
  assert.equal(assertionMatches({ ...base, operator: 'equals', expected: 'completed' }, raw), true);
  assert.equal(assertionMatches({ ...base, operator: 'equals', expected: true }, raw), false);
  assert.equal(assertionMatches({ ...base, operator: 'not_equals', expected: 'pending' }, raw), true);
  assert.equal(assertionMatches({ ...base, selector: '/tags', operator: 'contains', expected: 'b' }, raw), true);
  assert.equal(assertionMatches({ ...base, selector: '/tags', operator: 'array_length_equals', expected: 2 }, raw), true);
});

test('redaction is recursive and risk cannot downgrade', () => {
  const result = redactSensitive({ user: { accessToken: 'secret', name: 'ok' } }, ['token']);
  assert.deepEqual(result.value, { user: { accessToken: '[REDACTED]', name: 'ok' } });
  assert.deepEqual(result.redactions, ['/user/accessToken']);
  assert.equal(maxRisk('CRITICAL', 'FAST'), 'CRITICAL');
  assert.equal(maxRisk('STANDARD', 'CROSS_SYSTEM'), 'CROSS_SYSTEM');
});
