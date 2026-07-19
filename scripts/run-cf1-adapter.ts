/** Run a pinned system CF-1 adapter in isolated base/fixed worktrees. */
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readYAML, sha256File, type BugPacket } from './lib.ts';
import { expectedCrmFailure, safeRelativePath } from './cf1-adapter-guards.ts';

type CommandResult = { status: number; output: string };

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function runChecked(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const result = run(command, args, cwd, env);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.output.slice(-8000)}`);
  return result.output;
}

function assertCommit(repo: string, sha: string): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`commit 必须是完整 SHA: ${sha}`);
  const resolved = run('git', ['-C', repo, 'rev-parse', '--verify', `${sha}^{commit}`], repo);
  if (resolved.status !== 0 || resolved.output.trim() !== sha) {
    throw new Error(`candidate checkout 缺少精确 commit: ${sha}`);
  }
}

function copyExactTest(candidateRoot: string, worktree: string, testPath: string): string {
  const source = join(candidateRoot, testPath);
  const destination = join(worktree, testPath);
  if (!existsSync(source)) throw new Error(`fixed commit 缺少 test file: ${testPath}`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  return sha256File(source);
}

function copyAcceptanceHarness(candidateRoot: string, worktree: string): void {
  for (const file of ['testing/acceptance/package.json', 'testing/acceptance/package-lock.json']) {
    const source = join(candidateRoot, file);
    const destination = join(worktree, file);
    if (!existsSync(source)) throw new Error(`fixed commit 缺少 acceptance harness file: ${file}`);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function copyFrontendHarness(candidateRoot: string, worktree: string): void {
  for (const file of ['frontend/package.json', 'frontend/package-lock.json']) {
    const source = join(candidateRoot, file);
    const destination = join(worktree, file);
    if (!existsSync(source)) throw new Error(`fixed commit 缺少 frontend harness file: ${file}`);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function cleanEnv(baseUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: '1',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PLAYWRIGHT_BASE_URL: baseUrl,
  };
  for (const key of Object.keys(env)) {
    if (/TOKEN|PASSWORD|SECRET|COOKIE|AUTHORIZATION|API_KEY/i.test(key)) delete env[key];
  }
  return env;
}

function waitForServer(url: string, process: ChildProcess, logPath: string): void {
  const deadline = Date.now() + 90_000;
  let lastError = '';
  while (Date.now() < deadline) {
    const alive = spawnSync('ps', ['-p', String(process.pid), '-o', 'pid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;
    if (!alive) {
      let output = '';
      try { output = readFileSync(logPath, 'utf8').slice(-4000); } catch { /* preserve primary error */ }
      throw new Error(`frontend server exited early: ${lastError}\n${output}`);
    }
    try {
      const result = spawnSync('curl', ['-fsS', '--max-time', '3', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (result.status === 0) return;
      lastError = result.stderr || result.stdout || `curl status ${result.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`frontend server did not become ready: ${lastError}`);
}

function runCrmVersion(worktree: string, testPath: string, port: number): { passed: boolean; output: string } {
  const env = cleanEnv(`http://127.0.0.1:${port}`);
  runChecked('npm', ['ci', '--prefix', 'testing/acceptance'], worktree, env);
  runChecked('npm', ['ci', '--prefix', 'frontend'], worktree, env);
  // CF-1 is a route-level counterfactual. A full production build would
  // compile unrelated legacy routes and can fail before the target page is
  // exercised. Start the development server instead so Next compiles only
  // the requested route while preserving the exact application commit.
  const logPath = join(worktree, `.fesun-cf1-server-${port}.log`);
  const logFd = openSync(logPath, 'w');
  const server = spawn('npm', ['--prefix', 'frontend', 'run', 'dev', '--', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: worktree,
    env: { ...env, NODE_ENV: 'development' },
    stdio: ['ignore', logFd, logFd],
  });
  closeSync(logFd);
  try {
    waitForServer(`http://127.0.0.1:${port}/accounts`, server, logPath);
    const result = run('npm', [
      '--prefix', 'testing/acceptance', 'exec', '--', 'playwright', 'test', testPath,
      '--config', 'frontend/playwright.config.ts', '--project', 'chromium', '--reporter=json', '--retries=0',
    ], worktree, env);
    return { passed: result.status === 0, output: result.output };
  } catch (error) {
    let serverOutput = '';
    try { serverOutput = readFileSync(logPath, 'utf8'); } catch { /* preserve primary error */ }
    throw new Error(`${(error as Error).message}\nfrontend server output:\n${serverOutput.slice(-8000)}`);
  } finally {
    server.kill('SIGTERM');
    rmSync(logPath, { force: true });
  }
}

