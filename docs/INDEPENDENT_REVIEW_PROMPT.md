# Qwen / DeepSeek 独立审查操作卡

这两次审查必须由两个独立模型分别完成；不要把第一个模型的结论复制给第二个模型。审查输入固定为同一个 QC release SHA、`docs/IMPLEMENTATION_PLAN.md`、`docs/IMPLEMENTATION_CHECKLIST_v1.1.1.md`、`schemas/`、`scripts/`、`reporters/`、`.github/workflows/`、`examples/` 和 `npm run verify` 输出。

## 提示词

```text
你是独立安全审查员。请审查 FESUN QC v1.1.1 release SHA：<FULL_40_CHAR_SHA>。
禁止执行 KG/Commander 总控。只审查本仓库的机器代码、Schema、策略、Workflow、样板和测试输出。

请逐条检查：
1. 是否存在 AI 可以自填并导致 PASS 的字段或路径；
2. Reporter、trusted Oracle、CF-2、provenance/hash 是否能被候选测试伪造；
3. 0 tests、skip/fixme/only、flaky、错误类型、错误 Packet hash、生产 URL、业务代码 mutation 是否 fail closed；
4. PR/main/Nightly/on-demand/Release、唯一 final-verdict、Actions SHA pin、Secrets 隔离是否完整；
5. 脊柱/owner/contract/segment/orphan 规则是否会漏检；
6. 证据 retention、PII 脱敏、只读账号、namespace/Run2/cleanup debt 是否真实可执行。

输出格式只能是：
- PASS / FAIL / BLOCKED
- 发现的问题：每条包含文件、行号、攻击路径、严重性
- 必须修复项
- 可以接受的外部依赖
- 你没有验证到的内容
不要因为文档声明而通过；只接受代码和测试证据。
```

## 归档

将两份原始报告保存为 `docs/reviews/qwen-<sha>.md` 和 `docs/reviews/deepseek-<sha>.md`，由 CODEOWNER review。任一模型 FAIL/BLOCKED 时，不得切 Enforce；修复后必须用新 SHA 重审。
