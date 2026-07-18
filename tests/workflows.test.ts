import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWorkflows } from '../scripts/validate-workflows.ts';

test('all workflows use immutable actions and named secrets without hidden failures', () => {
  assert.deepEqual(validateWorkflows(), { ok: true, reasons: [] });
});
