# 证据政策 v1.1(证据不可伪造)

## 数据流

```
Playwright 运行
   → artifacts/report.json            (Playwright 官方 JSON reporter,机器)
   → artifacts/evidence-raw/*.json     (Evidence Reporter 落原始响应体,机器)
   → artifacts/reporter-summary.json   (每条测试 status/retry,机器)
        ↓
evidence-gate.ts  (格式合法性 + 禁判定字段黑名单)
        ↓
verdict-gate.ts   (独立复判 → artifacts/verdict.json)
        ↓
GitHub Required Check 只读 verdict.json.merge_allowed
```

AI 只能读 `verdict.json` 写人类报告 `report.md`;**无权写入** `verdict.json / report.json / evidence-raw / reporter-summary.json`。

## 证据里禁止出现的判定字段

`verdict / merge_allowed / backend_verified / reload_verified / reentry_verified / second_evidence_verified / pass / passed`。
出现即视为 AI 自报判定 → evidence-gate FAIL。

## 测试如何落证据

```ts
const res = await request.get(`/api/tasks/${taskId}`);
const body = await res.json();
await test.info().attach('evidence', {
  body: Buffer.from(JSON.stringify({
    evidence_type: 'backend_query',
    system: 'nupai-store',
    record_id: taskId,
    asserted_field: 'status',
    expected_from_packet: 'completed',
    raw_response: body            // 原样,不加工
  })),
  contentType: 'application/json'
});
expect(body.status).toBe('completed');   // 断言具体值
```

## 第二独立证据源

核心结果至少两个独立证据源一致(如 UI + 查询 API、当前页 + 刷新后、系统 A + 系统 B、写响应 + 后续 GET)。单一 Toast / 单一 200 / 单张截图不足以判 PASS。
