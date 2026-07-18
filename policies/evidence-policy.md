# 证据政策 v1.1.1（可信来源与独立复判）

## 数据流

```
Playwright 运行（无特权）
   → artifacts/report.json                         (Playwright 官方 JSON reporter)
   → artifacts/evidence-raw/*.json                 (Reporter 封装 supporting attachment)
   → artifacts/reporter-summary.json               (status/retry/test hash)
Trusted read-only probe（受保护 QC 代码）
   → artifacts/evidence-trusted/*.json             (独立后端查询)
        ↓
evidence-gate.ts  (格式合法性 + 禁判定字段黑名单)
        ↓
verdict-gate.ts   (独立复判 → artifacts/verdict.json)
        ↓
GitHub Required Check 只读 verdict.json.merge_allowed
```

AI 只能读 `verdict.json` 写人类报告 `report.md`。候选测试提供的 attachment 永远标记为 `playwright_attachment`，不能冒充 `trusted_http_probe`，也不能单独满足要求可信后端复判的 Oracle。

每条 evidence 必须绑定 `run_id/repo/base_sha/head_sha/qc_sha/packet_sha256/test_sha256/environment_id/correlation_id`，并包含原始响应哈希。任一身份或哈希不一致即拒绝。

## 证据里禁止出现的判定字段

候选 attachment 禁止 `verdict / merge_allowed / backend_verified / pass / passed / collector_kind / provenance`。Reporter 会拒绝所有未列入候选契约的字段，再由机器注入 `collector_kind/provenance/hash`；封装后的 Evidence Event 必须含这些机器字段。

## 测试如何落证据

```ts
const res = await request.get(`/api/tasks/${taskId}`);
const body = await res.json();
await test.info().attach('evidence', {
  body: Buffer.from(JSON.stringify({
    assertion_id: 'store.task.status',
    evidence_type: 'network_response',
    system: 'nupai-store',
    record_id: taskId,
    correlation_id: correlationId,
    raw_response: body            // 原样,不加工
  })),
  contentType: 'application/json'
});
expect(body.status).toBe('completed');   // 断言具体值
```

## 第二独立证据源

核心结果至少两个独立 collector 一致，其中后端 Oracle 至少一个必须是 `trusted_http_probe` 或 `contract_replay`。单一 Toast、单一 200、单张截图、单一测试 attachment 均不足以判 PASS。

## 隐私与保留

Reporter 和 probe 在落盘前按 `execution-policy.yaml` 对敏感键递归脱敏。证据 artifact 最长保留 14 天；不得上传凭据、Cookie、Authorization、客户明文 PII 或生产数据全集。
