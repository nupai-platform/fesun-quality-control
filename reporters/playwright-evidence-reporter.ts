/** Convert untrusted Playwright attachments into provenance-bound evidence events. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  redactSensitive,
  sha256,
  sha256File,
  stableStringify,
  type EvidenceEvent,
} from '../scripts/lib.ts';

const ARTIFACT_ROOT = resolve(process.cwd(), process.env.QC_ARTIFACT_DIR ?? 'artifacts');
const EVIDENCE_DIR = join(ARTIFACT_ROOT, 'evidence-raw');
const SUMMARY_FILE = join(ARTIFACT_ROOT, 'reporter-summary.json');
const DEFAULT_REDACT_KEYS = ['password', 'token', 'authorization', 'cookie', 'secret', 'phone', 'email'];
const CANDIDATE_KEYS = new Set([
  'assertion_id',
  'evidence_type',
  'system',
  'record_id',
  'correlation_id',
  'request',
  'raw_response',
]);

export interface CandidateEvidence {
  assertion_id: string;
  evidence_type: EvidenceEvent['evidence_type'];
  system: string;
  record_id: string;
  correlation_id: string;
  request?: EvidenceEvent['request'];
  raw_response: unknown;
}

interface TestSummaryEntry {
  test_id: string;
  title: string;
  test_file: string;
  test_sha256?: string;
  tags: string[];
  status: TestResult['status'];
  retry: number;
  duration_ms: number;
  evidence_files: string[];
  errors: string[];
}

function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function requiredEvidenceEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const names = [
    'QC_RUN_ID',
    'GITHUB_REPOSITORY',
    'QC_BASE_SHA',
    'QC_HEAD_SHA',
    'QC_SHA',
    'QC_PACKET_SHA256',
    'QC_ENVIRONMENT_ID',
  ];
  return Object.fromEntries(
    names.map((name) => {
      const value = env[name];
      if (!value) throw new Error(`缺少 reporter 环境变量 ${name}`);
      return [name, value];
    }),
  );
}

export function parseCandidateEvidence(body: Buffer): CandidateEvidence {
  const candidate = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('evidence attachment 必须是 JSON object');
  }
  const unexpected = Object.keys(candidate).filter((key) => !CANDIDATE_KEYS.has(key));
  if (unexpected.length) {
    throw new Error(`attachment 含禁止或未知字段: ${unexpected.join(', ')}`);
  }
  for (const key of ['assertion_id', 'evidence_type', 'system', 'record_id', 'correlation_id']) {
    if (typeof candidate[key] !== 'string' || candidate[key] === '') {
      throw new Error(`attachment.${key} 必须是非空字符串`);
    }
  }
  if (!Object.hasOwn(candidate, 'raw_response')) throw new Error('attachment 缺 raw_response');
  return candidate as unknown as CandidateEvidence;
}

export function sealCandidateEvidence(
  candidate: CandidateEvidence,
  testFile: string,
  env: NodeJS.ProcessEnv = process.env,
): EvidenceEvent {
  const values = requiredEvidenceEnv(env);
  if (!/^[0-9a-f]{40}$/.test(values.QC_SHA)) throw new Error('QC_SHA 必须是完整 40 位 commit SHA');
  const redactKeys = [
    ...DEFAULT_REDACT_KEYS,
    ...(env.QC_REDACT_KEYS ?? '').split(',').map((key) => key.trim()).filter(Boolean),
  ];
  const redacted = redactSensitive(candidate.raw_response, redactKeys);
  const withoutId: Omit<EvidenceEvent, 'event_id'> = {
    schema_version: 1.1,
    assertion_id: candidate.assertion_id,
    evidence_type: candidate.evidence_type,
    collector_kind: 'playwright_attachment',
    system: candidate.system,
    record_id: candidate.record_id,
    captured_at: new Date().toISOString(),
    ...(candidate.request ? { request: candidate.request } : {}),
    raw_response: redacted.value,
    raw_response_sha256: sha256(stableStringify(redacted.value)),
    ...(redacted.redactions.length ? { redactions: redacted.redactions } : {}),
    provenance: {
      run_id: values.QC_RUN_ID,
      repo: values.GITHUB_REPOSITORY,
      base_sha: values.QC_BASE_SHA,
      head_sha: values.QC_HEAD_SHA,
      qc_sha: values.QC_SHA,
      packet_sha256: values.QC_PACKET_SHA256,
      test_sha256: sha256File(testFile),
      environment_id: values.QC_ENVIRONMENT_ID,
      correlation_id: candidate.correlation_id,
    },
  };
  return { ...withoutId, event_id: sha256(stableStringify(withoutId)) };
}

export default class EvidenceReporter implements Reporter {
  private summary: TestSummaryEntry[] = [];
  private startTime = 0;

  onBegin(): void {
    this.startTime = Date.now();
    mkdirSync(EVIDENCE_DIR, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const evidenceFiles: string[] = [];
    const errors: string[] = [];
    const testFile = test.location.file;
    for (const attachment of result.attachments) {
      if (attachment.name !== 'evidence') continue;
      try {
        const body = attachment.body ?? (attachment.path ? readFileSync(attachment.path) : undefined);
        if (!body) throw new Error('attachment 无 body/path');
        const event = sealCandidateEvidence(parseCandidateEvidence(body), testFile);
        const fileName = `${safeName(test.id)}-${result.retry}-${evidenceFiles.length}.json`;
        const outPath = join(EVIDENCE_DIR, fileName);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, JSON.stringify(event, null, 2));
        evidenceFiles.push(relative(process.cwd(), outPath));
      } catch (error) {
        errors.push((error as Error).message);
      }
    }

    this.summary.push({
      test_id: test.id,
      title: test.titlePath().join(' > '),
      test_file: relative(process.cwd(), testFile),
      test_sha256: (() => {
        try { return sha256File(testFile); } catch { return undefined; }
      })(),
      tags: Array.isArray(test.tags) ? test.tags : [],
      status: result.status,
      retry: result.retry,
      duration_ms: result.duration,
      evidence_files: evidenceFiles,
      errors,
    });
  }

  onEnd(): void {
    mkdirSync(dirname(SUMMARY_FILE), { recursive: true });
    writeFileSync(SUMMARY_FILE, JSON.stringify({
      generated_by: 'playwright-evidence-reporter.ts',
      generated_at: new Date().toISOString(),
      total_duration_ms: Date.now() - this.startTime,
      tests: this.summary,
      errors: this.summary.flatMap((test) => test.errors.map((error) => `${test.test_id}: ${error}`)),
    }, null, 2));
  }

  printsToStdio(): boolean { return false; }
}
