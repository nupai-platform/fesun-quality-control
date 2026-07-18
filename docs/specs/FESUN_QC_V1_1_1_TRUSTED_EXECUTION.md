# Spec: FESUN 四系统可信开发验收内核 v1.1.1

## 0. 蓝图对齐

- 蓝图：`FESUN 四系统可信开发验收方案 v1.1（冻结执行版）`，2026-07-18。
- 定位：中央治理仓库，不是第五个业务系统。
- 触发：业务仓库 PR、main 合并后、Nightly、按需 E2E、Release。
- 留白决策：只修执行层缺口，不做 v1.2 方法论重构。
- 总控边界：本轮不读取、不执行、不更新 KG/Commander 总控。

## 1. 当前状态

Day 0 与可信执行补丁已在本仓库落地；`npm run verify` 是可重复的本地证明入口。双总控按用户指令保持不读取、不执行、不接入。四个业务仓库的真实 Environment、只读账号、Ruleset 和 SHA caller pin 仍在外部真账中标为未核验，见 `docs/GITHUB_SETUP.md`。

## 2. 用户剧本

角色：四系统开发者、Reviewer、发布负责人。

1. 开发者从业务仓库 PR 页面看到唯一 `acceptance-gate / final-verdict`。
2. Gate 从 Bug Packet 读取不可缺失的事实源、Oracle 和风险声明。
3. 候选代码在无特权测试 Job 中运行，机器收集 Playwright 结果和原始证据。
4. 受保护的治理内核独立校验风险、断言、证据覆盖、反事实和回归范围。
5. Reviewer 在同一 PR 查看 PASS/FAIL/BLOCKED/PARTIAL、失败分类和 artifact 哈希。
6. 只有 PASS 才允许合并；main/Nightly/Release 各自继续执行对应回归层。

成功标准：不需要手工解释 AI 报告；任何缺证据、伪造、跳过、环境误配或 Gate 漂移都 fail-closed。

## 3. 必须做

- [x] FAST/STANDARD/CRITICAL/CROSS_SYSTEM 都必须有至少一条明确 Oracle assertion。
- [x] Bug 来源与 Oracle 必须带稳定来源标识和内容哈希。
- [x] Evidence 必须绑定 run/repo/base/head/qc/packet/test/environment/correlation provenance。
- [x] Playwright attachment 仅作 supporting evidence；核心后端 Oracle 必须由 trusted probe 复查。
- [x] Packet 每条 assertion 必须满足规定的独立证据源数量，缺失或重复映射不得 PASS。
- [x] Playwright 0 tests、skip/fixme/only、flaky、missing report 均不得 PASS。
- [x] 区分“候选 PR 合法业务改动”和“测试运行期间工作树篡改”。
- [x] 反事实绑定同一 test hash 和目标失败签名；CF-2 已有 trusted replay，CF-1 留系统 adapter 契约。
- [x] 生产 URL/环境指纹不匹配时，在任何请求前 BLOCKED。
- [x] 测试数据使用 run UUID/namespace；cleanup debt 有阈值，不能无限累积。
- [x] Reusable workflow 与 Actions 固定完整 commit SHA；只接收命名 secrets。
- [x] 实现 PR/main/nightly/on-demand/release 五层 workflow 和唯一 final-verdict 聚合。
- [x] Store FAST/STANDARD/CROSS_SYSTEM 三样板全部具备正例、反例和防伪测试。
- [x] 状态机、retry、TTL、成本和并发预算可机器校验。
- [x] 所有方案条目在实现台账有唯一映射和证据，不允许口头完成。

## 4. 禁止做

- [x] 禁止候选 PR 覆盖或动态选择治理 Gate 版本。
- [x] 禁止 `@main`、可移动 tag 或宽泛 `secrets: inherit`。
- [x] 禁止把测试自带的布尔字段、Toast、200 或单张截图作为最终 Oracle。
- [x] 禁止 0 tests/0 evidence 的空集真值通过。
- [x] 禁止字符串化比较掩盖类型错误。
- [x] 禁止用整个 PR diff 代替测试运行前后 mutation 检测。
- [x] 禁止生产写入、生产 host fallback、默认 localhost 静默替代 Staging。
- [x] 禁止清理任务使用可能误匹配的 `LIKE 'e2e_%'` 模式。
- [x] 禁止 Nightly 红灯无限 quarantine；必须有 owner、期限和 release 阻断。
- [x] 禁止接入或执行当前正在修复的 KG/Commander 总控。

## 5. 数据流与信任边界

```text
Owner/System source -> Bug Packet + Oracle hash
Candidate PR -> unprivileged Playwright run -> report + supporting attachment
Protected QC ref -> trusted read-only probe -> backend raw evidence
Protected QC ref -> schema/evidence/risk/counterfactual/regression gates
Protected QC ref -> verdict.json + final-verdict check
AI -> may read verdict and write explanation only
```

## 6. 验收标准

1. 正确样板 PASS；业务字段错误 FAIL；缺环境 BLOCKED；证据不足 PARTIAL/FAIL 且不得合并。
2. 伪造 attachment、缺 evidence、重复 assertion_id、错误 provenance、0 tests 全部被拒绝。
3. 正常 Bug 修复 PR 可包含业务代码；测试执行后产生未提交业务代码修改会被拒绝。
4. FAST 缺 assertion 无法通过 schema/risk gate。
5. Gate/Reporter/Workflow 的最终引用为完整 SHA，调用模板无 `secrets: inherit`。
6. 同一 test bundle hash 在 fixed 通过、baseline 命中目标失败签名。
7. PR/main/nightly/on-demand/release workflow 均能静态校验，唯一 Required Check 始终产生结论。
8. `npm run typecheck`、单元/集成/攻击性自测、供应链审计全部通过。
9. Qwen 与 DeepSeek 对同一最终内容均给出 PASS。

## 7. 风险

- 新建后端接口：否；中央工具只读取测试/仓库/HTTP Oracle。
- 数据库变更：否；仅定义业务系统应使用的测试数据隔离契约。
- 权限变更：是；CI secrets、environment 和 branch protection 需仓库管理员后续配置。
- 外部依赖：四系统 Staging、只读测试账号、GitHub Rules/Environment、飞书告警。