function runAdapter(packetPath: string): Record<string, unknown> | undefined {
  const packet = readYAML<BugPacket>(packetPath);
  if (packet.counterfactual?.level !== 'CF-1') return undefined;
  const adapter = process.env.QC_CF1_ADAPTER;
  if (adapter !== 'nupai-crm') throw new Error(`未安装可信 CF-1 adapter: ${adapter || '(empty)'}`);
  const candidateRoot = resolve(process.env.QC_CANDIDATE_ROOT || '.candidate');
  const baseSha = process.env.QC_BASE_SHA;
  const fixedSha = process.env.QC_HEAD_SHA;
  const testPath = safeRelativePath(process.env.QC_CF1_TEST_PATH || '');
  if (!baseSha || !fixedSha) throw new Error('CF-1 缺 base/head SHA');
  assertCommit(candidateRoot, baseSha);
  assertCommit(candidateRoot, fixedSha);

  const root = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'fesun-cf1-crm-'));
  const baseWorktree = join(root, 'base');
  const fixedWorktree = join(root, 'fixed');
  const env = cleanEnv('http://127.0.0.1:0');
  try {
    runChecked('git', ['-C', candidateRoot, 'worktree', 'add', '--detach', baseWorktree, baseSha], candidateRoot, env);
    runChecked('git', ['-C', candidateRoot, 'worktree', 'add', '--detach', fixedWorktree, fixedSha], candidateRoot, env);
    const testSha = copyExactTest(candidateRoot, baseWorktree, testPath);
    copyExactTest(candidateRoot, fixedWorktree, testPath);
    // Old commits may predate the harness; use the immutable fixed-commit harness
    // in both worktrees, while keeping the application source at each exact SHA.
    copyAcceptanceHarness(candidateRoot, baseWorktree);
    copyAcceptanceHarness(candidateRoot, fixedWorktree);
    // Keep the frontend dependency/toolchain stable across the two exact
    // application snapshots so a legacy package manifest cannot prevent the
    // counterfactual route from starting.
    copyFrontendHarness(candidateRoot, baseWorktree);
    copyFrontendHarness(candidateRoot, fixedWorktree);

    const baseline = runCrmVersion(baseWorktree, testPath, 3100);
    if (baseline.passed || !expectedCrmFailure(baseline.output)) {
      throw new Error(`CF-1 baseline 未命中预期旧故障签名:\n${baseline.output.slice(-8000)}`);
    }
    const fixed = runCrmVersion(fixedWorktree, testPath, 3101);
    if (!fixed.passed) throw new Error(`CF-1 fixed commit 测试失败:\n${fixed.output.slice(-8000)}`);

    return {
      schema_version: 1.1,
      level: 'CF-1',
      baseline_failed: true,
      fixed_passed: true,
      test_sha256: testSha,
      observed_failure_signature: packet.counterfactual?.expected_failure_signature,
      reason_code: packet.counterfactual?.reason_code,
    };
  } finally {
    run('git', ['-C', candidateRoot, 'worktree', 'remove', '--force', baseWorktree], candidateRoot, env);
    run('git', ['-C', candidateRoot, 'worktree', 'remove', '--force', fixedWorktree], candidateRoot, env);
    rmSync(root, { recursive: true, force: true });
  }
}

function main(): void {
  const packetPath = arg('--packet');
  if (!packetPath) throw new Error('缺 --packet');
  const result = runAdapter(packetPath);
  if (!result) process.exit(0);
  const artifactsDir = join(process.env.GITHUB_WORKSPACE || process.cwd(), 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  const serialized = JSON.stringify(result, null, 2);
  writeFileSync(join(artifactsDir, 'counterfactual.json'), serialized);
  console.log(serialized);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error((error as Error).message); process.exit(1); }
}
