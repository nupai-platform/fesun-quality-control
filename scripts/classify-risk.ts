/**
 * classify-risk.ts v1.1
 *
 * final_risk = max( bug_packet.declared_level , diff_inferred_risk , keyword_inferred_risk )
 * AI/人只能升,不能降。
 *
 * 用法:
 *   tsx scripts/classify-risk.ts --packet <bug-packet.yaml> [--base <sha>] [--head <sha>]
 * 输出: JSON 到 stdout,并写 artifacts/risk.json
 * 退出码: 0 正常;2 缺事实源(BLOCKED)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { readYAML, git, maxRisk, type RiskLevel } from './lib.ts';

interface Args {
  packet: string;
  base?: string;
  head?: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const packet = get('--packet');
  if (!packet) {
    console.error('缺少 --packet <bug-packet.yaml>');
    process.exit(2);
  }
  return { packet, base: get('--base'), head: get('--head') };
}

// diff 路径 → 最低风险等级
const PATH_RULES: { re: RegExp; level: RiskLevel; note: string }[] = [
  { re: /(^|\/)migrations\//, level: 'CRITICAL', note: '数据库迁移' },
  { re: /schema\.prisma$/, level: 'CRITICAL', note: 'schema 变更' },
  { re: /(^|\/)integrations\//, level: 'CROSS_SYSTEM', note: '系统间集成' },
  { re: /(^|\/)consumers?\//, level: 'CROSS_SYSTEM', note: '事件消费端' },
  { re: /(^|\/)sync\//, level: 'CROSS_SYSTEM', note: '跨系统同步' },
  { re: /(^|\/)services\//, level: 'CRITICAL', note: '业务服务' },
  { re: /(^|\/)events\//, level: 'CRITICAL', note: '事件发布' },
  { re: /(^|\/)permissions?\//, level: 'CRITICAL', note: '权限' },
  { re: /status/i, level: 'CRITICAL', note: '状态相关' },
  { re: /(^|\/)shared\//, level: 'CRITICAL', note: '共享代码' },
  { re: /(^|\/)api\//, level: 'STANDARD', note: 'API' },
  { re: /(^|\/)models?\//, level: 'STANDARD', note: '数据模型' },
];

// 描述关键词 → 最低风险等级
const KEYWORD_RULES: { words: string[]; level: RiskLevel }[] = [
  { words: ['状态', '完成', '审核', '派单', '同步', '权限', '金额', '删除', '重复', 'status', 'delete', 'permission'], level: 'CRITICAL' },
  { words: ['保存', '刷新后', '数据没保存', '列表不一致', '持久', 'persist', 'reload', 'save'], level: 'STANDARD' },
];

function inferFromPaths(files: string[]): { level: RiskLevel; hits: string[] } {
  let level: RiskLevel = 'FAST';
  const hits: string[] = [];
  for (const f of files) {
    for (const rule of PATH_RULES) {
      if (rule.re.test(f)) {
        level = maxRisk(level, rule.level);
        hits.push(`${f} → ${rule.level} (${rule.note})`);
      }
    }
  }
  return { level, hits };
}

function inferFromText(text: string): { level: RiskLevel; hits: string[] } {
  let level: RiskLevel = 'FAST';
  const hits: string[] = [];
  const lower = text.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    for (const w of rule.words) {
      if (text.includes(w) || lower.includes(w.toLowerCase())) {
        level = maxRisk(level, rule.level);
        hits.push(`关键词 "${w}" → ${rule.level}`);
      }
    }
  }
  return { level, hits };
}

function main(): void {
  const args = parseArgs();
  const packet = readYAML<any>(args.packet);

  // 事实源硬检查
  if (!packet?.bug?.original_description) {
    emitBlocked('缺 original_description', args.packet);
    return;
  }

  const declared: RiskLevel = packet?.risk_claim?.declared_level ?? 'FAST';

  // diff 推断
  let changedFiles: string[] = [];
  if (args.base && args.head) {
    const out = git(`diff --name-only ${args.base}...${args.head}`);
    changedFiles = out ? out.split('\n').filter(Boolean) : [];
  }
  const pathInf = inferFromPaths(changedFiles);
  const textInf = inferFromText(
    `${packet.bug.title} ${packet.bug.original_description}`,
  );

  let finalLevel = maxRisk(maxRisk(declared, pathInf.level), textInf.level);

  // 跨系统未确认时,若声明含多系统或命中跨系统路径,已升级;此处兜底:
  const scopeSystems = new Set<string>();
  (packet?.business_scope?.affected_contracts ?? []).forEach((c: string) => {
    const sys = c.split('.')[0];
    if (sys) scopeSystems.add(sys);
  });
  if (scopeSystems.size >= 2) finalLevel = maxRisk(finalLevel, 'CROSS_SYSTEM');

  // 非 FAST 必须有 expected_business_result
  if (finalLevel !== 'FAST' && !packet?.expected_business_result?.assertions) {
    emitBlocked(
      `风险等级 ${finalLevel} 但缺 expected_business_result.assertions`,
      args.packet,
    );
    return;
  }

  const result = {
    computed_by: 'classify-risk.ts',
    generated_at: new Date().toISOString(),
    bug_id: packet.bug.id,
    declared_level: declared,
    diff_inferred: pathInf.level,
    keyword_inferred: textInf.level,
    final_risk: finalLevel,
    downgrade_blocked: true,
    changed_files_count: changedFiles.length,
    path_hits: pathInf.hits,
    keyword_hits: textInf.hits,
    cross_system_from_scope: scopeSystems.size >= 2,
  };

  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/risk.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

function emitBlocked(reason: string, packetPath: string): void {
  const out = {
    computed_by: 'classify-risk.ts',
    generated_at: new Date().toISOString(),
    final_risk: 'MANUAL_REVIEW' as RiskLevel,
    verdict: 'BLOCKED',
    failure_classification: 'MISSING_FACT_SOURCE',
    reason,
    packet: packetPath,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/risk.json', JSON.stringify(out, null, 2));
  console.error(JSON.stringify(out, null, 2));
  process.exit(2);
}

main();
