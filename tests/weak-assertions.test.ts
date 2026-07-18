import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { scanWeakAssertions } from '../scripts/detect-weak-assertions.ts';

const temporary = mkdtempSync(join(tmpdir(), 'fesun-weak-'));
after(() => rmSync(temporary, { recursive: true, force: true }));

test('AST/static scanner accepts concrete assertions', () => {
  const path = join(temporary, 'good.spec.ts');
  writeFileSync(path, "test('x', async () => { expect(status).toBe('completed'); });");
  assert.deepEqual(scanWeakAssertions([path]), []);
});

test('AST/static scanner catches skip, weak matcher, waits and empty test body', () => {
  const path = join(temporary, 'bad.spec.ts');
  writeFileSync(path, "test.skip('x', async () => { await page.waitForTimeout(10); expect(ok).toBeTruthy(); });\ntest('empty', async () => { doWork(); });");
  const rules = scanWeakAssertions([path]).map((violation) => violation.rule).join(' ');
  assert.match(rules, /skip/);
  assert.match(rules, /弱|toBeTruthy/);
  assert.match(rules, /等待/);
  assert.match(rules, /缺 expect/);
});
