/** Pure validation guards shared by system CF-1 adapters and their tests. */

export function safeRelativePath(value: string): string {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`不安全的 test path: ${value}`);
  }
  return value;
}

export function expectedCrmFailure(output: string): boolean {
  // Accept only the two concrete legacy signatures observed for this test:
  // the older URL assertion or the pre-filter UI missing the region control.
  const oldUrlAssertion = output.includes('region=cn_bj') && output.includes('toHaveURL');
  const missingRegionControl = output.includes('account-region-filter') && output.includes('toBeVisible');
  return oldUrlAssertion || missingRegionControl;
}
