/** Fail closed on skipped tests, focused tests, weak business matchers, and brittle waits. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { globSync } from 'glob';
import ts from 'typescript';

export interface Violation { file: string; line: number; rule: string; text: string }

const FORBIDDEN: { re: RegExp; rule: string }[] = [
  { re: /\.toBeTruthy\s*\(/, rule: '禁止 toBeTruthy；必须断言具体业务值' },
  { re: /\.toBeFalsy\s*\(/, rule: '禁止 toBeFalsy；必须断言具体业务值' },
  { re: /\.toBeDefined\s*\(/, rule: 'toBeDefined 不能证明业务结果' },
  { re: /\.toBeGreaterThan\s*\(\s*0\s*\)/, rule: '仅检查数量大于 0 不能证明目标记录' },
  { re: /\btest\.(skip|fixme|only)\s*\(/, rule: '禁止 skip/fixme/only' },
  { re: /\b(?:test|describe)\.only\b/, rule: '禁止聚焦运行' },
  { re: /\bexpect\.soft\s*\(/, rule: '核心断言禁止 expect.soft' },
  { re: /force\s*:\s*true/, rule: '禁止 force:true 掩盖交互错误' },
  { re: /page\.waitForTimeout\s*\(/, rule: '禁止固定睡眠；使用条件等待' },
  { re: /\.catch\s*\(\s*\(?.*\)?\s*=>\s*(?:true|undefined|\{\s*\})/, rule: '禁止吞掉测试错误' },
  { re: /\.toContain\s*\(\s*['"](?:成功|success)/i, rule: '状态判定禁止仅包含“成功”文案' },
];

export function scanWeakAssertions(files: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const sourceText = readFileSync(file, 'utf8');
    sourceText.split('\n').forEach((raw, index) => {
      const trimmed = raw.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      for (const rule of FORBIDDEN) {
        if (rule.re.test(raw)) violations.push({
          file,
          line: index + 1,
          rule: rule.rule,
          text: trimmed.slice(0, 160),
        });
      }
    });

    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    const addAstViolation = (node: ts.Node, rule: string): void => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const text = node.getText(source).replace(/\s+/g, ' ').slice(0, 160);
      if (!violations.some((violation) => violation.file === file && violation.line === line && violation.rule === rule)) {
        violations.push({ file, line, rule, text });
      }
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(source);
        if (/\b(?:test\.(?:skip|fixme|only)|describe\.only)$/.test(expression)) {
          addAstViolation(node, 'AST: 禁止 skip/fixme/only');
        }
        if (/\.(?:toBeTruthy|toBeFalsy|toBeDefined)$/.test(expression)) {
          addAstViolation(node, 'AST: 弱 matcher 被禁止');
        }
        if (expression === 'page.waitForTimeout') addAstViolation(node, 'AST: 固定等待被禁止');

        if (expression === 'test' || expression.endsWith('.test')) {
          const callback = node.arguments.find(
            (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
              ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
          );
          if (callback && !/\bexpect\s*\(/.test(callback.body.getText(source))) {
            addAstViolation(node, '测试体缺 expect 业务断言');
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

function main(): void {
  const patterns = process.argv.slice(2);
  const files = [...new Set((patterns.length ? patterns : [
    'testing/**/*.spec.ts',
    'examples/**/*.spec.ts',
  ]).flatMap((pattern) => globSync(pattern, { nodir: true })))].sort();
  const violations = scanWeakAssertions(files);
  if (!files.length) violations.push({
    file: '(none)', line: 0, rule: '扫描范围内测试文件为 0（fail closed）', text: '',
  });
  const result = {
    computed_by: 'detect-weak-assertions.ts',
    generated_at: new Date().toISOString(),
    scanned_files: files.length,
    files,
    violations,
    ok: violations.length === 0,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/weak-assertions.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
