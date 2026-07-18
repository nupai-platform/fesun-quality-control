# v1.1.1 按方案落地步骤

这是执行顺序与证据索引；每一步都必须在台账中打勾，外部依赖保持 `DEFERRED`，不以口头完成替代。

1. **冻结边界** — [x] 读取冻结方案与执行 Spec，明确中央仓库定位；双总控按用户指令跳过。证据：`BLUEPRINT-INDEX.md`、台账 A-14。
2. **事实源与 Schema** — [x] Packet、Evidence、Verdict、Counterfactual、Execution、Spine/Impact Schema；来源/Oracle/assertion hash。证据：`schemas/`、`validate-packet.ts`。
3. **机器取证** — [x] Reporter 只封装候选 supporting evidence；trusted GET 与 CF-2 replay 在受保护 QC Job 执行；raw hash、event hash、完整 provenance、脱敏。证据：`reporters/`、`collect-oracle-evidence.ts`、`run-counterfactual.ts`。
4. **独立门禁** — [x] 风险单调升级、AST 弱断言、PR authoring 与 runtime mutation 分离、Evidence Gate、Execution Gate、唯一 Verdict。证据：`scripts/`、`verdict.schema.json`。
5. **影响范围治理** — [x] spine/owner/code-impact Schema、segment 覆盖、contract 复用、孤儿集成、治理变更保护。证据：`spine/`、`validate-spine-maps.ts`、`detect-governance-change.ts`。
6. **CI 分层** — [x] PR/main/Nightly/on-demand/Release；candidate 与 trusted final-verdict 分 Job；Action 完整 SHA、命名 secrets、失败告警。证据：`.github/workflows/`、`templates/`、`emit-alert.ts`。
7. **Store 三样板与攻击测试** — [x] FAST/STANDARD/CROSS_SYSTEM Packet/Spec；错误 Oracle、伪造字段、错误 provenance、0 tests、production URL、mutation 均有自动测试。证据：`examples/`、`tests/`、`selftest.ts`。
8. **验证与审计** — [x] `npm run verify`：lint、strict typecheck、地图/Workflow 校验、覆盖率、24 项单测、CLI 自测、npm audit 0 high/critical。
9. **外部接入放行** — [ ] DEFERRED：四个业务仓库的 Staging Environment、五类 secrets、只读数据库/API、Ruleset、Caller full SHA、Shadow→Enforce 需要管理员和真实环境。仓库映射已确认：CRM=`houzhenying226-jpg/nupai-crm`、Store=`nupai-platform/-nupai-store`、MOS=`nupai-platform/fesun-mos`、Platform=`nupai-platform/fesun-platform`。证据账：`docs/GITHUB_SETUP.md`。
   - 候选 Job 只接收非特权 Staging 测试账号；`E2E_READ_TOKEN` 与数据库只读凭据只进入受保护 `final-verdict` Job。
   - Shadow 通过标准：FAST、STANDARD、CROSS_SYSTEM 各一条 PR；正确样例 PASS、业务值错误 FAIL、环境缺失 BLOCKED；`verdict.json`、`evidence-gate.json`、`reporter-summary.json` 与 provenance 齐全且无 false allow/deny。
   - 回滚：Shadow 失败时保持 Ruleset Evaluate、撤回 Caller PR；不删除既有 Classic 保护，不触碰生产环境。
10. **双总控接入** — [ ] DEFERRED：用户明确要求总控修复期间不读取、不执行、不接入；恢复后另行审批，不属于本次执行范围。
