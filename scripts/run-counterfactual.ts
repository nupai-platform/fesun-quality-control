/** Trusted CF-2 contract replay against a non-mutating staging validation endpoint. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  isRecord, jsonPointerGet, readJSON, readYAML, requiredEnv, type BugPacket,
} from './lib.ts';
import { validateProbeTarget } from './collect-oracle-evidence.ts';
import { evaluatePlaywrightReport } from './verdict-gate.ts';

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runCounterfactual(
  packet: BugPacket,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const replay = packet.counterfactual?.replay;
  if (packet.counterfactual?.level !== 'CF-2' || !replay) {
    throw new Error('当前通用 runner 仅执行带 replay 契约的 CF-2；CF-1 必须由系统 adapter 提供旧 commit 报告');
  }
  const allowedHosts = requiredEnv(packet.environment.allowed_hosts_env, env)
    .split(',').map((host) => host.trim()).filter(Boolean);
  const base = validateProbeTarget(requiredEnv(packet.environment.base_url_env, env), allowedHosts);
  const url = new URL(replay.path, base);
  if (url.origin !== base.origin) throw new Error('CF-2 replay URL 越过允许 origin');
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
  if (packet.environment.account?.token_env) {
    headers.authorization = `Bearer ${requiredEnv(packet.environment.account.token_env, env)}`;
  }
  const response = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(replay.broken_payload),
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  const environmentHeader = packet.environment.environment_id_header ?? 'x-fesun-environment';
  const environmentId = response.headers.get(environmentHeader);
  if (environmentId !== packet.environment.expected_environment_id) throw new Error('CF-2 环境指纹不匹配');
  const raw: unknown = (response.headers.get('content-type') ?? '').includes('json')
    ? await response.json() : await response.text();
  const observed = jsonPointerGet(raw, replay.response_selector);
  const observedSignature = `HTTP_${response.status}_${String(observed)}`;
  const summary = readJSON<{ tests?: Array<{ title?: string; test_sha256?: string }> }>('artifacts/reporter-summary.json');
  const matchingTests = (summary.tests ?? []).filter((test) => test.title?.includes(replay.test_title_pattern));
  const report = evaluatePlaywrightReport(readJSON('artifacts/report.json'));
  const baselineFailed = response.status === replay.expected_status && observed === replay.expected_response;
  const output = {
    schema_version: 1.1,
    level: 'CF-2',
    baseline_failed: baselineFailed,
    fixed_passed: report.ok && !report.flaky,
    test_sha256: matchingTests.length === 1 ? matchingTests[0].test_sha256 : undefined,
    observed_failure_signature: observedSignature,
    reason_code: packet.counterfactual.reason_code,
  };
  if (!isRecord(raw)) throw new Error('CF-2 响应必须是结构化 object');
  return output;
}

async function main(): Promise<void> {
  const packetPath = arg('--packet');
  if (!packetPath) throw new Error('缺 --packet');
  const output = await runCounterfactual(readYAML<BugPacket>(packetPath));
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/counterfactual.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  const valid = output.baseline_failed === true && output.fixed_passed === true &&
    typeof output.test_sha256 === 'string' &&
    output.observed_failure_signature === readYAML<BugPacket>(packetPath).counterfactual?.expected_failure_signature;
  process.exit(valid ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error((error as Error).message); process.exit(1); });
}
