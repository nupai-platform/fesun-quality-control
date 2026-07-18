/** Separate PR authoring scope checks from runtime worker mutation checks. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gitExec, isAllowedTestPath, readJSON, sha256File } from './lib.ts';

interface RuntimeSnapshot {
  computed_by: string;
  head: string;
  protected_files: Record<string, string>;
  status_entries: string[];
}

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function protectedHashes(): Record<string, string> {
  const listed = gitExec(['ls-files', '-z']);
  if (!listed.ok) throw new Error(`git ls-files 失败: ${listed.error}`);
  return Object.fromEntries(
    listed.stdout.split('\0').filter(Boolean).filter((file) => !isAllowedTestPath(file))
      .map((file) => [file, sha256File(file)]),
  );
}

function statusEntries(): string[] {
  const result = gitExec(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!result.ok) throw new Error(`git status 失败: ${result.error}`);
  return result.stdout.split('\0').filter(Boolean).sort();
}

export function createRuntimeSnapshot(): RuntimeSnapshot {
  const head = gitExec(['rev-parse', 'HEAD']);
  if (!head.ok) throw new Error(`无法读取 HEAD: ${head.error}`);
  return {
    computed_by: 'detect-business-code-change.ts',
    head: head.stdout,
    protected_files: protectedHashes(),
    status_entries: statusEntries(),
  };
}

export function compareRuntimeSnapshot(before: RuntimeSnapshot): string[] {
  const after = protectedHashes();
  const changes = new Set<string>();
  for (const [file, hash] of Object.entries(before.protected_files)) {
    if (!(file in after)) changes.add(`${file} (deleted)`);
    else if (after[file] !== hash) changes.add(`${file} (modified)`);
  }
  for (const file of Object.keys(after)) if (!(file in before.protected_files)) changes.add(`${file} (added)`);

  const beforeStatus = new Set(before.status_entries);
  for (const entry of statusEntries()) {
    if (beforeStatus.has(entry)) continue;
    const path = entry.slice(3).split(' -> ').at(-1) ?? '';
    if (!isAllowedTestPath(path)) changes.add(`${path} (runtime worktree change)`);
  }
  return [...changes].sort();
}

export function changedAuthoringFiles(base: string, head: string): string[] {
  const diff = gitExec(['diff', '--name-only', `${base}...${head}`]);
  if (!diff.ok) throw new Error(`无法比较 authoring diff: ${diff.error}`);
  return diff.stdout.split('\n').filter(Boolean);
}

function main(): void {
  const mode = arg('--mode') ?? 'runtime-verify';
  const outputPath = arg('--output') ?? 'artifacts/business-code-change.json';
  if (mode === 'runtime-snapshot') {
    const snapshot = createRuntimeSnapshot();
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
    console.log(`runtime snapshot 已记录 ${Object.keys(snapshot.protected_files).length} 个保护文件。`);
    return;
  }

  let changedFiles: string[] = [];
  let businessChanges: string[] = [];
  if (mode === 'authoring') {
    const base = arg('--base');
    const head = arg('--head');
    if (!base || !head) throw new Error('authoring 模式必须提供 --base 与 --head');
    changedFiles = changedAuthoringFiles(base, head);
    businessChanges = changedFiles.filter((file) => !isAllowedTestPath(file));
  } else if (mode === 'runtime-verify') {
    const snapshotPath = arg('--snapshot') ?? 'artifacts/worktree-before.json';
    businessChanges = compareRuntimeSnapshot(readJSON<RuntimeSnapshot>(snapshotPath));
    changedFiles = businessChanges;
  } else {
    throw new Error(`未知 --mode ${mode}`);
  }

  const result = {
    computed_by: 'detect-business-code-change.ts',
    generated_at: new Date().toISOString(),
    mode,
    changed_files: changedFiles,
    business_changes: businessChanges,
    ok: businessChanges.length === 0,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error((error as Error).message); process.exit(2); }
}
