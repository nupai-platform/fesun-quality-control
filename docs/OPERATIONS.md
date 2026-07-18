# 运行状态、熔断、数据与 Nightly 运维

## 状态机

成功路径固定为：

`RECEIVED → PRECHECKED → RISK_CLASSIFIED → IMPACT_ANALYZED → TEST_IMPLEMENTED → EXECUTING → EVIDENCE_COLLECTED → VERDICT_COMPUTED → DONE`

终态只有 `DONE / FAIL / BLOCKED / PARTIAL / MANUAL_REVIEW`。执行上限由 `execution-policy.yaml` 和 `execution-gate.ts` 复判：最多 2 次 retry、并发 1、API 200、成本 2 USD、执行 30 分钟、证据等待 15 分钟、最终裁判 45 分钟。retry 后才通过仍归 `FLAKY`，不得 PASS。

## 数据隔离

- 动态记录 ID 必须为 `e2e_<BUG>_<runid>_<uuid>`；STANDARD+ 的 Evidence Gate 会拒绝 namespace 不匹配。
- Run2 使用不同 `QC_RUN_ID` 并由独立 Reporter 落证；Verdict Gate 要求 Run1/Run2 record ID 无交集。
- 清理不参与 PASS 前置条件。失败累加 `cleanup_debt`，超过 100 时环境 BLOCKED。
- 定时清理只允许使用专用 `is_test_data=true` 和 `test_expires_at` 字段：`DELETE FROM <table> WHERE is_test_data = TRUE AND test_expires_at < CURRENT_TIMESTAMP`。禁止 SQL `LIKE 'e2e_%'` 把 `_` 当单字符通配符。
- Production API host 在 collector 内 fail closed；数据库层另用只读 GRANT，形成双门。

## Nightly 失败

Nightly 不依赖影响图，通跑登记脊柱；失败自动创建/更新 `nightly,release-blocking` Issue。

- PR 定向失败：阻塞 PR。
- main 后回归：阻塞 Release，必要时人工决定 revert。
- Nightly 旧问题：不追溯阻塞普通 PR，但一直阻塞 Release。
- 环境健康失败：`BLOCKED/ENVIRONMENT`，不得伪装产品 Bug。
- Flaky：隔离前必须有 owner、Issue、到期时间；超过期限仍失败则移除 quarantine 并阻塞 Release。
- Nightly 发现链断但当日影响图均判不相关：Issue 额外标 `map-gap`，补充 code-impact-map 后才能关闭。
