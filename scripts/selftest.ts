/** End-to-end CLI selftest: one valid FAST run plus six fail-closed attack cases. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parseCandidateEvidence, sealCandidateEvidence } from '../reporters/playwright-evidence-reporter.ts';
import { validateProbeTarget } from './collect-oracle-evidence.ts';
import { readJSON, sha256, sha256File, stableStringify, type EvidenceEvent } from './lib.ts';

const root = process.cwd();
const packet = 'examples/store-STO-190-fast/bug-packet.yaml';
const testFile = 'examples/store-STO-190-fast/STO-190.spec.ts';
const mutationFile = '.qc-selftest-business-mutation.ts';
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const packetHash = sha256File(packet);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  QC_RUN_ID: 'selftest-run', GITHUB_REPOSITORY: 'owner/repo',
  QC_BASE_SHA: head, QC_HEAD_SHA: head, QC_SHA: head,
  QC_PACKET_SHA256: packetHash, QC_ENVIRONMENT_ID: 'store-staging',
};
let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`${condition ? '✓' : '✗'} ${name}`);
  if (!condition) failures += 1;
}

function run(script: string, args: string[] = []): { status: number; output: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: root, env, encoding: 'utf8',
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function passingReport(): unknown {
  return { suites: [{ specs: [{ title: 'STO-190', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }] }] };
}

function writeRuntimeArtifacts(event: EvidenceEvent): void {
  mkdirSync('artifacts/evidence-raw', { recursive: true });
  writeFileSync('artifacts/report.json', JSON.stringify(passingReport()));
  writeFileSync('artifacts/reporter-summary.json', JSON.stringify({
    generated_by: 'playwright-evidence-reporter.ts',
    tests: [{ test_id: 'STO-190', status: 'passed', errors: [], test_sha256: sha256File(testFile) }],
    errors: [],
  }));
  writeFileSync('artifacts/evidence-raw/fast.json', JSON.stringify(event));
  writeFileSync('artifacts/execution-state.json', JSON.stringify({
    state: 'EXECUTING', state_entered_at: new Date().toISOString(), retry_count: 0,
    cost_usd: 0, api_calls: 1, parallel_runs: 1, cleanup_debt: 0,
  }));
}

function seal(label: string): EvidenceEvent {
  return sealCandidateEvidence({
    assertion_id: 'order-detail-label', evidence_type: 'reload_state',
    system: 'nupai-store', record_id: 'order-detail-button', correlation_id: 'corr-selftest',
    raw_response: { label },
  }, testFile, env);
}

rmSync('artifacts', { recursive: true, force: true });
try {
  mkdirSync('artifacts', { recursive: true });
  check('runtime snapshot 可创建', run('scripts/detect-business-code-change.ts', [
    '--mode', 'runtime-snapshot', '--output', 'artifacts/worktree-before.json',
  ]).status === 0);
  writeFileSync(mutationFile, 'export const forbidden = true;');
  check('运行期业务代码 mutation 被拒绝', run('scripts/detect-business-code-change.ts', [
    '--mode', 'runtime-verify', '--snapshot', 'artifacts/worktree-before.json',
  ]).status !== 0);
  unlinkSync(mutationFile);
  check('清除 mutation 后 runtime gate 通过', run('scripts/detect-business-code-change.ts', [
    '--mode', 'runtime-verify', '--snapshot', 'artifacts/worktree-before.json',
  ]).status === 0);

  const goodEvent = seal('查看详情');
  writeRuntimeArtifacts(goodEvent);
  check('Packet schema/hash gate 通过', run('scripts/validate-packet.ts', ['--packet', packet]).status === 0);
  check('FAST 风险分类保持 FAST', run('scripts/classify-risk.ts', ['--packet', packet]).status === 0 && readJSON<any>('artifacts/risk.json').final_risk === 'FAST');
  check('弱断言扫描通过', run('scripts/detect-weak-assertions.ts', [testFile]).status === 0);
  check('执行预算/TTL gate 通过', run('scripts/execution-gate.ts').status === 0);
  check('证据完整性 gate 通过', run('scripts/evidence-gate.ts', ['--packet', packet]).status === 0);
  const validVerdict = run('scripts/verdict-gate.ts', ['--packet', packet]);
  check('真实完整链路产生 PASS', validVerdict.status === 0 && readJSON<any>('artifacts/verdict.json').merge_allowed === true);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  check('verdict 符合 schema', ajv.compile(readJSON<object>('schemas/verdict.schema.json'))(readJSON('artifacts/verdict.json')));

  const wrongOracle = seal('查看');
  writeFileSync('artifacts/evidence-raw/fast.json', JSON.stringify(wrongOracle));
  check('完整但错误的物证仍能通过 integrity gate', run('scripts/evidence-gate.ts', ['--packet', packet]).status === 0);
  check('错误业务值由唯一裁判拒绝', run('scripts/verdict-gate.ts', ['--packet', packet]).status !== 0);

  const wrongProvenance = structuredClone(goodEvent);
  wrongProvenance.provenance.head_sha = 'f'.repeat(40);
  const { event_id: oldId, ...withoutId } = wrongProvenance;
  void oldId;
  wrongProvenance.event_id = sha256(stableStringify(withoutId));
  writeFileSync('artifacts/evidence-raw/fast.json', JSON.stringify(wrongProvenance));
  check('错误 provenance 即使重算 event_id 仍被拒绝', run('scripts/evidence-gate.ts', ['--packet', packet]).status !== 0);

  writeFileSync('artifacts/evidence-raw/fast.json', JSON.stringify(goodEvent));
  run('scripts/evidence-gate.ts', ['--packet', packet]);
  writeFileSync('artifacts/report.json', JSON.stringify({ suites: [] }));
  check('0 tests 不得 PASS', run('scripts/verdict-gate.ts', ['--packet', packet]).status !== 0);

  check('测试 attachment 伪造 verdict 字段被拒绝', (() => {
    try {
      parseCandidateEvidence(Buffer.from(JSON.stringify({
        assertion_id: 'order-detail-label', evidence_type: 'reload_state', system: 'nupai-store',
        record_id: 'x', correlation_id: 'x', raw_response: {}, verdict: 'PASS',
      })));
      return false;
    } catch { return true; }
  })());
  check('production URL 即使在 allowlist 仍被拒绝', (() => {
    try { validateProbeTarget('https://store-production.example', ['store-production.example']); return false; }
    catch { return true; }
  })());
} finally {
  rmSync(join(root, 'artifacts'), { recursive: true, force: true });
  try { unlinkSync(join(root, mutationFile)); } catch { /* already removed */ }
}

if (failures) {
  console.error(`自测失败 ${failures} 项`);
  process.exit(1);
}
console.log('FESUN QC CLI 自测与攻击测试全部通过。');
