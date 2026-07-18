import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('CLI selftest exercises PASS and fail-closed attacks', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/selftest.ts'], {
    cwd: process.cwd(), encoding: 'utf8', env: process.env,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /攻击测试全部通过/);
});
