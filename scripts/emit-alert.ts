/** Emit a small Feishu-compatible alert without including evidence or secrets. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fileExists, readJSON } from './lib.ts';

export interface AlertPayload {
  level: 'FAIL' | 'BLOCKED' | 'PARTIAL';
  classification: string;
  bug_id?: string;
  run_url?: string;
  reasons: string[];
}

export function buildAlertPayload(env: NodeJS.ProcessEnv = process.env): AlertPayload | undefined {
  if (!fileExists('artifacts/verdict.json')) return undefined;
  const verdict = readJSON<Record<string, any>>('artifacts/verdict.json');
  if (verdict.verdict === 'PASS') return undefined;
  return {
    level: verdict.verdict,
    classification: verdict.failure_classification ?? 'UNKNOWN',
    bug_id: verdict.bug_id,
    run_url: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined,
    reasons: [...(verdict.reasons ?? []), ...(verdict.blocked_reasons ?? []), ...(verdict.partial_reasons ?? [])].slice(0, 10),
  };
}

async function main(): Promise<void> {
  const payload = buildAlertPayload();
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/alert.json', JSON.stringify({
    computed_by: 'emit-alert.ts', generated_at: new Date().toISOString(), payload,
  }, null, 2));
  if (!payload) return;
  const webhook = process.env.QC_ALERT_WEBHOOK_URL;
  if (!webhook) {
    console.warn('缺 QC_ALERT_WEBHOOK_URL，仅落盘 alert.json；不影响唯一裁判退出码。');
    return;
  }
  const text = `[FESUN QC] ${payload.level}/${payload.classification} ${payload.bug_id ?? ''}\n${payload.reasons.join('\n')}${payload.run_url ? `\n${payload.run_url}` : ''}`;
  const response = await fetch(webhook, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text } }),
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`告警 webhook HTTP ${response.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error((error as Error).message); process.exit(1); });
}
