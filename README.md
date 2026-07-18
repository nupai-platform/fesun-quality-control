# FESUN Quality Control v1.1.1

CRM / Store / MOS / Platform 的可信开发验收内核。它不是第五个业务系统；候选测试负责操作，受保护机器代码负责取证、复判和阻止虚假通过。

## 可信链路

```text
Bug Packet（来源与 Oracle hash）
  → 风险 max(声明, diff, 关键词, 系统范围)
  → candidate Playwright（官方 report + supporting attachment）
  → trusted read-only GET Oracle / CF-2 replay
  → Packet / Evidence / Execution / Mutation / Weak Assertion Gates
  → verdict-gate.ts（唯一裁判）
  → acceptance-gate / final-verdict（唯一 Required Check）
```

PASS 必须同时满足来源、Schema、完整 SHA provenance、严格类型 Oracle、证据源数量、测试结果、Run2 新数据、反事实和脊柱要求。`PARTIAL/BLOCKED/FAIL` 的 `merge_allowed` 恒为 false。

## 本地验证

```bash
npm ci
npm run verify
```

`verify` 执行 ESLint、严格 TypeScript、脊柱/Workflow 校验、覆盖率门槛、完整 CLI 攻击自测和 high 级供应链审计。攻击自测覆盖：伪造 verdict、错误 provenance、错误 Oracle、0 tests、production URL、运行期业务代码 mutation。

## 目录

- `policies/`：冻结验收、证据、反事实、执行策略。
- `schemas/`：Packet、Evidence、Verdict、Counterfactual、Execution、Spine/Impact Schema。
- `scripts/`：风险、取证、反事实、门禁、地图和自测。
- `reporters/`：将候选 attachment 封装为 provenance-bound Evidence Event。
- `spine/`：脊柱、代码影响、Owner。
- `examples/`：Store FAST / STANDARD / CROSS_SYSTEM 三样板。
- `.github/workflows/`：PR/main/Nightly/on-demand/Release 五层 CI。
- `templates/`：四系统 Caller 与分层回归模板。
- `docs/`：执行 Spec、零遗漏台账、外部设置真账和运维说明。

## 接入边界

业务仓库从 `templates/adapters/` 复制对应 Caller，只能用经过审查的完整 40 位 QC commit；禁止 `@main`、tag、动态 `qc_ref` 和 `secrets: inherit`。真实 Environment、只读账号与 Ruleset 按 `docs/GITHUB_SETUP.md` 配置并保留真账。

v1.1 已冻结；只接受脚本缺陷修复、系统适配器和 spine/contract 增量。当前按用户指令完全跳过双总控接入。
