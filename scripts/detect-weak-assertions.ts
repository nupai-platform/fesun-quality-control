/**
 * detect-weak-assertions.ts v1.1
 *
 * 扫描 Playwright 测试文件,禁止核心业务断言使用弱断言/跳过。
 * 命中即输出违规清单,退出码 1(verdict-gate 据此判 WEAK_ASSERTION → FAIL)。
 *
 * 用法: tsx scripts/detect-weak-assertions.ts <glob...>   例如 'testing/**\/*.spec.ts'
 * 无参数时默认扫描 testing/ 与 examples/ 下的 .spec.ts
 *
 * 注:这是文本/正则级 lint,作为第一道机器闸门;更严格的 AST 校验可后续接入 ts-morph。
 */
import { readFileSync } from 'node:fs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { globSync } from 'glob';

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

// 规则:核心业务断言禁止的模式
const FORBIDDEN: { re: RegExp; rule: string }[] = [
  { re: /\.toBeTruthy\s*\(/, rule: 'toBeTruthy 用于业务判定被禁止,请断言具体值' },
  { re: /\.toBeFalsy\s*\(/, rule: 'toBeFalsy 用于业务判定被禁止,请断言具体值' },
  { re: /\.toBeDefined\s*\(/, rule: 'toBeDefined 不足以证明业务结果' },
  { re: /expect\s*\(\s*[^)]*\.ok\s*\(\s*\)\s*\)\s*\.toBeTruthy/, rule: 'expect(res.ok()).toBeTruthy() 被禁止,必须解析响应体断言业务字段' },
  { re: /\btest\.skip\s*\(/, rule: 'test.skip 被禁止' },
  { re: /\btest\.fixme\s*\(/, rule: 'test.fixme 被禁止' },
  { re: /\btest\.only\s*\(/, rule: 'test.only 被禁止(会漏跑其他测试)' },
  { re: /\bexpect\.soft\s*\(/, rule: '核心断言禁止 expect.soft' },
  { re: /force\s*:\s*true/, rule: 'force:true 掩盖不可点击问题,被禁止' },
  { re: /page\.waitForTimeout\s*\(/, rule: 'waitForTimeout 作为主等待被禁止,请用基于条件的等待' },
];

// 允许豁免的行(测试可显式标注 // qc-allow-weak: 原因)
const ALLOW_MARK = /qc-allow-weak:/;

function main(): void {
  const patterns = process.argv.slice(2);
  const globs = patterns.length
    ? patterns
    : ['testing/**/*.spec.ts', 'examples/**/*.spec.ts'];

  const files = globs.flatMap((g) => globSync(g, { nodir: true }));
  const violations: Violation[] = [];

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((raw, idx) => {
      if (ALLOW_MARK.test(raw)) return;
      // 跳过纯注释行
      const trimmed = raw.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      for (const rule of FORBIDDEN) {
        if (rule.re.test(raw)) {
          violations.push({ file, line: idx + 1, rule: rule.rule, text: trimmed.slice(0, 160) });
        }
      }
    });
  }

  const result = {
    computed_by: 'detect-weak-assertions.ts',
    generated_at: new Date().toISOString(),
    scanned_files: files.length,
    violations,
    ok: violations.length === 0,
  };

  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/weak-assertions.json', JSON.stringify(result, null, 2));

  if (violations.length > 0) {
    console.error(`发现 ${violations.length} 处弱断言违规:`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
    }
    process.exit(1);
  }
  console.log(`弱断言扫描通过:${files.length} 个文件无违规。`);
}

main();
