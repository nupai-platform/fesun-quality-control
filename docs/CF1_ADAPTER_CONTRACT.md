# CF-1 系统适配器契约

通用内核自动执行 CF-2 trusted contract replay。CF-1 依赖各业务系统如何从旧 commit 启动，因此不能用一个假通用命令冒充完成；业务 adapter 必须产生同一 `counterfactual.schema.json`。

适配器必须在隔离 worktree/container 中：

1. 固定 `base_commit` 与 `fixed_commit`，从当前 PR 复制完全相同的测试文件；先计算 `test_sha256`。
2. 旧 commit 运行必须失败且命中 Packet 的 `expected_failure_signature`。
3. fixed commit 同一测试必须通过；测试 hash 不同立即 BLOCKED。
4. 禁止在当前分支临时改回旧错误；临时 worktree 使用随机临时目录并在任务结束回收。
5. 输出 `schema_version/level/baseline_failed/fixed_passed/test_sha256/observed_failure_signature/reason_code`；Verdict Gate 会再次校验。

## 调用约定

业务仓库 caller 必须显式声明 `cf1_adapter` 与 `cf1_test_path`。当前内核已安装的适配器：

- `nupai-crm`：在 trusted QC job 中为 base/fixed commit 建立隔离 worktree，复制同一 Playwright 测试和固定验收 harness，分别构建前端并运行测试；该适配器不接收任何 E2E Secret。

未声明适配器、路径越界、commit 不可解析、旧版本未命中预期失败签名或 fixed 版本未通过时，适配器必须失败，不能生成 PASS 产物。

未安装系统 CF-1 adapter 的 CRITICAL Packet 必须 BLOCKED，不能降级为 PASS。跨系统/迁移默认走 CF-2；CF-3 最高 PARTIAL、不可合并。
