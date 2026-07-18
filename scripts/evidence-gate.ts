/**
 * evidence-gate.ts v1.1
 *
 * 在 verdict-gate 之前运行:校验证据产物的"存在性与格式合法性"(不做业务判定)。
 * 用 JSON Schema 校验 evidence-raw 中每条证据的结构,拒绝携带布尔判定字段的伪造证据。
 *
 * 用法: tsx scripts/evidence-gate.ts --profile <FAST|STANDARD|CRITICAL|CROSS_SYSTEM>
 * 退出码: 0 通过;1 证据缺失/非法
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { globSync } from 'glob';
import Ajv from 'ajv';
import { readJSON, fileExists } from './lib.ts';

function arg(flag: string): string | undefined {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 ? a[i + 1] : undefined;
}

// 判定字段黑名单:证据里绝不允许出现(否则就是 AI 自报判定)
const FORBIDDEN_KEYS = [
  'verdict',
  'merge_allowed',
  'backend_verified',
  'reload_verified',
  'reentry_verified',
  'second_evidence_verified',
  'pass',
  'passed',
];

function main(): void {
  const profile = arg('--profile') ?? 'STANDARD';
  const reasons: string[] = [];

  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = readJSON('schemas/evidence-event.schema.json');
  const validate = ajv.compile(schema as object);

  // 必需产物
  const required = ['artifacts/report.json', 'artifacts/reporter-summary.json'];
  for (const f of required) {
    if (!fileExists(f)) reasons.push(`缺必需产物: ${f}`);
  }

  const files = globSync('artifacts/evidence-raw/*.json', { nodir: true });

  // 非 FAST 必须有至少一条后端证据
  if (profile !== 'FAST' && files.length === 0) {
    reasons.push(`${profile} 要求至少一条 evidence-raw 原始证据,当前为 0`);
  }

  for (const file of files) {
    let obj: unknown;
    try {
      obj = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      reasons.push(`证据无法解析: ${file}`);
      continue;
    }
    // 黑名单键检查
    const keys = JSON.stringify(obj);
    for (const bad of FORBIDDEN_KEYS) {
      if (new RegExp(`"${bad}"\\s*:`).test(keys)) {
        reasons.push(`证据 ${file} 含被禁判定字段 "${bad}" —— 判定只能由 verdict-gate 计算`);
      }
    }
    if (!validate(obj)) {
      reasons.push(`证据 ${file} 不符合 evidence-event schema: ${ajv.errorsText(validate.errors)}`);
    }
  }

  const result = {
    computed_by: 'evidence-gate.ts',
    generated_at: new Date().toISOString(),
    profile,
    evidence_count: files.length,
    reasons,
    ok: reasons.length === 0,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/evidence-gate.json', JSON.stringify(result, null, 2));

  if (reasons.length > 0) {
    console.error('证据闸门未通过:');
    reasons.forEach((r) => console.error(`  ${r}`));
    process.exit(1);
  }
  console.log(`证据闸门通过:${files.length} 条原始证据格式合法,无伪造判定字段。`);
}

main();
