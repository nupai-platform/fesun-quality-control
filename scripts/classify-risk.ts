/** Monotonic risk classifier: final = max(declared, path, keyword, cross-system scope). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gitExec, maxRisk, readYAML, type BugPacket, type RiskLevel } from './lib.ts';
import { validatePacket } from './validate-packet.ts';

const PATH_RULES: { re: RegExp; level: RiskLevel; note: string }[] = [
  { re: /(^|\/)(migrations?|database)\//, level: 'CRITICAL', note: '数据库变更' },
  { re: /schema\.prisma$/, level: 'CRITICAL', note: '数据库 schema' },
  { re: /(^|\/)(integrations?|consumers?|sync|webhooks?)\//, level: 'CROSS_SYSTEM', note: '跨系统集成' },
  { re: /(^|\/)(auth|permissions?|payments?|billing)\//, level: 'CRITICAL', note: '权限或资金' },
  { re: /(^|\/)(services?|events?|workflows?|feature[-_]?flags?|config)\//, level: 'CRITICAL', note: '核心业务控制面' },
  { re: /(^|\/)shared\//, level: 'CRITICAL', note: '共享代码' },
  { re: /(^|\/)(api|models?)\//, level: 'STANDARD', note: 'API 或模型' },
];

const KEYWORD_RULES: { words: string[]; level: RiskLevel }[] = [
  { words: ['跨系统', '同步', 'webhook', 'consumer', 'integration'], level: 'CROSS_SYSTEM' },
  { words: ['状态', '审核', '派单', '权限', '金额', '支付', '删除', '重复', 'status', 'delete', 'permission'], level: 'CRITICAL' },
  { words: ['保存', '刷新后', '列表不一致', '持久', 'persist', 'reload', 'save'], level: 'STANDARD' },
];

export function inferRiskFromPaths(files: string[]): { level: RiskLevel; hits: string[] } {
  let level: RiskLevel = 'FAST';
  const hits: string[] = [];
  for (const file of files) for (const rule of PATH_RULES) if (rule.re.test(file)) {
    level = maxRisk(level, rule.level);
    hits.push(`${file} → ${rule.level} (${rule.note})`);
  }
  return { level, hits };
}

export function inferRiskFromText(text: string): { level: RiskLevel; hits: string[] } {
  let level: RiskLevel = 'FAST';
  const hits: string[] = [];
  const lower = text.toLowerCase();
  for (const rule of KEYWORD_RULES) for (const word of rule.words) {
    if (lower.includes(word.toLowerCase())) {
      level = maxRisk(level, rule.level);
      hits.push(`关键词 "${word}" → ${rule.level}`);
    }
  }
  return { level, hits };
}

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function emitBlocked(reason: string, packetPath?: string): never {
  const output = {
    computed_by: 'classify-risk.ts', generated_at: new Date().toISOString(),
    final_risk: 'MANUAL_REVIEW', verdict: 'BLOCKED',
    failure_classification: 'MISSING_FACT_SOURCE', reason, packet: packetPath,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/risk.json', JSON.stringify(output, null, 2));
  console.error(JSON.stringify(output, null, 2));
  process.exit(2);
}

function main(): void {
  const packetPath = arg('--packet');
  if (!packetPath) emitBlocked('缺 --packet');
  let packet: BugPacket;
  try { packet = readYAML<BugPacket>(packetPath); }
  catch (error) { emitBlocked(`无法读取 Packet: ${(error as Error).message}`, packetPath); }
  const packetCheck = validatePacket(packet);
  if (!packetCheck.ok) emitBlocked(packetCheck.reasons.join('; '), packetPath);

  const base = arg('--base');
  const head = arg('--head');
  if ((base && !head) || (!base && head)) emitBlocked('diff 推断必须同时提供 --base 与 --head', packetPath);
  let changedFiles: string[] = [];
  if (base && head) {
    const diff = gitExec(['diff', '--name-only', `${base}...${head}`]);
    if (!diff.ok) emitBlocked(`无法读取可信 diff: ${diff.error}`, packetPath);
    changedFiles = diff.stdout.split('\n').filter(Boolean);
  }

  const pathRisk = inferRiskFromPaths(changedFiles);
  const textRisk = inferRiskFromText(`${packet.bug.title} ${packet.bug.original_description}`);
  let finalRisk = maxRisk(maxRisk(packet.risk_claim.declared_level, pathRisk.level), textRisk.level);
  const systems = new Set((packet.business_scope?.affected_contracts ?? [])
    .map((contract) => contract.split('.')[0]).filter(Boolean));
  if (systems.size >= 2) finalRisk = maxRisk(finalRisk, 'CROSS_SYSTEM');
  if (finalRisk === 'MANUAL_REVIEW') emitBlocked('Packet 声明需要人工复核', packetPath);

  const output = {
    computed_by: 'classify-risk.ts', generated_at: new Date().toISOString(),
    bug_id: packet.bug.id,
    declared_level: packet.risk_claim.declared_level,
    diff_inferred: pathRisk.level,
    keyword_inferred: textRisk.level,
    final_risk: finalRisk,
    downgrade_blocked: true,
    changed_files_count: changedFiles.length,
    path_hits: pathRisk.hits,
    keyword_hits: textRisk.hits,
    cross_system_from_scope: systems.size >= 2,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/risk.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
