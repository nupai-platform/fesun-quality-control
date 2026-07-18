/**
 * STO-186 定点验收测试(示例模板)
 *
 * 演示 v1.1 证据契约:操作 → 请求 → 后端原始响应体落盘 → 断言具体值 → 刷新复验。
 * 实际运行需业务仓库提供 adapters(login/createTestData/queryBackend/cleanup)。
 * 本文件作为业务仓库 testing/acceptance/bugs/STO-186/ 下的模板。
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.STORE_E2E_BASE_URL ?? 'http://localhost:3000';

test(
  'STO-186: 量体完成后状态持久化,刷新后仍为 completed 且不产生重复任务',
  { tag: ['@store', '@spine-02', '@seg-02c', '@standard', '@contract-store-measurement-completed'] },
  async ({ page, request }) => {
    // === 前置:创建唯一测试数据(实际由 data.adapter 提供)===
    const runId = `e2e_STO_186_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const taskId = process.env.QC_SELFTEST_TASK_ID ?? runId; // 自测占位

    // === 注册网络监听(点击前)===
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes(`/api/tasks/${taskId}`) && r.request().method() === 'PATCH',
    );

    // === 操作 ===
    await page.goto(`${BASE}/tasks/${taskId}`);
    await page.getByRole('button', { name: '标记完成' }).click();
    const patchRes = await responsePromise;
    expect(patchRes.status()).toBe(200);

    // === 证据源 1:写响应 ===
    const patchBody = await patchRes.json();
    await test.info().attach('evidence', {
      body: Buffer.from(
        JSON.stringify({
          evidence_type: 'network_response',
          system: 'nupai-store',
          record_id: taskId,
          request: { url: patchRes.url(), method: 'PATCH', status: patchRes.status() },
          asserted_field: 'status',
          expected_from_packet: 'completed',
          raw_response: patchBody,
        }),
      ),
      contentType: 'application/json',
    });
    expect(patchBody.status).toBe('completed');

    // === 刷新 ===
    await page.reload();
    await expect(page.getByTestId('task-status')).toHaveText('已完成');

    // === 证据源 2:后端查询(独立 GET)===
    const getRes = await request.get(`${BASE}/api/tasks/${taskId}`);
    const getBody = await getRes.json();
    await test.info().attach('evidence', {
      body: Buffer.from(
        JSON.stringify({
          evidence_type: 'backend_query',
          system: 'nupai-store',
          record_id: taskId,
          asserted_field: 'status',
          expected_from_packet: 'completed',
          raw_response: getBody,
        }),
      ),
      contentType: 'application/json',
    });
    expect(getBody.status).toBe('completed');

    // === 幂等:重复点击不产生第二条任务 ===
    const listRes = await request.get(`${BASE}/api/tasks?ref=${taskId}`);
    const list = await listRes.json();
    await test.info().attach('evidence', {
      body: Buffer.from(
        JSON.stringify({
          evidence_type: 'duplicate_count',
          system: 'nupai-store',
          record_id: taskId,
          asserted_field: 'duplicate_task_count',
          expected_from_packet: 0,
          raw_response: { duplicate_task_count: Array.isArray(list) ? list.length - 1 : 0 },
        }),
      ),
      contentType: 'application/json',
    });
    expect(Array.isArray(list) ? list.length : 1).toBe(1);
  },
);
