/**
 * FESUN Evidence Reporter v1.1
 *
 * 职责(P0-1 证据不可伪造):
 *   - 从 Playwright 运行时事件中提取测试落盘的 'evidence' attachment(后端原始响应体)
 *   - 原样写入 artifacts/evidence-raw/*.json —— 不做任何布尔判定
 *   - 记录每条测试的 status(passed/failed/timedOut/skipped) 到 artifacts/reporter-summary.json
 *
 * 关键约束:
 *   - 本 reporter 不产出 verdict、不写 merge_allowed、不写任何 *_verified 布尔字段
 *   - 判定完全交给 verdict-gate.ts 从这些原始产物独立复判
 *   - AI 无权写入本 reporter 产生的任何文件
 *
 * 在业务仓库 playwright.config.ts 中启用:
 *   reporter: [
 *     ['list'],
 *     ['json', { outputFile: 'artifacts/report.json' }],
 *     ['./node_modules/fesun-quality-control/reporters/playwright-evidence-reporter.ts']
 *   ]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  Reporter,
  TestCase,
  TestResult,
  FullConfig,
  Suite,
} from '@playwright/test/reporter';

const EVIDENCE_DIR = join(process.cwd(), 'artifacts', 'evidence-raw');
const SUMMARY_FILE = join(process.cwd(), 'artifacts', 'reporter-summary.json');

interface TestSummaryEntry {
  test_id: string;
  title: string;
  tags: string[];
  status: TestResult['status'];
  retry: number;
  duration_ms: number;
  evidence_files: string[];
}

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export default class EvidenceReporter implements Reporter {
  private summary: TestSummaryEntry[] = [];
  private startTime = 0;

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.startTime = Date.now();
    mkdirSync(EVIDENCE_DIR, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const tags = Array.isArray(test.tags) ? test.tags : [];
    const evidenceFiles: string[] = [];

    for (const attachment of result.attachments) {
      if (attachment.name !== 'evidence' || !attachment.body) continue;

      // 原样落盘,不解析、不判定
      const fileName = `${safeName(test.id)}-${result.retry}-${evidenceFiles.length}.json`;
      const outPath = join(EVIDENCE_DIR, fileName);
      ensureDir(outPath);
      writeFileSync(outPath, attachment.body);
      evidenceFiles.push(join('artifacts', 'evidence-raw', fileName));
    }

    this.summary.push({
      test_id: test.id,
      title: test.titlePath().join(' > '),
      tags,
      status: result.status,
      retry: result.retry,
      duration_ms: result.duration,
      evidence_files: evidenceFiles,
    });
  }

  onEnd(): void {
    ensureDir(SUMMARY_FILE);
    writeFileSync(
      SUMMARY_FILE,
      JSON.stringify(
        {
          generated_by: 'playwright-evidence-reporter.ts',
          generated_at: new Date().toISOString(),
          total_duration_ms: Date.now() - this.startTime,
          tests: this.summary,
        },
        null,
        2,
      ),
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}
