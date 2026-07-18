import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { evaluateEvidence } from '../scripts/evidence-gate.ts';
import {
  readYAML, sha256, sha256File, stableStringify, type BugPacket, type EvidenceEvent,
} from '../scripts/lib.ts';
import { adjudicateAssertions, evaluatePlaywrightReport } from '../scripts/verdict-gate.ts';

const temporary = mkdtempSync(join(tmpdir(), 'fesun-evidence-'));
after(() => rmSync(temporary, { recursive: true, force: true }));
const packetPath = 'examples/store-STO-186/bug-packet.yaml';
const packet = readYAML<BugPacket>(packetPath);
const env = {
  QC_RUN_ID: 'run-1', GITHUB_REPOSITORY: 'owner/repo', QC_BASE_SHA: 'a'.repeat(40),
  QC_HEAD_SHA: 'b'.repeat(40), QC_SHA: 'c'.repeat(40),
};

function event(assertionId: string, collector: EvidenceEvent['collector_kind'], raw: unknown): EvidenceEvent {
  const withoutId: Omit<EvidenceEvent, 'event_id'> = {
    schema_version: 1.1, assertion_id: assertionId, evidence_type: 'backend_query',
    collector_kind: collector, system: 'nupai-store', record_id: 'e2e_STO_186_run-1_uuid',
    captured_at: '2026-07-18T00:00:00.000Z',
    ...(collector === 'trusted_http_probe'
      ? { request: { url: 'https://store-staging.example/api/tasks/task-123', method: 'GET', status: 200 } } : {}),
    raw_response: raw, raw_response_sha256: sha256(stableStringify(raw)),
    provenance: {
      run_id: env.QC_RUN_ID, repo: env.GITHUB_REPOSITORY, base_sha: env.QC_BASE_SHA,
      head_sha: env.QC_HEAD_SHA, qc_sha: env.QC_SHA, packet_sha256: sha256File(packetPath),
      test_sha256: 'd'.repeat(64), environment_id: 'store-staging', correlation_id: 'corr-123',
    },
  };
  return { ...withoutId, event_id: sha256(stableStringify(withoutId)) };
}

test('evidence gate validates independent sources, hashes and provenance', () => {
  const events = [
    event('measurement-status', 'playwright_attachment', { status: 'completed' }),
    event('measurement-status', 'trusted_http_probe', { status: 'completed' }),
    event('duplicate-task-count', 'playwright_attachment', { duplicate_task_count: 0 }),
    event('duplicate-task-count', 'trusted_http_probe', { duplicate_task_count: 0 }),
  ];
  const files = events.map((value, index) => {
    const path = join(temporary, `${index}.json`);
    writeFileSync(path, JSON.stringify(value));
    return path;
  });
  assert.deepEqual(evaluateEvidence(packet, packetPath, files, env), {
    ok: true, reasons: [], evidence_count: 4,
  });
  assert.deepEqual(adjudicateAssertions(packet, events), []);
});

test('tampered raw response, wrong provenance and strict type mismatch are rejected', () => {
  const value = event('measurement-status', 'trusted_http_probe', { status: 'completed' });
  value.raw_response = { status: 'pending' };
  value.provenance.packet_sha256 = '0'.repeat(64);
  const path = join(temporary, 'tampered.json');
  writeFileSync(path, JSON.stringify(value));
  const result = evaluateEvidence(packet, packetPath, [path], env);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /raw_response_sha256|packet_sha256|event_id/);
  const typed = event('duplicate-task-count', 'playwright_attachment', { duplicate_task_count: '0' });
  assert.match(adjudicateAssertions(packet, [typed]).join(' '), /不匹配/);
});

test('Playwright report rejects zero tests, skips and retry-then-pass', () => {
  assert.equal(evaluatePlaywrightReport({ suites: [] }).ok, false);
  const pass = { suites: [{ specs: [{ title: 'ok', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }] }] };
  assert.equal(evaluatePlaywrightReport(pass).ok, true);
  const flaky = { suites: [{ specs: [{ title: 'retry', tests: [{ status: 'flaky', results: [{ status: 'failed' }, { status: 'passed' }] }] }] }] };
  assert.equal(evaluatePlaywrightReport(flaky).flaky, true);
});
