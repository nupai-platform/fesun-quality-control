/**
 * verdict-gate.ts v1.1  —— 唯一裁判(P0-1 核心)
 *
 * 从不可伪造产物独立复判,产出 artifacts/verdict.json。
 * AI 不得写入本文件的任何输出。GitHub Required Check 只读 verdict.json.merge_allowed。
 *
 * 输入产物(全部机器生成):
 *   artifacts/report.json                  Playwright 官方 JSON reporter
 *   artifacts/reporter-summary.json         evidence reporter 摘要(含 run 状态)
 *   artifacts/evidence-raw/*.json           后端原始响应体
 *   artifacts/weak-assertions.json          弱断言扫描结果
 *   artifacts/business-code-change.json     业务代码修改检查
 *   artifacts/risk.json                     风险分级
 *   artifacts/counterfactual.json (可选)    反事实结果
 *   artifacts/orphan-integrations.json (可选) 孤儿集成检查
 *   bug-packet.yaml (--packet)              期望值来源(唯一真相)
 *
 * 复判逻辑:任何一项不满足 → 非 PASS。AI 声明的布尔字段一律忽略。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { globSync } from 'glob';
import {
  readJSON,
  readYAML,
  fileExists,
  getByPath,
  type RiskLevel,
} from './lib.ts';

function arg(flag: string): string | undefined {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 ? a[i + 1] : undefined;
}

interface Checks {
  all_tests_passed: boolean;
  backend_assertions_matched: boolean;
  no_business_code_change: boolean;
  no_weak_assertions: boolean;
  run_1_passed: boolean;
  run_2_passed: boolean;
  counterfactual_ok: boolean;
  no_orphan_integrations: boolean;
}

function main(): void {
  const packetPath = arg('--packet');
  if (!packetPath) {
    console.error('缺少 --packet');
    process.exit(2);
  }
  const packet = readYAML<any>(packetPath);
  const bugId: string = packet?.bug?.id ?? 'UNKNOWN';

  const reasons: string[] = [];
  const unverified: string[] = [];

  // 风险等级(来自 classify-risk 的机器输出)
  let profile: RiskLevel = 'FAST';
  if (fileExists('artifacts/risk.json')) {
    const risk = readJSON<any>('artifacts/risk.json');
    if (risk.verdict === 'BLOCKED') {
      emit({
        verdict: 'BLOCKED',
        merge_allowed: false,
        bug_id: bugId,
        profile: 'MANUAL_REVIEW',
        failure_classification: 'MISSING_FACT_SOURCE',
        reasons: [risk.reason ?? '缺事实源'],
      });
      return;
    }
    profile = risk.final_risk ?? 'FAST';
  } else {
    unverified.push('risk.json 缺失,默认按 STANDARD 复判');
    profile = 'STANDARD';
  }

  // 1. Playwright 官方结果:所有测试 passed
  let allTestsPassed = false;
  if (fileExists('artifacts/report.json')) {
    const report = readJSON<any>('artifacts/report.json');
    allTestsPassed = evaluatePlaywrightReport(report);
    if (!allTestsPassed) reasons.push('存在未通过的测试(report.json)');
  } else {
    reasons.push('缺 artifacts/report.json,无法确认测试结果');
  }

  // 2. 后端原始响应体独立复判 —— 对照 bug-packet 的 assertions
  const backendMatched = adjudicateBackend(packet, reasons);

  // 3. 业务代码零修改
  let noBizChange = true;
  if (fileExists('artifacts/business-code-change.json')) {
    const bcc = readJSON<any>('artifacts/business-code-change.json');
    noBizChange = bcc.ok === true;
    if (!noBizChange) reasons.push('测试任务修改了业务代码');
  } else {
    unverified.push('business-code-change.json 缺失');
  }

  // 4. 弱断言
  let noWeak = true;
  if (fileExists('artifacts/weak-assertions.json')) {
    const wa = readJSON<any>('artifacts/weak-assertions.json');
    noWeak = wa.ok === true;
    if (!noWeak) reasons.push(`弱断言违规 ${wa.violations?.length ?? '?'} 处`);
  } else {
    unverified.push('weak-assertions.json 缺失');
  }

  // 5. 连续两次运行(STANDARD 及以上)
  let run1 = false;
  let run2 = false;
  if (profile === 'FAST') {
    run1 = allTestsPassed;
    run2 = true; // FAST 不要求两次
  } else {
    run1 = fileExists('artifacts/run-1/report.json')
      ? evaluatePlaywrightReport(readJSON('artifacts/run-1/report.json'))
      : allTestsPassed;
    if (fileExists('artifacts/run-2/report.json')) {
      run2 = evaluatePlaywrightReport(readJSON('artifacts/run-2/report.json'));
    } else {
      run2 = false;
      reasons.push(`${profile} 要求连续两次独立运行,缺 run-2/report.json`);
    }
    if (run1 && !run2) reasons.push('第二次运行未通过或缺失 → 不得 PASS(可能 FLAKY)');
  }

  // 6. 反事实(CRITICAL / CROSS_SYSTEM)
  let cfOk = true;
  if (profile === 'CRITICAL' || profile === 'CROSS_SYSTEM') {
    if (fileExists('artifacts/counterfactual.json')) {
      const cf = readJSON<any>('artifacts/counterfactual.json');
      // CF-1/CF-2: 旧逻辑必须 FAIL(即 old_test_failed_as_expected=true)
      cfOk = cf.old_test_failed_as_expected === true;
      if (!cfOk && cf.level === 'CF-3') {
        // CF-3 最高 PARTIAL(除非 owner 签字)
        unverified.push('反事实仅 CF-3(证据回放),最高 PARTIAL');
      } else if (!cfOk) {
        reasons.push('反事实未证明旧逻辑会失败(测试可能识别不了旧错误)');
      }
    } else {
      cfOk = false;
      unverified.push(`${profile} 要求反事实验证,缺 counterfactual.json`);
    }
  }

  // 7. 孤儿集成(有该产物时才判)
  let noOrphan = true;
  if (fileExists('artifacts/orphan-integrations.json')) {
    const orphan = readJSON<any>('artifacts/orphan-integrations.json');
    noOrphan = orphan.ok === true;
    if (!noOrphan) reasons.push('存在未登记的跨系统集成点(UNMAPPED_INTEGRATION)');
  }

  const checks: Checks = {
    all_tests_passed: allTestsPassed,
    backend_assertions_matched: backendMatched,
    no_business_code_change: noBizChange,
    no_weak_assertions: noWeak,
    run_1_passed: run1,
    run_2_passed: run2,
    counterfactual_ok: cfOk,
    no_orphan_integrations: noOrphan,
  };

  // ---- 最终裁定 ----
  let verdict: 'PASS' | 'FAIL' | 'BLOCKED' | 'PARTIAL';
  let classification: string | undefined;

  const hardFail =
    !allTestsPassed ||
    !backendMatched ||
    !noBizChange ||
    !noWeak ||
    !noOrphan ||
    (profile !== 'FAST' && !run2) ||
    ((profile === 'CRITICAL' || profile === 'CROSS_SYSTEM') && !cfOk && !hasCF3(profile));

  if (!noBizChange) {
    verdict = 'FAIL';
    classification = 'TEST_WORKER_MODIFIED_BUSINESS_CODE';
  } else if (!noWeak) {
    verdict = 'FAIL';
    classification = 'WEAK_ASSERTION';
  } else if (!noOrphan) {
    verdict = 'FAIL';
    classification = 'UNMAPPED_INTEGRATION';
  } else if (!allTestsPassed || !backendMatched) {
    verdict = 'FAIL';
    classification = 'PRODUCT_BUG';
  } else if (profile !== 'FAST' && run1 && !run2) {
    verdict = 'FAIL';
    classification = 'FLAKY';
  } else if (unverified.length > 0 && !hardFail) {
    verdict = 'PARTIAL';
    classification = 'INSUFFICIENT_EVIDENCE';
  } else if (hardFail) {
    verdict = 'FAIL';
    classification = classification ?? 'PRODUCT_BUG';
  } else {
    verdict = 'PASS';
  }

  emit({
    verdict,
    merge_allowed: verdict === 'PASS',
    bug_id: bugId,
    profile,
    checks,
    failure_classification: verdict === 'PASS' ? undefined : classification,
    reasons,
    unverified_core_items: unverified,
    artifacts: {
      report: 'artifacts/report.json',
      risk: 'artifacts/risk.json',
    },
  });
}

function hasCF3(_profile: RiskLevel): boolean {
  if (!fileExists('artifacts/counterfactual.json')) return false;
  const cf = readJSON<any>('artifacts/counterfactual.json');
  return cf.level === 'CF-3';
}

/** 递归判断 Playwright JSON reporter 全部 passed */
function evaluatePlaywrightReport(report: any): boolean {
  const statuses: string[] = [];
  const walk = (suites: any[]): void => {
    for (const s of suites ?? []) {
      for (const spec of s.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const last = t.results?.[t.results.length - 1];
          statuses.push(last?.status ?? t.status ?? 'unknown');
        }
      }
      if (s.suites) walk(s.suites);
    }
  };
  walk(report.suites ?? []);
  if (statuses.length === 0) return false;
  return statuses.every((s) => s === 'passed' || s === 'expected');
}

