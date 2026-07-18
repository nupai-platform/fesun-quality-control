# 反事实验证政策 v1.1.1

在允许 PASS 前,CRITICAL 与 CROSS_SYSTEM 必须证明"测试本身能识别旧错误",否则测试无效。

## 分级与降级

```
CF-1  旧 commit worktree 跑同一 test bundle hash → 必须 FAIL,且失败签名命中原 Bug
CF-2  producer/consumer 契约回放 → 旧 producer payload 必须命中预先声明的失败签名
CF-3  用修复前 trace / 日志 / 截图证明断言会命中旧错误
```

自动降级规则:

```
diff 触及 migrations/ 或 schema.prisma      → 禁止 CF-1,走 CF-2
跨系统(≥2 系统)                            → 默认 CF-2,不做四系统全环境回滚
CF-2 不适用(旧版无法启动/环境不存在)        → 降 CF-3 + reason_code
CF-3                                        → 最高 PARTIAL,除非 owner 签字提升
```

## 安全约束

- 禁止在当前修复分支临时恢复旧错误代码后提交。
- CF-1 使用独立 worktree:
  ```bash
  git worktree add /tmp/e2e-old-$BUG_ID  $BASE_COMMIT
  git worktree add /tmp/e2e-fixed-$BUG_ID $FIXED_COMMIT
  ```
- 完成后删除临时 worktree,确保工作区无遗留错误代码。

## 产物

反事实结果写入 `artifacts/counterfactual.json`:

```json
{
  "schema_version": 1.1,
  "level": "CF-2",
  "baseline_failed": true,
  "fixed_passed": true,
  "test_sha256": "<same hash used for baseline and fixed>",
  "observed_failure_signature": "HTTP_422_MISSING_ORDER_ID",
  "reason_code": "cross_system"
}
```

verdict-gate 按 `counterfactual.schema.json` 核对 `baseline_failed/fixed_passed/test_sha256/observed_failure_signature`；`test_sha256` 必须与当前 Reporter 记录的同一测试文件一致。仅证明“消费端会拒绝任意坏 payload”不构成修复反事实。CF-3 只产出 `PARTIAL` 且 `merge_allowed=false`。
