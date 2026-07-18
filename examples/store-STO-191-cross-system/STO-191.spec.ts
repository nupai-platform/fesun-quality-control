import { expect, test } from '@playwright/test';

test('STO-191 CROSS_SYSTEM: Store 完成态同步至 Platform', async ({ request }) => {
  const taskId = `e2e_STO_191_${process.env.QC_RUN_ID!}_${crypto.randomUUID()}`;
  const correlationId = crypto.randomUUID();
  const response = await request.get(
    `${process.env.PLATFORM_E2E_BASE_URL!}/api/progress/by-store-task/${taskId}`,
  );
  const body = await response.json();
  expect(response.status()).toBe(200);
  expect(body.progress_status).toBe('measurement_completed');
  await test.info().attach('evidence', {
    body: Buffer.from(JSON.stringify({
      assertion_id: 'platform-progress-status', evidence_type: 'cross_system_query',
      system: 'fesun-platform', record_id: taskId, correlation_id: correlationId,
      raw_response: body,
    })),
    contentType: 'application/json',
  });
});

test('STO-191 CF-2: 缺少 order_id 的旧 payload 必须被拒绝', async ({ request }) => {
  const response = await request.post(
    `${process.env.PLATFORM_E2E_BASE_URL!}/api/events/measurement-completed/validate`,
    { data: { taskStatus: 'done' } },
  );
  expect(response.status()).toBe(422);
  expect((await response.json()).code).toBe('MISSING_ORDER_ID');
});