/** 后端原始响应体独立复判:evidence-raw 中 asserted_field 的实际值 === packet 期望值 */
function adjudicateBackend(packet: any, reasons: string[]): boolean {
  const assertions: Record<string, unknown> | undefined =
    packet?.expected_business_result?.assertions;

  if (!assertions) {
    // FAST 级允许无后端断言
    return true;
  }

  const files = globSync('artifacts/evidence-raw/*.json', { nodir: true });
  if (files.length === 0) {
    reasons.push('有 expected_business_result 但无任何 evidence-raw 原始证据');
    return false;
  }

  const matchedFields = new Set<string>();
  for (const file of files) {
    let ev: any;
    try {
      ev = readJSON(file);
    } catch {
      reasons.push(`evidence 文件无法解析: ${file}`);
      return false;
    }
    const field = ev.asserted_field;
    if (!field || !(field in assertions)) continue;
    const expected = assertions[field];
    const actual = getByPath(ev.raw_response, field.split('.').slice(-1)[0]) ?? getByPath(ev.raw_response, field);
    if (String(actual) !== String(expected)) {
      reasons.push(
        `后端字段 ${field}: 期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)}`,
      );
      return false;
    }
    matchedFields.add(field);
  }

  // packet 中声明的每个断言都必须被至少一条原始证据覆盖
  for (const field of Object.keys(assertions)) {
    if (!matchedFields.has(field)) {
      reasons.push(`期望断言 ${field} 无对应原始证据(未验证)`);
      return false;
    }
  }
  return true;
}

function emit(v: Record<string, unknown>): void {
  const full = {
    computed_by: 'verdict-gate.ts',
    generated_at: new Date().toISOString(),
    ...v,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/verdict.json', JSON.stringify(full, null, 2));
  console.log(JSON.stringify(full, null, 2));
  // 退出码:PASS=0,其余非0(供 CI final-verdict 判定)
  process.exit(v.verdict === 'PASS' ? 0 : 1);
}

main();
