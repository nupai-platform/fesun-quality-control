# v1.1 冻结方案追溯表

| 方案变化 | 落地点 |
|---|---|
| AI 声明改机器物证 | Reporter、trusted collector、Evidence/Verdict Gate |
| 所有等级单一 Packet | `bug-packet.schema.json`、内容 hash、三样板 |
| 风险只能升 | `classify-risk.ts = max(声明,diff,关键词,系统范围)` |
| 弱断言硬禁 | TypeScript AST + 静态规则 + 0 tests fail closed |
| 反事实三级 | Packet replay、trusted CF-2、CF-1 adapter contract、CF-3 PARTIAL |
| 脊柱影响并集 | Spine/impact Schema、owner/coverage validator、orphan scanner |
| CI 分层 | PR/main/Nightly/on-demand/Release 五个 reusable workflows |
| 状态机与熔断 | execution policy/schema/gate、预算/TTL/retry/flaky |
| 数据隔离 | namespace、Run2 新 UUID、自证 record、cleanup debt、production denylist |
| 唯一 Required Check | caller `acceptance-gate` + called `final-verdict` |

方案第 14 节双总控为唯一显式暂停项：用户在 2026-07-18 指定总控修复中，不读取、不执行、不接入。此处只记录，不以“完成”冒充。
