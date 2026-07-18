import { expect, test } from '@playwright/test';

const base = process.env.STORE_E2E_BASE_URL!;

test('STO-186 STANDARD: 保存后刷新仍为 completed 且无重复任务', async ({ page }) => {
  const runId = process.env.QC_RUN_ID!;
  const taskId = `e2e_STO_186_${runId}_${crypto.randomUUID()}`;
  const correlationId = crypto.randomUUID();
  await page.goto(`${base}/tasks/${taskId}`);
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/tasks/${taskId}`) && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '标记完成' }).click();
  const response = await responsePromise;
  const body = await response.json();
  expect(response.status()).toBe(200);
  expect(body.status).toBe('completed');
  await test.info().attach('evidence', {
    body: Buffer.from(JSON.stringify({
      assertion_id: 'measurement-status', evidence_type: 'network_response',
      system: 'nupai-store', record_id: taskId, correlation_id: correlationId,
      request: { url: response.url(), method: 'PATCH', status: response.status() }, raw_response: body,
    })),
    contentType: 'application/json',
  });

  await page.reload();
  await expect(page.getByTestId('task-status')).toHaveAttribute('data-status', 'completed');
  const verification = await page.request.get(`${base}/api/tasks/${taskId}/verification`);
  const duplicate = await verification.json();
  expect(duplicate.duplicate_task_count).toBe(0);
  await test.info().attach('evidence', {
    body: Buffer.from(JSON.stringify({
      assertion_id: 'duplicate-task-count', evidence_type: 'backend_query',
      system: 'nupai-store', record_id: taskId, correlation_id: correlationId,
      raw_response: duplicate,
    })),
    contentType: 'application/json',
  });
});
