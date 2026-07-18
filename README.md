# fesun-quality-control

FESUN 四系统(CRM / Store / MOS / Platform)可信开发验收内核 **v1.1**。
中央治理仓库,不是第五个业务系统。核心原则:

> **AI 负责理解、规划、编写、分析;机器负责隔离、执行、取证、判定、阻止虚假通过。**
> **凡是能由代码验证的规则,都不要求 AI 记住;凡是决定 PASS 的条件,都不让执行测试的 AI 自己裁决。**

## 目录

```
policies/     验收宪法(长期规则,不随每个 Bug 发送)
schemas/      bug-packet / evidence-event / verdict 三个 JSON Schema
spine/        脊柱地图 + 代码影响映射 + owner
scripts/      风险分级 / 弱断言 / 业务代码修改 / 孤儿集成 / 证据闸门 / 唯一裁判 / 自测
reporters/    Playwright evidence reporter(机器落原始证据)
templates/    业务仓库调用模板
examples/     Store STO-186 Bug Packet + 定点测试模板
.github/      reusable-pr-gate.yml(锁 @v1.1.0)
```

## 快速开始

```bash
npm install
npm run typecheck      # 类型检查
npm run selftest       # 自测:证明"物证反推"生效(PASS/FAIL/伪造拒绝三场景)
```

## 证据不可伪造数据流

```
Playwright → report.json + evidence-raw/*.json + reporter-summary.json  (机器)
   → evidence-gate.ts  (格式 + 禁判定字段黑名单)
   → verdict-gate.ts   (对照 bug-packet 独立复判 → verdict.json)
   → GitHub Required Check 只读 verdict.json.merge_allowed
```

AI 无权写入 `verdict.json / report.json / evidence-raw`。

## 风险分级

`final_risk = max(声明, diff 路径推断, 关键词推断)`,AI 只能升不能降。
FAST(2–5min)/ STANDARD / CRITICAL / CROSS_SYSTEM / MANUAL_REVIEW。

## 业务仓库接入(4 步)

1. 复制 `templates/caller-acceptance-gate.yml` → 本仓库 `.github/workflows/acceptance-gate.yml`,改 `project`。
2. 在 `testing/acceptance/bugs/<BUG-ID>/` 放 `bug-packet.yaml` + `<BUG-ID>.spec.ts`(参考 examples)。
3. `playwright.config.ts` 启用 evidence reporter,配 `retries/trace/screenshot`。
4. 仓库 Settings → Rules 把 `acceptance-gate / final-verdict` 设为合并必需。

## 冻结

v1.1 即日冻结。仅允许:修脚本 bug、增系统适配器、增 spine/contract 映射。
禁止 v1.2 方法论大重构。
