/**
 * Self-check: proves the official FESUN acceptance-gate caller is NOT
 * rejected by its own supply-chain checker once it is pinned to the exact
 * release 1.1.0 commit SHA, and proves that a tag-pinned caller WOULD be
 * rejected (the original defect this change fixes).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWorkflows } from '../scripts/validate-workflows.ts';

const OFFICIAL_CALLER = 'examples/fesun-official-caller/acceptance-gate.yml';
const RELEASE_SHA = '98788c7ab8c6fbe32d47225f79f3e220d79c81ce';
const REUSABLE = 'reusable-pr-gate.yml';

test('official FESUN caller is pinned to the exact 40-hex release SHA', () => {
  const text = readFileSync(OFFICIAL_CALLER, 'utf8');
  assert.match(text, new RegExp(REUSABLE + '@' + RELEASE_SHA));
  // Must not use a moving tag/branch ref.
  assert.doesNotMatch(text, new RegExp(REUSABLE + '@' + 'v\\d'));
});

test('checker does NOT reject the SHA-pinned official caller (no self-rejection)', () => {
  assert.deepEqual(validateWorkflows([OFFICIAL_CALLER]), { ok: true, reasons: [] });
});

test('checker DOES reject the same caller when pinned to a release tag', () => {
  const text = readFileSync(OFFICIAL_CALLER, 'utf8');
  const tagPinned = text.replace(
    new RegExp(REUSABLE + '@' + RELEASE_SHA),
    REUSABLE + '@' + 'v1.1.0',
  );
  const dir = mkdtempSync(join(tmpdir(), 'qc-selfcheck-'));
  const file = join(dir, 'acceptance-gate.yml');
  writeFileSync(file, tagPinned);
  const result = validateWorkflows([file]);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.length > 0);
});
