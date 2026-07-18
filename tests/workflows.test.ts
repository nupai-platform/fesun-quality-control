import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWorkflows } from '../scripts/validate-workflows.ts';

test('all workflows use immutable actions and named secrets without hidden failures', () => {
  assert.deepEqual(validateWorkflows(), { ok: true, reasons: [] });
});

test('explicit workflow file selection supports business-repository Caller validation', () => {
  assert.deepEqual(validateWorkflows(['templates/adapters/fesun-platform-acceptance-gate.yml']), { ok: true, reasons: [] });
});
