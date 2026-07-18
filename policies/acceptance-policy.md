# FESUN 验收政策 v1.1(治理宪法)

> 本文件是长期规则,不随每个 Bug 发送给 AI。测试 Agent 每次只接收短指令 + Bug Packet + 本政策链接。

## 四条不可动摇原则

1. **事实不能由 AI 自填。** Bug 原始描述、预期业务结果、Oracle 必须有人类或系统来源。缺 `original_description` 或(非 FAST 时)`expected_business_result` → `BLOCKED`。
2. **证据不能由 AI 自报。** Verdict Gate 只信:Playwright JSON reporter、exit code、后端原始响应体、network trace、git diff。AI 写的布尔字段不作为任何 Gate 输入。
3. **影响范围不能由 AI 单独决定。** `spine-map + code-impact-map + AI 补充` 取并集,AI 只能加不能减。
4. **Definition of Done = 证据契约。** 需求来源 + 代码 + 曾能失败的测试 + Oracle + 上下游通过 + 机器 Gate 放行,才从 `Implemented → Verified → Done`。

## 结论标准

| 结论 | 条件 |
|---|---|
| PASS | 原 Bug 场景自动覆盖 + 后端字段匹配 + 刷新/重进正确 + 两独立证据一致 + 所需回归通过 + STANDARD+ 连续两次通过 + CRITICAL+ 反事实成立 + 无未解释异常 |
| FAIL | 产品仍错 / 链条回归失败 / 跨系统不一致 / 重复数据 / 状态回退 / 改了业务代码 / 弱断言 / 孤儿集成 |
| BLOCKED | 环境、账号、权限、依赖服务导致核心验证无法开始;或缺事实源 |
| PARTIAL | 完成部分真实验证,但缺后端 / 跨系统 / 反事实 / 关键回归 |

## 禁止修改范围(测试 Worker)

只允许改:`testing/**`、`playwright/**`、`playwright.config.*`、`docs/testing/**`。
禁止改:`src/** app/** backend/** migrations/** services/** models/** events/** schema.prisma`。
命中禁止路径 → `TEST_WORKER_MODIFIED_BUSINESS_CODE` → FAIL。

## 弱断言禁令(核心业务断言)

禁止:`toBeTruthy / toBeFalsy / toBeDefined`、`expect(res.ok()).toBeTruthy()`、`test.skip / fixme / only`、`expect.soft`、`force:true`、`waitForTimeout` 作主等待。
必须:断言具体值,且值来自 Bug Packet 的 `expected_business_result.assertions`。

## 反事实分级

| 级别 | 方式 | 适用 | 判定上限 |
|---|---|---|---|
| CF-1 | 旧 commit 跑同一测试必须红 | 单系统、无迁移 | 可 PASS |
| CF-2 | 契约级:错误 payload 喂消费端必须红 | 跨系统 / 有迁移 | 可 PASS |
| CF-3 | trace/日志证明断言可命中旧错误 | 环境不可复现 | 最高 PARTIAL(除非 owner 签字) |

diff 触及 `migrations/` 或 `schema.prisma` → 禁止 CF-1,走 CF-2。

## 数据隔离

测试数据带唯一戳 `e2e_<BUG>_<runid>_<uuid>`,不依赖 cleanup;Run2 用全新 UUID;清理失败记 `cleanup_debt` 不阻塞;凌晨 cron 物理删除 72h 前的 `e2e_*`。生产库测试账号仅 `GRANT SELECT`。

## 唯一门禁

四仓库统一 Required Check:`acceptance-gate / final-verdict`。超时 45 分钟自动 FAIL。不按等级设多个 Required Check(防 skipped 永久 pending)。

## 冻结声明

v1.1 即日冻结。后续只允许:修脚本 bug、增系统适配器、增 spine/contract 映射。禁止 v1.2 方法论大重构。
