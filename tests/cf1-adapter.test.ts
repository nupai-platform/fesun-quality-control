import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedCrmFailure, safeRelativePath } from '../scripts/cf1-adapter-guards.ts';

test('CRM CF-1 adapter only accepts concrete legacy failure signatures', () => {
  assert.equal(expectedCrmFailure('expect(page).toHaveURL(/region=cn_bj/)'), true);
  assert.equal(expectedCrmFailure("getByTestId('account-region-filter') toBeVisible failed"), true);
  assert.equal(expectedCrmFailure('expect(page).toHaveURL(/industry=科技/)'), false);
  assert.equal(expectedCrmFailure('Error: region=cn_bj assertion mismatch'), false);
  assert.equal(expectedCrmFailure('getByTestId(\'account-industry-filter\') toBeVisible failed'), false);
});

test('CF-1 test path cannot escape the candidate checkout', () => {
  assert.equal(safeRelativePath('frontend/tests/e2e/nup924-account-filters.spec.ts'), 'frontend/tests/e2e/nup924-account-filters.spec.ts');
  assert.throws(() => safeRelativePath('../outside.spec.ts'), /不安全/);
  assert.throws(() => safeRelativePath('/tmp/outside.spec.ts'), /不安全/);
});
