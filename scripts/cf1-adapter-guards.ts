/** Pure validation guards shared by system CF-1 adapters and their tests. */

export function safeRelativePath(value: string): string {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`不安全的 test path: ${value}`);
  }
  return value;
}

export function expectedCrmFailure(output: string): boolean {
  // The adapter must observe the old broken URL assertion, not merely any failed test.
  return output.includes('region=cn_bj') && output.includes('toHaveURL');
}
