import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateExecution, type ExecutionState } from '../scripts/execution-gate.ts';

const policy = {
  safety: { max_retries: 2, retry_cannot_turn_fail_into_pass: true as const, executing_ttl_minutes: 30, evidence_ttl_minutes: 15, final_verdict_timeout_minutes: 45 },
  budget: { max_cost_usd: 2, max_parallel_runs: 1, max_api_calls: 200 },
  artifacts: { retention_days: 14, access: 'restricted' as const, redact_keys: ['token'] },
  data_isolation: { cleanup_debt_hard_limit: 100, run2_requires_fresh_uuid: true as const },
  state_machine: { success_path: [], terminal_states: [], failure_classifications: [] },
};

test('execution policy accepts a bounded fresh run', () => {
  const state: ExecutionState = {
    state: 'EXECUTING', state_entered_at: new Date(1_000_000).toISOString(),
    retry_count: 1, cost_usd: 1, api_calls: 10, parallel_runs: 1, cleanup_debt: 0,
  };
  assert.deepEqual(evaluateExecution(policy, state, 1_000_000 + 10 * 60_000), { ok: true, reasons: [] });
});

test('execution policy trips retry, budget, concurrency, debt and TTL breakers', () => {
  const state: ExecutionState = {
    state: 'EXECUTING', state_entered_at: new Date(1_000_000).toISOString(),
    retry_count: 3, cost_usd: 3, api_calls: 201, parallel_runs: 2, cleanup_debt: 101,
  };
  const result = evaluateExecution(policy, state, 1_000_000 + 31 * 60_000);
  assert.equal(result.ok, false);
  assert.equal(result.reasons.length, 6);
});

test('execution policy rejects future timestamps', () => {
  const state: ExecutionState = {
    state: 'EVIDENCE_COLLECTED', state_entered_at: new Date(2_000_000).toISOString(),
    retry_count: 0, cost_usd: 0, api_calls: 0, parallel_runs: 0, cleanup_debt: 0,
  };
  assert.match(evaluateExecution(policy, state, 1_000_000).reasons[0], /未来/);
});
