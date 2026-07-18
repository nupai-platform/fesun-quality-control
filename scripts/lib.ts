/**
 * FESUN QC 共享工具 v1.1
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

export type RiskLevel = 'FAST' | 'STANDARD' | 'CRITICAL' | 'CROSS_SYSTEM' | 'MANUAL_REVIEW';

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

/** 读取点分路径字段值,例如 store.measurement.status */
export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** 运行 git 命令,失败返回空串(不抛,便于 CI 容错) */
export function git(args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** 测试文件写入白名单(测试 Worker 只允许改这些路径) */
export const ALLOWED_TEST_PATHS = [
  /^testing\//,
  /^playwright\//,
  /^playwright\.config\./,
  /^docs\/testing\//,
  /^artifacts\//,
  /^examples\//,
];

export function isAllowedTestPath(file: string): boolean {
  return ALLOWED_TEST_PATHS.some((re) => re.test(file));
}

/** 禁止测试 Worker 触碰的业务代码前缀 */
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
