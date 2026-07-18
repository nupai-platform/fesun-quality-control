# 五层 CI 执行矩阵

| 层 | 文件 | 固定职责 | 时间上限 |
|---|---|---|---|
| PR | `reusable-pr-gate.yml` | Bug 定点、契约、弱断言、runtime mutation、Oracle、唯一 Verdict | 45m |
| main | `reusable-main-regression.yml` | 受影响系统与相邻片段 | 30m |
| Nightly | `reusable-nightly-spines.yml` | 全部登记关键脊柱、影响图反向兜底、失败 Issue | 120m |
| on-demand | `reusable-on-demand-e2e.yml` | `run-e2e`/人工触发的完整跨系统路径 | 120m |
| Release | `reusable-release-gate.yml` | Nightly 前置、全部脊柱、权限、迁移、Oracle 抽查 | 180m |

PR 的 candidate Job 运行候选测试代码，仅拿最小 Staging 测试账号；`final-verdict` Job 在受保护 Environment 中执行不可变 QC commit，才拿独立只读 token。两者用短期 GitHub Artifact 交接，最终证据保留 14 天。
