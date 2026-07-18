/** Validate evidence integrity, provenance, source independence, and Oracle coverage. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { globSync } from 'glob';
import {
  readJSON,
  readYAML,
  sha256,
  sha256File,
  stableStringify,
  type BugPacket,
  type EvidenceEvent,
  type GateResult,
} from './lib.ts';

const SCHEMA = fileURLToPath(new URL('../schemas/evidence-event.schema.json', import.meta.url));

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function evaluateEvidence(
  packet: BugPacket,
  packetPath: string,
  files: string[],
  env: NodeJS.ProcessEnv = process.env,
): GateResult & { evidence_count: number } {
  const reasons: string[] = [];
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readJSON<object>(SCHEMA));
  const packetHash = sha256File(packetPath);
  const expectedProvenance: Record<string, string | undefined> = {
    run_id: env.QC_RUN_ID,
    repo: env.GITHUB_REPOSITORY,
    base_sha: env.QC_BASE_SHA,
    head_sha: env.QC_HEAD_SHA,
    qc_sha: env.QC_SHA,
    packet_sha256: packetHash,
    environment_id: packet.environment.expected_environment_id,
  };
  for (const [key, value] of Object.entries(expectedProvenance)) {
    if (!value) reasons.push(`缺可信期望来源环境变量: ${key}`);
  }

  const events: EvidenceEvent[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    let event: EvidenceEvent;
    try { event = readJSON<EvidenceEvent>(file); }
    catch (error) { reasons.push(`${file}: JSON 无法解析: ${(error as Error).message}`); continue; }
    if (!validate(event)) {
      reasons.push(`${file}: schema 不合法: ${ajv.errorsText(validate.errors)}`);
      continue;
    }
    if (ids.has(event.event_id)) reasons.push(`${file}: 重复 event_id`);
    ids.add(event.event_id);
    if (sha256(stableStringify(event.raw_response)) !== event.raw_response_sha256) {
      reasons.push(`${file}: raw_response_sha256 不匹配`);
    }
    const { event_id: eventId, ...withoutId } = event;
    void eventId;
    if (sha256(stableStringify(withoutId)) !== event.event_id) reasons.push(`${file}: event_id 不匹配`);
    for (const [key, expected] of Object.entries(expectedProvenance)) {
      if (expected && event.provenance[key as keyof EvidenceEvent['provenance']] !== expected) {
        reasons.push(`${file}: provenance.${key} 与可信运行上下文不匹配`);
      }
    }
    if (event.collector_kind === 'trusted_http_probe' && event.request?.method !== 'GET') {
      reasons.push(`${file}: trusted_http_probe 只能是 GET`);
    }
    if (
      packet.risk_claim.declared_level !== 'FAST' &&
      !event.record_id.startsWith(`${packet.test_data.namespace}_`)
    ) {
      reasons.push(`${file}: record_id 未使用 Packet namespace ${packet.test_data.namespace}`);
    }
    events.push(event);
  }

  for (const assertion of packet.expected_business_result.assertions) {
    const matching = events.filter((event) => event.assertion_id === assertion.id);
    const collectors = new Set(matching.map((event) => event.collector_kind));
    for (const required of assertion.required_collectors) {
      if (!collectors.has(required)) reasons.push(`${assertion.id}: 缺 required collector ${required}`);
    }
    if (collectors.size < assertion.min_independent_sources) {
      reasons.push(`${assertion.id}: 独立证据源 ${collectors.size} < ${assertion.min_independent_sources}`);
    }
    const records = new Set(matching.map((event) => event.record_id));
    const correlations = new Set(matching.map((event) => event.provenance.correlation_id));
    if (records.size > 1) reasons.push(`${assertion.id}: 证据 record_id 不一致`);
    if (correlations.size > 1) reasons.push(`${assertion.id}: 证据 correlation_id 不一致`);
  }
  const knownAssertions = new Set(packet.expected_business_result.assertions.map((assertion) => assertion.id));
  for (const event of events) {
    if (!knownAssertions.has(event.assertion_id)) reasons.push(`未知 assertion_id: ${event.assertion_id}`);
  }
  return { ok: reasons.length === 0, reasons, evidence_count: events.length };
}

function main(): void {
  const packetPath = arg('--packet');
  const reasons: string[] = [];
  if (!packetPath) reasons.push('缺 --packet');
  for (const required of [
    'artifacts/report.json',
    'artifacts/reporter-summary.json',
    'artifacts/packet-validation.json',
  ]) {
    if (!globSync(required, { nodir: true }).length) reasons.push(`缺必需产物: ${required}`);
  }

  if (globSync('artifacts/reporter-summary.json', { nodir: true }).length) {
    const summary = readJSON<{ tests?: unknown[]; errors?: string[] }>('artifacts/reporter-summary.json');
    if (!summary.tests?.length) reasons.push('reporter-summary 测试数为 0');
    if (summary.errors?.length) reasons.push(...summary.errors.map((error) => `reporter: ${error}`));
  }
  if (packetPath && globSync('artifacts/packet-validation.json', { nodir: true }).length) {
    const validation = readJSON<{ ok?: boolean; packet_sha256?: string }>('artifacts/packet-validation.json');
    if (validation.ok !== true) reasons.push('packet-validation 未通过');
    if (validation.packet_sha256 !== sha256File(packetPath)) reasons.push('packet-validation 对应的 Packet 已变化');
  }

  const files = globSync([
    'artifacts/evidence-raw/*.json',
    'artifacts/evidence-trusted/*.json',
    'artifacts/evidence-contract/*.json',
  ], { nodir: true }).sort();
  let checked = { ok: false, reasons: ['无法执行证据校验'], evidence_count: 0 };
  if (packetPath) {
    try { checked = evaluateEvidence(readYAML<BugPacket>(packetPath), packetPath, files); }
    catch (error) { checked = { ok: false, reasons: [(error as Error).message], evidence_count: 0 }; }
  }
  reasons.push(...checked.reasons);
  const output = {
    computed_by: 'evidence-gate.ts',
    generated_at: new Date().toISOString(),
    packet: packetPath,
    evidence_count: checked.evidence_count,
    evidence_files: files,
    reasons,
    ok: reasons.length === 0,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/evidence-gate.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
