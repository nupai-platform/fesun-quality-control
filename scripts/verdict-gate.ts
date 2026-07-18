/** The sole merge adjudicator. PASS is impossible when any required fact or gate is absent. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { globSync } from 'glob';
import {
  assertionMatches,
  fileExists,
  readJSON,
  readYAML,
  sha256File,
  type BugPacket,
  type EvidenceEvent,
  type RiskLevel,
} from './lib.ts';

type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'PARTIAL';
const COUNTERFACTUAL_SCHEMA = fileURLToPath(new URL('../schemas/counterfactual.schema.json', import.meta.url));

export interface PlaywrightEvaluation {
  total: number;
  passed: number;
  failures: string[];
  flaky: boolean;
  ok: boolean;
}

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readJSONOrBlock<T>(path: string, blocked: string[]): T | undefined {
  try {
    const value = readJSON<T>(path);
    if (value === null || typeof value !== 'object') {
      blocked.push(`${path} 必须是 JSON 对象`);
      return undefined;
    }
    return value;
  } catch (error) {
    blocked.push(`${path} 无法解析: ${(error as Error).message}`);
    return undefined;
  }
}

export function evaluatePlaywrightReport(report: unknown): PlaywrightEvaluation {
  const tests: Array<{ title: string; status?: string; results?: Array<{ status?: string }> }> = [];
  const walk = (suites: any[]): void => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
        tests.push({ title: spec.title ?? '(untitled)', status: test.status, results: test.results });
      }
      walk(suite.suites ?? []);
    }
  };
  walk((report as { suites?: any[] })?.suites ?? []);
  const failures: string[] = [];
  let passed = 0;
  let flaky = false;
  for (const test of tests) {
    const results = test.results ?? [];
    const last = results.at(-1)?.status;
    const earlierFailure = results.slice(0, -1).some((result) => result.status !== 'passed');
    const declaredFlaky = test.status === 'flaky';
    if (earlierFailure || declaredFlaky) flaky = true;
    if (last === 'passed' && !earlierFailure && !declaredFlaky && test.status !== 'skipped') passed += 1;
    else failures.push(`${test.title}: ${test.status ?? last ?? 'unknown'}`);
  }
  return { total: tests.length, passed, failures, flaky, ok: tests.length > 0 && failures.length === 0 };
}

export function adjudicateAssertions(packet: BugPacket, events: EvidenceEvent[]): string[] {
  const reasons: string[] = [];
  for (const assertion of packet.expected_business_result.assertions) {
    const matching = events.filter((event) => event.assertion_id === assertion.id);
    const collectors = new Set(matching.map((event) => event.collector_kind));
    for (const collector of assertion.required_collectors) {
      const observations = matching.filter((event) => event.collector_kind === collector);
      if (!observations.length) {
        reasons.push(`${assertion.id}: 缺 ${collector} 证据`);
      } else if (!observations.every((event) => assertionMatches(assertion, event.raw_response))) {
        reasons.push(`${assertion.id}: ${collector} 原始响应与 Oracle 不匹配`);
      }
    }
    if (collectors.size < assertion.min_independent_sources) {
      reasons.push(`${assertion.id}: 独立证据源不足`);
    }
  }
  return reasons;
}

function gate(
  path: string,
  reasons: string[],
  blocked: string[],
): Record<string, any> | undefined {
  if (!fileExists(path)) { blocked.push(`缺必需门禁产物 ${path}`); return undefined; }
  try {
    const value = readJSON<Record<string, any>>(path);
    if (value.ok !== true) reasons.push(`${path} 未通过: ${(value.reasons ?? []).join('; ')}`);
    return value;
  } catch (error) {
    blocked.push(`${path} 无法解析: ${(error as Error).message}`);
    return undefined;
  }
}

function main(): void {
  const packetPath = arg('--packet');
  if (!packetPath) { console.error('缺 --packet'); process.exit(2); }
  const reasons: string[] = [];
  const blocked: string[] = [];
  const partialReasons: string[] = [];
  const checks: Record<string, boolean> = {};
  let packet: BugPacket | undefined;
  try {
    packet = readYAML<BugPacket>(packetPath);
    if (!packet || typeof packet !== 'object') blocked.push('Packet 为空或不是有效 YAML 对象');
  } catch (error) {
    blocked.push(`${packetPath} 无法解析: ${(error as Error).message}`);
  }
  if (!process.env.QC_SHA || !/^[0-9a-f]{40}$/.test(process.env.QC_SHA)) {
    blocked.push('缺完整 40 位可信 QC_SHA');
  }

  const packetValidation = gate('artifacts/packet-validation.json', reasons, blocked);
  const evidenceGate = gate('artifacts/evidence-gate.json', reasons, blocked);
  const executionGate = gate('artifacts/execution-gate.json', reasons, blocked);
  const mutationGate = gate('artifacts/business-code-change.json', reasons, blocked);
  const weakGate = gate('artifacts/weak-assertions.json', reasons, blocked);
  checks.packet_valid = packetValidation?.ok === true;
  checks.evidence_integrity = evidenceGate?.ok === true;
  checks.execution_policy = executionGate?.ok === true;
  checks.no_runtime_business_mutation = mutationGate?.ok === true;
  checks.no_weak_assertions = weakGate?.ok === true;
  if (mutationGate && mutationGate.mode !== 'runtime-verify') {
    reasons.push('business-code-change 必须来自 runtime-verify，而非 authoring diff');
    checks.no_runtime_business_mutation = false;
  }
  if (packetValidation?.packet_sha256 !== sha256File(packetPath)) {
    reasons.push('Packet 在 validation 后被修改');
    checks.packet_valid = false;
  }

  let profile: RiskLevel | undefined;
  let riskOutput: Record<string, any> = {};
  if (!fileExists('artifacts/risk.json')) blocked.push('缺 artifacts/risk.json');
  else {
    const parsedRisk = readJSONOrBlock<Record<string, any>>('artifacts/risk.json', blocked);
    if (parsedRisk) {
      riskOutput = parsedRisk;
      if (riskOutput.verdict === 'BLOCKED') blocked.push(riskOutput.reason ?? '风险事实源不足');
      else profile = riskOutput.final_risk as RiskLevel;
    }
  }
  if (!profile) profile = 'MANUAL_REVIEW';

  let currentRun: PlaywrightEvaluation = { total: 0, passed: 0, failures: ['缺 report'], flaky: false, ok: false };
  if (fileExists('artifacts/report.json')) {
    const report = readJSONOrBlock<Record<string, any>>('artifacts/report.json', blocked);
    if (report) currentRun = evaluatePlaywrightReport(report);
  }
  else blocked.push('缺 artifacts/report.json');
  if (!currentRun.ok) {
    if (currentRun.failures.length) reasons.push(...currentRun.failures.map((failure) => `测试未通过: ${failure}`));
    else reasons.push('Playwright report 测试数为 0');
  }
  if (currentRun.flaky) reasons.push('当前运行发生 retry 后通过，按 FLAKY 拒绝');
  checks.all_tests_passed = currentRun.ok && !currentRun.flaky;

  if (fileExists('artifacts/reporter-summary.json')) {
    const summary = readJSONOrBlock<{ tests?: Array<{ status?: string; errors?: string[] }> }>('artifacts/reporter-summary.json', blocked);
    if (summary && (!summary.tests?.length || summary.tests.some((test) => test.status !== 'passed' || test.errors?.length))) {
      reasons.push('Reporter 摘要存在非 passed、封装错误或 0 测试');
    }
  } else blocked.push('缺 artifacts/reporter-summary.json');

  const evidenceFiles = globSync([
    'artifacts/evidence-raw/*.json',
    'artifacts/evidence-trusted/*.json',
    'artifacts/evidence-contract/*.json',
  ], { nodir: true }).sort();
  const events = evidenceFiles.flatMap((file) => {
    const event = readJSONOrBlock<EvidenceEvent>(file, blocked);
    return event ? [event] : [];
  });
  const assertionReasons = packet?.expected_business_result?.assertions
    ? adjudicateAssertions(packet, events)
    : ['Packet 缺少 expected_business_result.assertions，无法进行 Oracle 复判'];
  reasons.push(...assertionReasons);
  checks.oracle_assertions_matched = assertionReasons.length === 0;

  if (profile !== 'FAST' && profile !== 'MANUAL_REVIEW') {
    for (const run of ['run-1', 'run-2']) {
      const path = `artifacts/${run}/report.json`;
      if (!fileExists(path)) blocked.push(`缺 ${path}`);
      else {
        const report = readJSONOrBlock<Record<string, any>>(path, blocked);
        if (report) {
          const evaluation = evaluatePlaywrightReport(report);
          if (!evaluation.ok || evaluation.flaky) reasons.push(`${run} 未稳定通过`);
          checks[`${run.replace('-', '_')}_passed`] = evaluation.ok && !evaluation.flaky;
        }
      }
    }
    const run1Records = new Set(events.map((event) => event.record_id));
    const run2EvidenceFiles = globSync('artifacts/run-2/evidence-raw/*.json', { nodir: true });
    const run2Events = run2EvidenceFiles.flatMap((file) => {
      const event = readJSONOrBlock<EvidenceEvent>(file, blocked);
      return event ? [event] : [];
    });
    const run2Records = new Set(run2Events.map((event) => event.record_id));
    checks.run_2_fresh_data = Boolean(packet?.test_data?.namespace) && run2Records.size > 0 &&
      [...run2Records].every((record) =>
        record.startsWith(`${packet?.test_data?.namespace}_`) && !run1Records.has(record));
    if (!checks.run_2_fresh_data) reasons.push('Run2 未证明使用全新 namespace/run UUID 测试数据');
  } else {
    checks.run_1_passed = checks.all_tests_passed;
    checks.run_2_passed = profile === 'FAST';
    checks.run_2_fresh_data = true;
  }

  const needsCounterfactual = profile === 'CRITICAL' || profile === 'CROSS_SYSTEM';
  checks.counterfactual_ok = !needsCounterfactual;
  if (needsCounterfactual) {
    if (!fileExists('artifacts/counterfactual.json')) blocked.push('缺 artifacts/counterfactual.json');
    else {
      const cf = readJSONOrBlock<Record<string, any>>('artifacts/counterfactual.json', blocked);
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      const validateCounterfactual = ajv.compile(readJSON<object>(COUNTERFACTUAL_SCHEMA));
      const summary = fileExists('artifacts/reporter-summary.json')
        ? readJSONOrBlock<{ tests?: Array<{ test_sha256?: string }> }>('artifacts/reporter-summary.json', blocked) ?? {} : {};
      const testHashes = new Set((summary.tests ?? []).map((test) => test.test_sha256));
      const expectedSignature = packet?.counterfactual?.expected_failure_signature;
      const structurallyValid = cf ? validateCounterfactual(cf) : false;
      const evidenceValid = structurallyValid &&
        cf?.baseline_failed === true && cf?.fixed_passed === true &&
        typeof cf?.test_sha256 === 'string' && testHashes.has(cf.test_sha256) &&
        typeof expectedSignature === 'string' && cf?.observed_failure_signature === expectedSignature;
      const migrationTouched = (riskOutput.path_hits ?? []).some((hit: string) =>
        hit.includes('migrations') || hit.includes('schema.prisma'));
      const allowedLevel = profile === 'CROSS_SYSTEM'
        ? cf?.level === 'CF-2'
        : cf?.level === 'CF-1' || cf?.level === 'CF-2';
      checks.counterfactual_ok = evidenceValid && allowedLevel && !(migrationTouched && cf?.level === 'CF-1');
      if (evidenceValid && cf?.level === 'CF-3') {
        checks.counterfactual_ok = false;
        partialReasons.push('反事实仅达到 CF-3，按冻结政策最高 PARTIAL');
      } else if (!checks.counterfactual_ok) {
        reasons.push(`反事实无效: ${structurallyValid ? 'test hash/失败签名/级别不匹配' : ajv.errorsText(validateCounterfactual.errors)}`);
      }
    }
  }

  checks.no_orphan_integrations = profile !== 'CROSS_SYSTEM';
  if (profile === 'CROSS_SYSTEM') {
    const orphan = gate('artifacts/orphan-integrations.json', reasons, blocked);
    checks.no_orphan_integrations = orphan?.ok === true;
  }

  let verdict: Verdict;
  let classification: string | undefined;
  if (blocked.length) {
    verdict = 'BLOCKED';
    classification = 'MISSING_FACT_SOURCE';
  } else if (reasons.length) {
    verdict = 'FAIL';
    classification = !checks.no_runtime_business_mutation
      ? 'TEST_WORKER_MODIFIED_BUSINESS_CODE'
      : !checks.no_weak_assertions
        ? 'WEAK_ASSERTION'
        : currentRun.flaky || reasons.some((reason) => reason.includes('run-2'))
          ? 'FLAKY'
          : !checks.evidence_integrity || !checks.oracle_assertions_matched
            ? 'INSUFFICIENT_EVIDENCE'
            : 'PRODUCT_BUG';
  } else if (partialReasons.length) {
    verdict = 'PARTIAL';
    classification = 'INSUFFICIENT_EVIDENCE';
  } else {
    verdict = 'PASS';
  }
  const output = {
    schema_version: 1.1,
    computed_by: 'verdict-gate.ts',
    generated_at: new Date().toISOString(),
    verdict,
    merge_allowed: verdict === 'PASS',
    bug_id: packet?.bug?.id ?? 'UNKNOWN',
    profile,
    checks,
    test_summary: currentRun,
    evidence_count: events.length,
    packet_sha256: sha256File(packetPath),
    qc_sha: process.env.QC_SHA,
    failure_classification: classification,
    reasons,
    partial_reasons: partialReasons,
    blocked_reasons: blocked,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/verdict.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  process.exit(verdict === 'PASS' ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
