# CF-1 系统适配器契约

通用内核自动执行 CF-2 trusted contract replay。CF-1 依赖各业务系统如何从旧 commit 启动，因此不能用一个假通用命令冒充完成；业务 adapter 必须产生同一 `counterfactual.schema.json`。

适配器必须在隔离 worktree/container 中：

1. 固定 `base_commit` 与 `fixed_commit`，从当前 PR 复制完全相同的测试文件；先计算 `test_sha256`。
2. 旧 commit 运行必须失败且命中 Packet 的 `expected_failure_signature`。
3. fixed commit 同一测试必须通过；测试 hash 不同立即 BLOCKED。
4. 禁止在当前分支临时改回旧错误；临时 worktree 使用随机临时目录并在任务结束回收。
5. 输出 `schema_version/level/baseline_failed/fixed_passed/test_sha256/observed_failure_signature/reason_code`；Verdict Gate 会再次校验。

未安装系统 CF-1 adapter 的 CRITICAL Packet 必须 BLOCKED，不能降级为 PASS。跨系统/迁移默认走 CF-2；CF-3 最高 PARTIAL、不可合并。
