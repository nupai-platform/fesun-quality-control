/** Shared, side-effect-free helpers for FESUN QC v1.1.1. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseYaml } from 'yaml';

export type RiskLevel = 'FAST' | 'STANDARD' | 'CRITICAL' | 'CROSS_SYSTEM' | 'MANUAL_REVIEW';
export type CollectorKind = 'playwright_attachment' | 'trusted_http_probe' | 'contract_replay';
export type AssertionOperator = 'equals' | 'not_equals' | 'contains' | 'array_length_equals';

export interface PacketAssertion {
  id: string;
  selector: string;
  operator: AssertionOperator;
  expected: string | number | boolean | null;
  required_collectors: CollectorKind[];
  min_independent_sources: number;
  probe?: { method: 'GET'; path_template: string };
}

export interface BugPacket {
  schema_version: 1.1;
  bug: {
    id: string;
    title: string;
    original_description: string;
    source: { type: string; uri: string; reporter?: string; content_sha256: string };
  };
  expected_business_result: {
    owner: string;
    confirmed_at: string;
    source_uri: string;
    assertions_sha256: string;
    assertions: PacketAssertion[];
  };
  environment: {
    target_system: string;
    base_url_env: string;
    expected_environment_id: string;
    environment_id_header?: string;
    allowed_hosts_env: string;
    account?: { username_env?: string; password_env?: string; token_env?: string; role?: string };
  };
  git?: { repo: string; base_commit?: string; fixed_commit?: string };
  risk_claim: { declared_level: RiskLevel };
  business_scope?: {
    affected_contracts?: string[];
    affected_spines?: string[];
    affected_segments?: string[];
  };
  counterfactual?: {
    level?: string;
    reason_code?: string;
    expected_failure_signature?: string;
    replay?: {
      method: 'POST'; path: string; broken_payload: Record<string, unknown>;
      expected_status: number; response_selector: string;
      expected_response: string | number | boolean | null; test_title_pattern: string;
    };
  };
  test_data: { namespace: string; expires_after_hours: number; cleanup_debt_limit: number };
}

export interface EvidenceProvenance {
  run_id: string;
  repo: string;
  base_sha: string;
  head_sha: string;
  qc_sha: string;
  packet_sha256: string;
  test_sha256: string;
  environment_id: string;
  correlation_id: string;
}

export interface EvidenceEvent {
  schema_version: 1.1;
  event_id: string;
  assertion_id: string;
  evidence_type: string;
  collector_kind: CollectorKind;
  system: string;
  record_id: string;
  captured_at: string;
  request?: { url: string; method: string; status: number };
  raw_response: unknown;
  raw_response_sha256: string;
  redactions?: string[];
  provenance: EvidenceProvenance;
}

export const RISK_ORDER: RiskLevel[] = [
  'FAST',
  'STANDARD',
  'CRITICAL',
  'CROSS_SYSTEM',
  'MANUAL_REVIEW',
];

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export function readJSON<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function readYAML<T = unknown>(path: string): T {
  return parseYaml(readFileSync(path, 'utf8')) as T;
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(path: string): string {
  return sha256(readFileSync(path));
}

export function assertionsSha256(assertions: PacketAssertion[]): string {
  return sha256(stableStringify(assertions));
}

export function jsonPointerGet(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((current, token) => {
      if (Array.isArray(current)) {
        const index = Number(token);
        return Number.isInteger(index) ? current[index] : undefined;
      }
      return isRecord(current) ? current[token] : undefined;
    }, value);
}

export function assertionMatches(assertion: PacketAssertion, rawResponse: unknown): boolean {
  const actual = jsonPointerGet(rawResponse, assertion.selector);
  switch (assertion.operator) {
    case 'equals':
      return isDeepStrictEqual(actual, assertion.expected);
    case 'not_equals':
      return !isDeepStrictEqual(actual, assertion.expected);
    case 'contains':
      return typeof actual === 'string' && typeof assertion.expected === 'string'
        ? actual.includes(assertion.expected)
        : Array.isArray(actual) && actual.some((item) => isDeepStrictEqual(item, assertion.expected));
    case 'array_length_equals':
      return Array.isArray(actual) && actual.length === assertion.expected;
  }
}

export function gitExec(args: string[], cwd = process.cwd()): { ok: boolean; stdout: string; error?: string } {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
    return { ok: true, stdout };
  } catch (error) {
    const detail = error as { stderr?: Buffer | string; message?: string };
    return {
      ok: false,
      stdout: '',
      error: detail.stderr?.toString().trim() || detail.message || 'git command failed',
    };
  }
}

/** Backward-compatible wrapper for existing scripts. Do not pass untrusted whitespace-bearing input. */
export function git(args: string): string {
  const result = gitExec(args.split(/\s+/).filter(Boolean));
  return result.ok ? result.stdout : '';
}

export const ALLOWED_TEST_PATHS = [
  /^testing\//,
  /^playwright\//,
  /^playwright\.config\./,
  /^docs\/testing\//,
  /^artifacts\//,
  /^coverage\//,
  /^examples\//,
];

export function isAllowedTestPath(file: string): boolean {
  return ALLOWED_TEST_PATHS.some((pattern) => pattern.test(file));
}

export const FORBIDDEN_BUSINESS_PATHS = [
  /^src\//,
  /^app\//,
  /^backend\//,
  /^migrations\//,
  /^services\//,
  /^models\//,
  /^events\//,
  /schema\.prisma$/,
];

export function redactSensitive(
  value: unknown,
  sensitiveKeys: string[],
  path = '',
): { value: unknown; redactions: string[] } {
  const redactions: string[] = [];
  const lowered = sensitiveKeys.map((key) => key.toLowerCase());

  const visit = (current: unknown, currentPath: string): unknown => {
    if (Array.isArray(current)) {
      return current.map((item, index) => visit(item, `${currentPath}/${index}`));
    }
    if (!isRecord(current)) return current;
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(current)) {
      const nestedPath = `${currentPath}/${key}`;
      if (lowered.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        output[key] = '[REDACTED]';
        redactions.push(nestedPath);
      } else {
        output[key] = visit(nested, nestedPath);
      }
    }
    return output;
  };

  return { value: visit(value, path), redactions };
}

export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

export interface GateResult {
  ok: boolean;
  reasons: string[];
}

export function fail(reasons: string[]): GateResult {
  return { ok: false, reasons };
}

export function pass(): GateResult {
  return { ok: true, reasons: [] };
}
