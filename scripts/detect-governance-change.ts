/** Prevent spine governance changes from being mixed into ordinary Bug PRs. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gitExec } from './lib.ts';

const GOVERNANCE_PATH = /^(spine\/|schemas\/(?:spine-map|code-impact-map)\.schema\.json$|docs\/spine\/)/;

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(): void {
  const base = arg('--base');
  const head = arg('--head');
  if (!base || !head) throw new Error('必须提供 --base 与 --head');
  const diff = gitExec(['diff', '--name-only', `${base}...${head}`]);
  const numstat = gitExec(['diff', '--numstat', `${base}...${head}`, '--', 'spine/']);
  if (!diff.ok || !numstat.ok) throw new Error(diff.error ?? numstat.error);
  const changed = diff.stdout.split('\n').filter(Boolean);
  const governance = changed.filter((file) => GOVERNANCE_PATH.test(file));
  const mixed = governance.length > 0 && changed.some((file) => !GOVERNANCE_PATH.test(file));
  const deletedLines = numstat.stdout.split('\n').filter(Boolean).reduce((sum, line) => {
    const removed = Number(line.split('\t')[1]);
    return sum + (Number.isFinite(removed) ? removed : 0);
  }, 0);
  const deletionWithoutOwner = deletedLines > 0 && process.env.QC_GOVERNANCE_OWNER_APPROVED !== 'true';
  const reasons = [
    ...(mixed ? ['治理地图变更与普通代码混在同一 PR'] : []),
    ...(deletionWithoutOwner ? [`治理地图删除 ${deletedLines} 行但缺 owner approval`] : []),
  ];
  const output = {
    computed_by: 'detect-governance-change.ts', generated_at: new Date().toISOString(),
    governance_files: governance, mixed_change: mixed, deleted_lines: deletedLines,
    owner_approved: process.env.QC_GOVERNANCE_OWNER_APPROVED === 'true', reasons, ok: reasons.length === 0,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/governance-change.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error((error as Error).message); process.exit(2); }
}
