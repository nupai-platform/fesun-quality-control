import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parseCandidateEvidence, sealCandidateEvidence } from '../reporters/playwright-evidence-reporter.ts';
import { collectOracleEvidence, validateProbeTarget } from '../scripts/collect-oracle-evidence.ts';
import { readYAML, sha256File, type BugPacket } from '../scripts/lib.ts';
import { runCounterfactual } from '../scripts/run-counterfactual.ts';

const temporary = mkdtempSync(join(tmpdir(), 'fesun-reporter-'));
const testFile = join(temporary, 'sample.spec.ts');
writeFileSync(testFile, 'expect(value).toBe(1);');
after(() => rmSync(temporary, { recursive: true, force: true }));
const env = {
  QC_RUN_ID: 'run-1', GITHUB_REPOSITORY: 'owner/repo', QC_BASE_SHA: 'a'.repeat(40),
  QC_HEAD_SHA: 'b'.repeat(40), QC_SHA: 'c'.repeat(40), QC_PACKET_SHA256: 'd'.repeat(64),
  QC_ENVIRONMENT_ID: 'store-staging',
};

test('reporter rejects candidate-authored trust fields', () => {
  assert.throws(() => parseCandidateEvidence(Buffer.from(JSON.stringify({
    assertion_id: 'status', evidence_type: 'backend_query', system: 'nupai-store',
    record_id: 'task-1', correlation_id: 'corr-1', raw_response: {}, verdict: 'PASS',
  }))), /禁止或未知字段/);
});

test('reporter seals hashes/provenance and redacts secrets', () => {
  const candidate = parseCandidateEvidence(Buffer.from(JSON.stringify({
    assertion_id: 'status', evidence_type: 'backend_query', system: 'nupai-store',
    record_id: 'task-1', correlation_id: 'corr-1', raw_response: { token: 'secret', status: 'completed' },
  })));
  const event = sealCandidateEvidence(candidate, testFile, env);
  assert.equal(event.collector_kind, 'playwright_attachment');
  assert.equal((event.raw_response as any).token, '[REDACTED]');
  assert.equal(event.event_id.length, 64);
  assert.equal(event.provenance.qc_sha, env.QC_SHA);
});

test('trusted probe target blocks production and non-allowlisted hosts', () => {
  assert.equal(validateProbeTarget('https://store-staging.example', ['store-staging.example']).hostname, 'store-staging.example');
  assert.throws(() => validateProbeTarget('https://store-prod.example', ['store-prod.example']), /production host/);
  assert.throws(() => validateProbeTarget('https://evil.example', ['store-staging.example']), /allowlist/);
});

test('trusted Oracle collector performs GET, checks environment, and seals independent evidence', async () => {
  const packetPath = 'examples/store-STO-186/bug-packet.yaml';
  const packet = readYAML<BugPacket>(packetPath);
  const standardTest = 'examples/store-STO-186/STO-186.spec.ts';
  const oracleEnv = {
    ...env,
    QC_PACKET_SHA256: sha256File(packetPath), QC_ENVIRONMENT_ID: 'store-staging',
    STORE_E2E_BASE_URL: 'https://store-staging.example',
    STORE_E2E_ALLOWED_HOSTS: 'store-staging.example', STORE_E2E_READ_TOKEN: 'read-only',
  };
  rmSync('artifacts', { recursive: true, force: true });
  mkdirSync('artifacts/evidence-raw', { recursive: true });
  for (const assertionId of ['measurement-status', 'duplicate-task-count']) {
    const supporting = sealCandidateEvidence({
      assertion_id: assertionId, evidence_type: 'backend_query', system: 'nupai-store',
      record_id: 'task-123', correlation_id: 'corr-123', raw_response: {},
    }, standardTest, oracleEnv);
    writeFileSync(`artifacts/evidence-raw/${assertionId}.json`, JSON.stringify(supporting));
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ status: 'completed', duplicate_task_count: 0, token: 'redact-me' }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-fesun-environment': 'store-staging' } },
  )) as typeof fetch;
  try {
    const events = await collectOracleEvidence(packet, packetPath, oracleEnv);
    assert.equal(events.length, 2);
    assert.equal(events.every((event) => event.collector_kind === 'trusted_http_probe'), true);
    assert.equal(events.every((event) => event.request?.method === 'GET'), true);
    assert.equal((events[0].raw_response as any).token, '[REDACTED]');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync('artifacts', { recursive: true, force: true });
  }
});

test('trusted CF-2 replay binds failure signature to the same test hash', async () => {
  const packet = readYAML<BugPacket>('examples/store-STO-191-cross-system/bug-packet.yaml');
  rmSync('artifacts', { recursive: true, force: true });
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/reporter-summary.json', JSON.stringify({
    tests: [{ title: 'STO-191 CF-2: old payload', test_sha256: 'e'.repeat(64) }],
  }));
  writeFileSync('artifacts/report.json', JSON.stringify({
    suites: [{ specs: [{ title: 'fixed', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }] }],
  }));
  const cfEnv = {
    PLATFORM_E2E_BASE_URL: 'https://platform-staging.example',
    PLATFORM_E2E_ALLOWED_HOSTS: 'platform-staging.example',
    PLATFORM_E2E_READ_TOKEN: 'read-only',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'MISSING_ORDER_ID' }), {
    status: 422,
    headers: { 'content-type': 'application/json', 'x-fesun-environment': 'platform-staging' },
  })) as typeof fetch;
  try {
    const result = await runCounterfactual(packet, cfEnv);
    assert.equal(result.baseline_failed, true);
    assert.equal(result.fixed_passed, true);
    assert.equal(result.observed_failure_signature, 'HTTP_422_MISSING_ORDER_ID');
    assert.equal(result.test_sha256, 'e'.repeat(64));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync('artifacts', { recursive: true, force: true });
  }
});
