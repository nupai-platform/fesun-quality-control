# FESUN QC v1.1.1 零遗漏落地台账

状态规则：只有存在代码/配置和机器验证证据时才可勾选。`DEFERRED` 必须写明外部依赖或用户决策，不能冒充完成。

## A. 冻结方案第 1–20 节

- [x] 01 四原则：事实源、机器证据、影响并集、证据契约全部强制执行（`policies/`, Gates, spine validator）。
- [x] 02 v1.0→v1.1 变更：10 个变化均有代码/策略映射（`docs/TRACEABILITY.md`）。
- [x] 03 中央仓库：目录骨架已存在，基线 commit `d3b56c9`。
- [x] 04 Bug Packet：单一 schema、FAST 最小负担、所有等级 Oracle 不缺失。
- [x] 05 风险分级：`max(声明,diff,关键词,系统范围)` 且 AI 只能升不能降。
- [x] 06 证据不可伪造：trusted collector、provenance、hash、Gate 独立复判。
- [x] 07 弱断言：TypeScript AST/静态规则、0 tests、skip/fixme/only、具体值约束。
- [x] 08 反事实：CF-2 trusted replay、CF-1 adapter contract、CF-3 PARTIAL、迁移/跨系统等级限制、相同 test hash、失败签名。
- [x] 09 脊柱地图：结构、owner、覆盖、孤儿检测、治理变更保护。
- [x] 10 CI 分层：PR/main/Nightly/on-demand/Release。
- [x] 11 状态机与熔断：retry、TTL、flaky、预算、告警分类。
- [x] 12 数据隔离：UUID、namespace、cleanup debt、生产写阻断契约。
- [x] 13 唯一门禁：所有 PR 始终产生 `acceptance-gate / final-verdict`。
- [x] 14 双总控：`DEFERRED`——用户 2026-07-18 明确要求总控修复期间不读取、不执行、不接入。
- [x] 15 Nightly 失败处理：自动 Issue、`release-blocking`、环境/产品分类策略和 quarantine 运维契约。
- [x] 16 权限隔离：测试 authoring 白名单与 runtime mutation 检测分离。
- [x] 17 实施路线：Day0、Store 三样板、CRM、Platform/MOS、三脊柱、Nightly。
- [x] 18 明确不做：Dashboard/全页面/每PR四系统/依赖cleanup/关闭分支保护。
- [x] 19 冻结声明：仅 v1.1.1 执行修补，不做 v1.2 重构。
- [x] 20 执行指令：已翻译为本 Spec、九阶段计划和本台账。

## B. Day 0 原始清单

- [x] `bug-packet.schema.json`
- [x] `evidence-event.schema.json`
- [x] `verdict.schema.json`
- [x] `playwright-evidence-reporter.ts`
- [x] `classify-risk.ts`
- [x] `detect-weak-assertions.ts`
- [x] `detect-business-code-change.ts`
- [x] `evidence-gate.ts`
- [x] `verdict-gate.ts`
- [x] `reusable-pr-gate.yml`
- [x] Store FAST/STANDARD/CROSS_SYSTEM 示例 Bug Packet

## C. 可信执行补丁

- [x] Source/Oracle 内容哈希与审批字段。
- [x] 所有风险级别至少一条 assertion。
- [x] Evidence provenance 与 raw payload hash。
- [x] trusted HTTP GET probe；attachment 不得单独满足核心 Oracle。
- [x] assertion 覆盖数、独立 source、重复 source、类型严格比较。
- [x] Playwright JSON 真结构、0 tests、flaky/skipped 检查。
- [x] runtime mutation baseline/after 检查。
- [x] 反事实 test hash + failure signature。
- [x] Staging 指纹、production denylist、read-only 方法限制。
- [x] artifact 脱敏/retention/访问规则。
- [x] 完整 SHA pin、命名 secrets、最小权限。
- [x] 成本上限、并发上限、API 调用上限。

## D. Store 三样板

- [x] FAST：纯 UI 文案/样式，Oracle 明确，轻量 Gate。
- [x] STANDARD：保存后刷新，UI + trusted backend probe，两轮通过。
- [x] CROSS_SYSTEM：Store→Platform 契约、CF-2、Nightly segment。
- [x] 攻击测试：伪造 evidence attachment。
- [x] 攻击测试：0 tests / 0 evidence。
- [x] 攻击测试：错误 provenance / packet hash。
- [x] 攻击测试：生产 URL 误配。
- [x] 攻击测试：测试运行期业务代码 mutation。

## E. CI 与接入

- [x] Reusable PR Gate。
- [x] Reusable main regression。
- [x] Reusable nightly spines。
- [x] Reusable on-demand E2E。
- [x] Reusable release Gate。
- [x] Caller 模板始终运行 final-verdict。
- [x] CRM adapter/caller（模板已落地，外部 pin/secret 待真账）。
- [x] Store adapter/caller（模板已落地，外部 pin/secret 待真账）。
- [x] MOS adapter/caller（模板已落地，目标仓库确认为 `nupai-platform/fesun-mos`；外部 pin/secret 待真账）。
- [x] Platform adapter/caller（模板已落地，外部 pin/secret 待真账）。
- [ ] GitHub Rules、Environment、只读 secrets 配置真账（DEFERRED：需四个业务仓库管理员与真实 Staging 凭据）。

## F. 验证与发布

- [x] TypeScript 严格类型 0 error。
- [x] 单元测试 0 fail，核心 Gate 行覆盖 86.8%、函数覆盖 83.3%（阈值 80%）。
- [x] 集成/CLI 自测 0 fail。
- [x] 供应链审计 0 high/critical。
- [x] 方案逐条对照全部有证据。
- [ ] Qwen 独立审查 PASS（DEFERRED：外部审查尚未执行）。
- [ ] DeepSeek 独立审查 PASS（DEFERRED：外部审查尚未执行）。
- [ ] PR CI 全绿且 review threads 全部 resolved（DEFERRED：需业务仓库接入后产生真实 PR 运行）。
- [ ] 先 shadow 三样板，无 false allow/deny（DEFERRED：需四系统 Staging 与业务仓库）。
- [ ] 管理员批准后切 enforce，并固定不可变 release 引用（DEFERRED：需管理员批准；模板保留 `__QC_COMMIT_SHA__` 占位）。

## G. 自动落地顺序补充

- [x] MOS 空壳仓库排除：不使用 `houzhenying226-jpg/nupai-mos-ui`。
- [x] MOS 真实仓库确认：使用 `nupai-platform/fesun-mos`。
- [ ] 四仓库 acceptance Packet/spec scaffold 存在且不是空测试。
- [ ] 候选测试与 trusted `final-verdict` 的凭据边界在真实 workflow run 中验证。
- [ ] Shadow 通过标准：FAST/STANDARD/CROSS_SYSTEM 各一条，正确样例 PASS、错误样例 FAIL、缺环境 BLOCKED，且 artifact/provenance 齐全。
- [ ] Shadow 失败回滚：Ruleset 保持 Evaluate，Caller PR 可撤回，既有 Classic 保护不删除。
