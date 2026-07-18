import { expect, test } from '@playwright/test';

test('STO-190 FAST: 详情按钮显示精确文案', async ({ page }) => {
  await page.goto(`${process.env.STORE_E2E_BASE_URL!}/orders`);
  const label = await page.getByTestId('order-detail-button').textContent();
  expect(label).toBe('查看详情');
  await test.info().attach('evidence', {
    body: Buffer.from(JSON.stringify({
      assertion_id: 'order-detail-label', evidence_type: 'reload_state',
      system: 'nupai-store', record_id: 'order-detail-button',
      correlation_id: crypto.randomUUID(), raw_response: { label },
    })),
    contentType: 'application/json',
  });
});
