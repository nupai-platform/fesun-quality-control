/** Read-only trusted Oracle collector. It performs GET probes only and seals provenance itself. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { globSync } from 'glob';
import {
  readJSON,
  readYAML,
  redactSensitive,
  requiredEnv,
  sha256,
  sha256File,
  stableStringify,
  type BugPacket,
  type EvidenceEvent,
  type PacketAssertion,
} from './lib.ts';

const PRODUCTION_HOST = /(^|[.-])(prod|production)([.-]|$)/i;

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function validateProbeTarget(baseUrl: string, allowedHosts: string[]): URL {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Oracle base URL 只允许 http/https');
  if (base.username || base.password) throw new Error('Oracle base URL 禁止内嵌凭据');
  if (!allowedHosts.includes(base.hostname)) throw new Error(`host ${base.hostname} 不在显式 allowlist`);
  if (PRODUCTION_HOST.test(base.hostname)) throw new Error(`拒绝 production host: ${base.hostname}`);
  return base;
}

function expandPath(template: string, recordId: string, correlationId: string): string {
  const expanded = template
    .replaceAll('{record_id}', encodeURIComponent(recordId))
    .replaceAll('{correlation_id}', encodeURIComponent(correlationId));
  if (/{[^}]+}/.test(expanded)) throw new Error(`未识别 probe placeholder: ${expanded}`);
  return expanded;
}

function findSupportingEvidence(assertion: PacketAssertion): EvidenceEvent {
  const files = globSync('artifacts/evidence-raw/*.json', { nodir: true }).sort();
  for (const file of files) {
    const evidence = readJSON<EvidenceEvent>(file);
    if (evidence.assertion_id === assertion.id && evidence.collector_kind === 'playwright_attachment') {
      return evidence;
    }
  }
  throw new Error(`${assertion.id}: 缺 Playwright supporting evidence，无法安全定位 record`);
}

export async function collectOracleEvidence(
  packet: BugPacket,
  packetPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EvidenceEvent[]> {
  const probeAssertions = packet.expected_business_result.assertions.filter(
    (assertion) => assertion.required_collectors.includes('trusted_http_probe'),
  );
  if (!probeAssertions.length) return [];
  const allowedHosts = requiredEnv(packet.environment.allowed_hosts_env, env)
    .split(',').map((host) => host.trim()).filter(Boolean);
  const base = validateProbeTarget(requiredEnv(packet.environment.base_url_env, env), allowedHosts);
  const environmentHeader = packet.environment.environment_id_header ?? 'x-fesun-environment';
  const output: EvidenceEvent[] = [];

  for (const assertion of probeAssertions) {
    if (!assertion.probe || assertion.probe.method !== 'GET') {
      throw new Error(`${assertion.id}: trusted_http_probe 只允许显式 GET`);
    }
    const supporting = findSupportingEvidence(assertion);
    const path = expandPath(
      assertion.probe.path_template,
      supporting.record_id,
      supporting.provenance.correlation_id,
    );
    const url = new URL(path, base);
    if (url.origin !== base.origin || !allowedHosts.includes(url.hostname)) {
      throw new Error(`${assertion.id}: probe URL 越过允许 origin`);
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    const tokenEnv = packet.environment.account?.token_env;
    if (tokenEnv) headers.authorization = `Bearer ${requiredEnv(tokenEnv, env)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const actualEnvironment = response.headers.get(environmentHeader);
    if (actualEnvironment !== packet.environment.expected_environment_id) {
      throw new Error(
        `${assertion.id}: 环境指纹不匹配，期望 ${packet.environment.expected_environment_id}，实际 ${actualEnvironment ?? 'missing'}`,
      );
    }
    if (!response.ok) throw new Error(`${assertion.id}: probe HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    const raw = contentType.includes('json') ? await response.json() : await response.text();
    const redacted = redactSensitive(raw, [
      'password', 'token', 'authorization', 'cookie', 'secret', 'phone', 'email',
      ...(env.QC_REDACT_KEYS ?? '').split(',').map((key) => key.trim()).filter(Boolean),
    ]);
    const withoutId: Omit<EvidenceEvent, 'event_id'> = {
      schema_version: 1.1,
      assertion_id: assertion.id,
      evidence_type: 'backend_query',
      collector_kind: 'trusted_http_probe',
      system: packet.environment.target_system,
      record_id: supporting.record_id,
      captured_at: new Date().toISOString(),
      request: { url: url.toString(), method: 'GET', status: response.status },
      raw_response: redacted.value,
      raw_response_sha256: sha256(stableStringify(redacted.value)),
      ...(redacted.redactions.length ? { redactions: redacted.redactions } : {}),
      provenance: {
        run_id: requiredEnv('QC_RUN_ID', env),
        repo: requiredEnv('GITHUB_REPOSITORY', env),
        base_sha: requiredEnv('QC_BASE_SHA', env),
        head_sha: requiredEnv('QC_HEAD_SHA', env),
        qc_sha: requiredEnv('QC_SHA', env),
        packet_sha256: sha256File(packetPath),
        test_sha256: supporting.provenance.test_sha256,
        environment_id: actualEnvironment,
        correlation_id: supporting.provenance.correlation_id,
      },
    };
    output.push({ ...withoutId, event_id: sha256(stableStringify(withoutId)) });
  }
  return output;
}

async function main(): Promise<void> {
  const packetPath = arg('--packet');
  if (!packetPath) throw new Error('缺 --packet');
  const events = await collectOracleEvidence(readYAML<BugPacket>(packetPath), packetPath);
  const outputDir = 'artifacts/evidence-trusted';
  mkdirSync(outputDir, { recursive: true });
  events.forEach((event, index) => {
    writeFileSync(join(outputDir, `${basename(packetPath)}-${index}.json`), JSON.stringify(event, null, 2));
  });
  console.log(`可信 Oracle 采集完成: ${events.length} 条只读证据。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error((error as Error).message); process.exit(1); });
}
