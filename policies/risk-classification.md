# 风险分级政策 v1.1.1

`final_risk = max(declared, diff paths, description keywords, affected systems)`。任何主体只能升高风险，不能降低机器推断。

## 路径最低风险

| 路径 | 最低风险 |
|---|---|
| migrations、schema、permissions、auth、payments、money、delete | CRITICAL |
| integrations、consumers、sync、webhooks、queues | CROSS_SYSTEM |
| services、events、status/state machine、shared | CRITICAL |
| api、models、config、workflow、feature flags | STANDARD |

无法读取 diff、SHA 不存在、base/head 不可比较时不得默认为 FAST；应 BLOCKED。

## 业务范围

`affected_contracts` 出现两个及以上系统前缀时至少为 CROSS_SYSTEM。风险分类只决定测试深度，不能取消事实源、Oracle、provenance 或唯一 final-verdict。
