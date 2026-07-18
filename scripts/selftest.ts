/**
 * selftest.ts v1.1
 *
 * 不启动浏览器,合成产物证明 verdict-gate 的"物证反推"确实生效:
 *   场景 A(正确证据):后端 status=completed → 期望 PASS
 *   场景 B(错误证据):后端 status=pending   → 期望 FAIL(PRODUCT_BUG)
 *   场景 C(伪造判定):证据里塞 backend_verified:true → evidence-gate 期望拒绝
 *
 * 这是 Day 0 "让机器闸门先跑通"的自证。退出码非 0 表示自测未达预期。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';

const ROOT = process.cwd();
const PACKET = 'examples/store-STO-186/bug-packet.yaml';

function reset(): void {
  rmSync('artifacts', { recursive: true, force: true });
  mkdirSync('artifacts/evidence-raw', { recursive: true });
  mkdirSync('artifacts/run-2', { recursive: true });
}

function passingReport(): unknown {
  return {
    suites: [
      { specs: [{ tests: [{ results: [{ status: 'passed' }] }] }] },
    ],
  };
}

function writeReports(): void {
  writeFileSync('artifacts/report.json', JSON.stringify(passingReport()));
  writeFileSync('artifacts/run-2/report.json', JSON.stringify(passingReport()));
  writeFileSync(
    'artifacts/reporter-summary.json',
    JSON.stringify({ generated_by: 'playwright-evidence-reporter.ts', tests: [] }),
  );
  // 静态闸门产物:全部 ok
  writeFileSync('artifacts/business-code-change.json', JSON.stringify({ ok: true }));
  writeFileSync('artifacts/weak-assertions.json', JSON.stringify({ ok: true, violations: [] }));
  writeFileSync(
    'artifacts/counterfactual.json',
    JSON.stringify({ level: 'CF-2', old_test_failed_as_expected: true, reason_code: 'cross_system' }),
  );
}

function writeEvidence(status: string): void {
  const ev = (field: string, val: unknown) => ({
    evidence_type: field === 'duplicate_task_count' ? 'duplicate_count' : 'backend_query',
    system: 'nupai-store',
    record_id: 'e2e_STO_186_selftest',
    asserted_field: field,
    expected_from_packet: val,
    raw_response: { [field]: val },
  });
  writeFileSync('artifacts/evidence-raw/a.json', JSON.stringify(ev('status', status)));
  writeFileSync('artifacts/evidence-raw/b.json', JSON.stringify(ev('duplicate_task_count', 0)));
}

function runClassify(): void {
  try {
    execSync(`node --import tsx scripts/classify-risk.ts --packet ${PACKET}`, {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } catch {
    // classify 对缺 base/head 不报错;risk.json 已生成
  }
}

function runVerdict(): { code: number; out: string } {
  try {
    const out = execSync(`node --import tsx scripts/verdict-gate.ts --packet ${PACKET}`, {
      cwd: ROOT,
      stdio: 'pipe',
    }).toString();
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '') };
  }
}

function readVerdict(): any {
  return JSON.parse(readFileSync('artifacts/verdict.json', 'utf8'));
}

function runEvidenceGate(profile: string): number {
  try {
    execSync(`node --import tsx scripts/evidence-gate.ts --profile ${profile}`, {
      cwd: ROOT,
      stdio: 'pipe',
    });
    return 0;
  } catch (e: any) {
    return e.status ?? 1;
  }
}

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failures++;
  }
}

console.log('=== FESUN QC 自测 v1.1 ===');

// 场景 A:正确证据 → PASS
reset();
runClassify();
writeReports();
writeEvidence('completed');
{
  const { code } = runVerdict();
  const v = readVerdict();
  console.log('场景 A(正确后端字段):');
  check('verdict = PASS', v.verdict === 'PASS');
  check('merge_allowed = true', v.merge_allowed === true);
  check('退出码 0', code === 0);
  check('profile 升级为 CROSS_SYSTEM(双系统契约)', v.profile === 'CROSS_SYSTEM');
}

// 场景 B:错误证据 → FAIL
reset();
runClassify();
writeReports();
writeEvidence('pending');
{
  const { code } = runVerdict();
  const v = readVerdict();
  console.log('场景 B(后端字段错误 pending):');
  check('verdict = FAIL', v.verdict === 'FAIL');
  check('merge_allowed = false', v.merge_allowed === false);
  check('分类 = PRODUCT_BUG', v.failure_classification === 'PRODUCT_BUG');
  check('退出码非 0', code !== 0);
  check('reasons 提到 status 不匹配', JSON.stringify(v.reasons).includes('status'));
}

// 场景 C:伪造判定字段 → evidence-gate 拒绝
reset();
runClassify();
writeReports();
writeEvidence('completed');
writeFileSync(
  'artifacts/evidence-raw/forged.json',
  JSON.stringify({
    evidence_type: 'backend_query',
    record_id: 'x',
    raw_response: { status: 'completed' },
    backend_verified: true, // 伪造判定字段
  }),
);
{
  const code = runEvidenceGate('CROSS_SYSTEM');
  console.log('场景 C(证据含伪造 backend_verified):');
  check('evidence-gate 退出码非 0(拒绝)', code !== 0);
  const eg = JSON.parse(readFileSync('artifacts/evidence-gate.json', 'utf8'));
  check('原因提到 backend_verified', JSON.stringify(eg.reasons).includes('backend_verified'));
}

console.log('');
if (failures === 0) {
  console.log('✅ 自测全部通过:机器闸门"物证反推"生效。');
  if (existsSync('artifacts')) rmSync('artifacts', { recursive: true, force: true });
  process.exit(0);
} else {
  console.error(`❌ 自测失败 ${failures} 项。`);
  process.exit(1);
}
