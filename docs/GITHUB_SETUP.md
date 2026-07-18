# GitHub 接入与外部配置真账

代码仓库只能交付 Gate；Rules、Environment 和真实只读账号必须在四个业务仓库逐项配置并审计。未完成本页真账前只能 Shadow，不能声称 Enforce。

## 每个业务仓库

适用仓库：`houzhenying226-jpg/nupai-crm`、`nupai-platform/-nupai-store`、`nupai-platform/fesun-mos`、`nupai-platform/fesun-platform`。

1. 复制 `templates/adapters/<system>-acceptance-gate.yml` 到 `.github/workflows/acceptance-gate.yml`。
2. 将 `__QC_COMMIT_SHA__` 替换为经过双审的完整 40 位 release commit；禁止 tag、branch 和可变 input。
3. 创建受保护 Environment：`fesun-staging-acceptance`，限制允许分支/审批人。
4. 在 Environment 内配置本系统五个命名 Secret：`*_E2E_BASE_URL`、`*_E2E_USERNAME`、`*_E2E_PASSWORD`、`*_E2E_READ_TOKEN`、`*_E2E_ALLOWED_HOSTS`。
5. `*_E2E_READ_TOKEN` 只能 GET；数据库账号仅授予 `SELECT, SHOW VIEW`。候选测试 Job 永远收不到此 token。
6. Ruleset 对 `main` 开启：禁止 force-push、禁止删除、至少一名 CODEOWNER review、所有 review thread resolved、Required Check `acceptance-gate / final-verdict`。
7. Required Check 不按风险级拆分；PR 缺 Packet、0 tests 或环境失败时同一 Check 必须红/阻塞，不能 skipped/pending。

## 真账字段

| 仓库 | Caller SHA pin | Environment | 5 secrets | DB/API readonly | Required Check | Shadow | Enforce |
|---|---|---|---|---|---|---|---|
| nupai-crm | 未核验 | 未核验 | 未核验 | 未核验 | 未核验 | 未开始 | 未批准 |
| nupai-store | 未核验 | 未核验 | 未核验 | 未核验 | 未核验 | 未开始 | 未批准 |
| nupai-mos | 未核验 | 未核验 | 未核验 | 未核验 | 未核验 | 未开始 | 未批准 |
| fesun-platform | 未核验 | 未核验 | 未核验 | 未核验 | 未核验 | 未开始 | 未批准 |

任何“未核验”都不得在落地台账勾成完成。Enforce 需管理员明确批准；本仓库不会自动降低既有分支保护。

## 当前只读核查结果（2026-07-18）

这是从当前 GitHub 登录账号读取到的事实，不是推测：

| 方案名称 | 当前发现 | 下一步 |
|---|---|---|
| nupai-crm | `houzhenying226-jpg/nupai-crm` 存在；只有 `production` Environment；已有保护但没有 `acceptance-gate / final-verdict` | 新建 `fesun-staging-acceptance`，补 Secrets/Required Check |
| nupai-store | 真实仓库为 `nupai-platform/-nupai-store`（名称带前导连字符） | 在真实仓库补 acceptance 入口、Environment/Rules |
| fesun-mos | `nupai-platform/fesun-mos` 为真实 Python 业务仓库，包含大量测试与 workflow；当前无 `fesun-staging-acceptance`、无 Ruleset | 先补 acceptance Packet/spec 与 Caller，再建 Environment/Rules |
| fesun-platform | `nupai-platform/fesun-platform` 存在；已有 `staging`/`production`；当前 Required Check 只有 `ci-required` | 加验收 Check、CODEOWNER review 和只读 Secrets |

## 小白操作顺序

### 1. 先确认仓库名字

不要给我密码或 Token。只需回复三项：

```text
Store: <owner>/<repo>
MOS: <owner>/<repo>
Platform: <owner>/<repo>
```

### 2. 创建 Staging Environment

进入仓库：`Settings → Environments → New environment`，名称固定为 `fesun-staging-acceptance`。添加 Required reviewers，只允许 `main` 或受保护分支部署。Platform 已有 `staging`，仍要确认它是否由同一套审批规则保护；不要把生产 Environment 当 Staging 使用。

### 3. 创建最小权限账号

- API：只允许 Staging host，测试 token 只允许 GET/验证类接口；禁止生产 host。
- 数据库：单独 `e2e_readonly` 用户，只授予 `SELECT, SHOW VIEW`；不要复用管理员账号。
- 测试用户：每个系统单独账号，限定测试角色和测试 namespace。

### 4. 在 Environment 添加命名 Secrets

以 Store 为例，在 `fesun-staging-acceptance → Environment secrets` 添加：

```text
STORE_E2E_BASE_URL
STORE_E2E_ALLOWED_HOSTS
STORE_E2E_USERNAME
STORE_E2E_PASSWORD
STORE_E2E_READ_TOKEN
FESUN_QC_ALERT_WEBHOOK_URL   # 可选；只接收分类和链接，不发送证据正文
```

CRM/MOS/Platform 将 `STORE_` 替换为对应前缀。值只在 GitHub Secret 表单输入，不写 YAML、Packet、日志或聊天。

### 5. 配置 Ruleset

进入 `Settings → Rules → Rulesets`，对 `main` 添加：

- Require a pull request；至少 1 名 reviewer；启用 CODEOWNER review。
- Required status check：`acceptance-gate / final-verdict`。
- 禁止 force-push、禁止删除分支、要求所有 review threads resolved。
- 在 Shadow 阶段先观察；管理员批准后才把该 Check 设为 blocking。

### 6. 验证配置

先运行一次样板 PR，不要急着 Enforce：FAST、STANDARD、CROSS_SYSTEM 各 1 次。检查 artifact 中 `verdict.json`、`evidence-gate.json`、`reporter-summary.json` 和 provenance。三次都没有 false allow/deny 后，才由管理员启用 blocking。

## Release SHA 怎么替换

1. QC 仓库合并到 `main`，创建正式 release/tag。
2. 读取该 release 的完整 SHA（40 位十六进制）：

```bash
git fetch origin main --tags
git rev-parse origin/main
```

3. 在业务仓库 Caller 中，把 `__QC_COMMIT_SHA__` 替换为这个 40 位 SHA，例如：

```yaml
uses: houzhenying226-jpg/fesun-quality-control/.github/workflows/reusable-pr-gate.yml@0123456789abcdef0123456789abcdef01234567
```

不能填写 `main`、`v1.1.1`、短 SHA 或动态变量。替换后先开 Shadow PR，确认最终 Check 名称，再 Enforce。
