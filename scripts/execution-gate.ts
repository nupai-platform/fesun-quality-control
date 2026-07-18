/** Enforce retry, TTL, cost, API, concurrency, and cleanup-debt limits. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import { readJSON, readYAML, type GateResult } from './lib.ts';

const POLICY_SCHEMA = fileURLToPath(new URL('../schemas/execution-policy.schema.json', import.meta.url));
const DEFAULT_POLICY = fileURLToPath(new URL('../policies/execution-policy.yaml', import.meta.url));

interface ExecutionPolicy {
  safety: {
    max_retries: number;
    retry_cannot_turn_fail_into_pass: true;
    executing_ttl_minutes: number;
    evidence_ttl_minutes: number;
    final_verdict_timeout_minutes: number;
  };
  budget: { max_cost_usd: number; max_parallel_runs: number; max_api_calls: number };
  artifacts: { retention_days: number; access: 'restricted'; redact_keys: string[] };
  data_isolation: { cleanup_debt_hard_limit: number; run2_requires_fresh_uuid: true };
  state_machine: { success_path: string[]; terminal_states: string[]; failure_classifications: string[] };
}

export interface ExecutionState {
  state:
    | 'RECEIVED' | 'PRECHECKED' | 'RISK_CLASSIFIED' | 'IMPACT_ANALYZED'
    | 'TEST_IMPLEMENTED' | 'EXECUTING' | 'EVIDENCE_COLLECTED'
    | 'VERDICT_COMPUTED' | 'DONE' | 'FAIL' | 'BLOCKED' | 'PARTIAL' | 'MANUAL_REVIEW';
  state_entered_at: string;
  retry_count: number;
  cost_usd: number;
  api_calls: number;
  parallel_runs: number;
  cleanup_debt: number;
}

export function evaluateExecution(
  policy: ExecutionPolicy,
  state: ExecutionState,
  nowMs = Date.now(),
): GateResult {
  const reasons: string[] = [];
  if (state.retry_count > policy.safety.max_retries) {
    reasons.push(`retry_count ${state.retry_count} 超过 ${policy.safety.max_retries}`);
  }
  if (state.cost_usd > policy.budget.max_cost_usd) {
    reasons.push(`cost_usd ${state.cost_usd} 超过 ${policy.budget.max_cost_usd}`);
  }
  if (state.api_calls > policy.budget.max_api_calls) {
    reasons.push(`api_calls ${state.api_calls} 超过 ${policy.budget.max_api_calls}`);
  }
  if (state.parallel_runs > policy.budget.max_parallel_runs) {
    reasons.push(`parallel_runs ${state.parallel_runs} 超过 ${policy.budget.max_parallel_runs}`);
  }
  if (state.cleanup_debt > policy.data_isolation.cleanup_debt_hard_limit) {
    reasons.push(
      `cleanup_debt ${state.cleanup_debt} 超过 ${policy.data_isolation.cleanup_debt_hard_limit}`,
    );
  }

  const enteredAt = Date.parse(state.state_entered_at);
  if (!Number.isFinite(enteredAt) || enteredAt > nowMs) {
    reasons.push('state_entered_at 非法或位于未来');
  } else {
    const ageMinutes = (nowMs - enteredAt) / 60_000;
    if (state.state === 'EXECUTING' && ageMinutes > policy.safety.executing_ttl_minutes) {
      reasons.push(`EXECUTING TTL 超时 ${ageMinutes.toFixed(1)}m`);
    }
    if (state.state === 'EVIDENCE_COLLECTED' && ageMinutes > policy.safety.evidence_ttl_minutes) {
      reasons.push(`EVIDENCE_COLLECTED TTL 超时 ${ageMinutes.toFixed(1)}m`);
    }
    if (state.state === 'EVIDENCE_COLLECTED' && ageMinutes > policy.safety.final_verdict_timeout_minutes) {
      reasons.push(`final verdict TTL 超时 ${ageMinutes.toFixed(1)}m`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(): void {
  const policyPath = arg('--policy') ?? DEFAULT_POLICY;
  const statePath = arg('--state') ?? 'artifacts/execution-state.json';
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(readJSON<object>(POLICY_SCHEMA));
  const policy = readYAML<ExecutionPolicy>(policyPath);
  const reasons: string[] = [];
  if (!validate(policy)) reasons.push(`execution policy schema 非法: ${ajv.errorsText(validate.errors)}`);

  let result: GateResult = { ok: false, reasons: ['execution-state.json 缺失'] };
  try {
    const state = readJSON<ExecutionState>(statePath);
    result = evaluateExecution(policy, state);
  } catch (error) {
    reasons.push(`无法读取 execution state: ${(error as Error).message}`);
  }
  reasons.push(...result.reasons);
  const output = {
    computed_by: 'execution-gate.ts',
    generated_at: new Date().toISOString(),
    policy: policyPath,
    state: statePath,
    failure_classification: reasons.length ? 'ENVIRONMENT' : undefined,
    reasons,
    ok: reasons.length === 0,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/execution-gate.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
