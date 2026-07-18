# 反事实验证政策 v1.1

在允许 PASS 前,CRITICAL 与 CROSS_SYSTEM 必须证明"测试本身能识别旧错误",否则测试无效。

## 分级与降级

```
CF-1  旧 commit worktree 跑同一核心测试 → 必须 FAIL,且失败原因命中原 Bug
CF-2  契约级:构造修复前的错误 payload 喂消费端 → 必须被拒绝(如 422)
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
  "level": "CF-2",
  "old_test_failed_as_expected": true,
  "reason_code": "cross_system",
  "detail": "旧 payload 缺 order_id,Platform 返回 422"
}
```

verdict-gate 读取该文件:`old_test_failed_as_expected !== true` 且非 CF-3 → 阻止 PASS。
