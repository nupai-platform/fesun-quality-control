import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildAlertPayload } from '../scripts/emit-alert.ts';

test('alert payload is absent for PASS and redacts scope to verdict reasons', () => {
  rmSync('artifacts', { recursive: true, force: true });
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/verdict.json', JSON.stringify({ verdict: 'PASS' }));
  assert.equal(buildAlertPayload(), undefined);
  writeFileSync('artifacts/verdict.json', JSON.stringify({
    verdict: 'BLOCKED', failure_classification: 'ENVIRONMENT', bug_id: 'STO-186',
    blocked_reasons: ['missing staging'], reasons: [],
  }));
  assert.deepEqual(buildAlertPayload({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '1' }), {
    level: 'BLOCKED', classification: 'ENVIRONMENT', bug_id: 'STO-186',
    run_url: 'https://github.com/o/r/actions/runs/1', reasons: ['missing staging'],
  });
  rmSync('artifacts', { recursive: true, force: true });
});
