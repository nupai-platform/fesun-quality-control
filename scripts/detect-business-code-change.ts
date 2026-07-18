/**
 * detect-business-code-change.ts v1.1
 *
 * 测试 Worker 只允许改测试白名单路径。命中业务代码 → 违规 → verdict FAIL
 * (failure_classification = TEST_WORKER_MODIFIED_BUSINESS_CODE)。
 *
 * 用法: tsx scripts/detect-business-code-change.ts --base <sha> [--head <sha>]
 * 无 --base 时尝试 origin/main。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { git, isAllowedTestPath, FORBIDDEN_BUSINESS_PATHS } from './lib.ts';

function arg(flag: string): string | undefined {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 ? a[i + 1] : undefined;
}

function main(): void {
  const base = arg('--base') || 'origin/main';
  const head = arg('--head') || 'HEAD';

  const out = git(`diff --name-only ${base}...${head}`);
  const changed = out ? out.split('\n').filter(Boolean) : [];

  const businessChanges = changed.filter((f) => {
    if (isAllowedTestPath(f)) return false;
    return FORBIDDEN_BUSINESS_PATHS.some((re) => re.test(f)) || !isAllowedTestPath(f);
  });

  const result = {
    computed_by: 'detect-business-code-change.ts',
    generated_at: new Date().toISOString(),
    base,
    head,
    changed_files: changed,
    business_changes: businessChanges,
    ok: businessChanges.length === 0,
  };

  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/business-code-change.json', JSON.stringify(result, null, 2));

  if (businessChanges.length > 0) {
    console.error('测试任务修改了业务代码(禁止):');
    businessChanges.forEach((f) => console.error(`  ${f}`));
    process.exit(1);
  }
  console.log(`业务代码零修改检查通过(${changed.length} 个变更文件均在测试白名单内)。`);
}

main();
