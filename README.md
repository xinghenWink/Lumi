# Lumi

AI 对话与图像创作平台。Go + Gin + PostgreSQL 16 + Redis 7，以及 Vue 3 + TypeScript + Vite。

当前阶段：**M2 积分与兑换码开发验收通过，待 PR 审查**。M0 / M1 已合并；已实现账号与后台、双桶积分、注册/每日赠送、价格规则、兑换码、积分流水和使用统计。聊天、模型接入和生图任务按 M3～M5 开发，HTML 原型中的模拟逻辑不进入生产代码。

- [需求清单](docs/REQUIREMENTS.md)
- [开发分析与计划](docs/DEVELOPMENT_PLAN.md)
- [原型对接说明](docs/Lumi-原型对接文档.md)
- [技术决策](docs/DECISIONS.md)
- [M0 验收记录](docs/M0_ACCEPTANCE.md)
- [M1 开发范围](docs/M1_PLAN.md)
- [M1 验收记录](docs/M1_ACCEPTANCE.md)
- [M2 开发范围](docs/M2_PLAN.md)
- [M2 验收记录](docs/M2_ACCEPTANCE.md)
- [OpenAPI](docs/openapi.yaml)

## 开发环境

需要 Go 1.26+（镜像与 CI 固定 1.26.10）、Node 22.12+、pnpm 10.27.0。完整依赖与集成测试需要 Docker。Make 命令面向 Linux / macOS / WSL。

```sh
corepack enable
corepack prepare pnpm@10.27.0 --activate
pnpm install --frozen-lockfile
pnpm build
docker compose -f deploy/docker-compose.dev.yml up -d --wait
```

PowerShell 启动后端：

```powershell
$env:DATABASE_URL = 'postgres://lumi:lumi-dev-only@127.0.0.1:5432/lumi?sslmode=disable'
$env:REDIS_URL = 'redis://:lumi-dev-only@127.0.0.1:6379/0'
$env:JWT_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:ENCRYPTION_KEY = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:ADMIN_EMAIL = 'admin@example.com'
$env:ADMIN_PASSWORD = Read-Host 'First administrator password (8+ characters with letters and numbers)' -MaskInput
$env:GIN_MODE = 'release'
Set-Location backend
go run ./cmd/lumi serve
```

另一个终端从仓库根目录运行 `pnpm dev`，打开 [开发页](http://127.0.0.1:5173)。Vite 代理 API 到 8080。也可打开 [Go 托管首页](http://127.0.0.1:8080)，读取最近一次构建产物。

上述随机密钥须保存在本地安全配置中以便重启复用；更换 JWT 密钥会使旧 access token 和验证码失效，更换加密密钥会使已有 SMTP 密文无法解密。管理员仅在系统尚无管理员时创建，修改环境密码不会重置已有账号。`PUBLIC_BASE_URL` 默认 `http://127.0.0.1:8080`，开发时额外接受 `DEV_ORIGIN=http://127.0.0.1:5173`。注册默认要求邮箱验证；开发环境未设置 SMTP 时，验证码仅输出到后端开发日志；生产环境须在后台邮件设置中配置 SMTP。

无 Docker 时，可省略两个连接变量，只验证访客页面。此时 `/healthz` 为 200，`/readyz` 与账号 API 为 503。`APP_ENV=production` 不允许缺失依赖。Go 不自动读取 `.env`；本地请设置环境变量，Compose 通过 `env_file` 加载。

## 构建与验证

```sh
make install
make lint test
make sqlc api
make test-integration
make build
pnpm --filter @lumi/frontend exec playwright install chromium
pnpm test:e2e
```

Windows 无 Make 时的对应命令：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm api:generate
pnpm build
Set-Location backend
go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0 run --build-tags=integration
go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0 fmt --diff
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate
go test ./...
go test -tags=integration -count=1 ./...
$env:CGO_ENABLED = '0'
go build -tags=production -trimpath -o ../bin/lumi.exe ./cmd/lumi
Set-Location ..
pnpm --filter @lumi/frontend exec playwright install chromium
pnpm test:e2e
```

集成测试启动临时 PG / Redis 并自动清理；无 Docker 时失败。完整浏览器测试须设置 `E2E_DATABASE_URL` 和 `E2E_REDIS_URL`，指向独立测试数据库/缓存，不要使用生产数据。测试在 18080 端口启动真实应用并创建临时管理员，覆盖桌面、320px 手机、注册、会话恢复、禁用/删除失效、用户详情、设置和审计。无依赖时可用 `pnpm test:e2e --grep '@guest'` 验证访客页、主题、路由守卫与 SPA 回退。

`production` 构建嵌入前端，二进制可脱离仓库运行。必须先 `pnpm build`。Linux 产物为 `bin/lumi`，Windows 示例为 `bin/lumi.exe`。

## 积分与兑换码

个人页面 `/me/credits` 展示双桶余额、下次重置、流水、兑换记录与近 30 天真实用量。后台入口为 `/admin/pricing`、`/admin/redeem-codes` 和 `/admin/credit-ledger`；用户详情支持积分调整和兑换记录。用户列表支持初始积分、余额筛选和排序。

赠送默认注册 10、每日 5，重置时区为 Asia/Shanghai；在后台价格页面修改，0 表示关闭对应赠送。修改只影响之后的注册或重置。`00004` 迁移会为既有账号建立零永久余额账户，不补发历史注册赠送；每日桶在下一次读取或扣费时按当前配置重置。每桶余额上限为 10^12，所有计价使用整数和精确十进制倍率。

兑换、管理员调整和批次生成要求 `Idempotency-Key`，相同键与请求重放原结果，键与不同内容冲突；页面在响应丢失后保留原键重试。兑换码只允许管理员查看完整内容，用户记录仅展示尾号。CSV 按界面语言导出，使用 UTF-8 BOM / CRLF，并转义可能触发公式的文本。

`ENCRYPTION_KEY` 同时保护 SMTP 配置和兑换码密文，须随数据库安全备份并保持稳定。积分流水、扣费和兑换记录在账号保留期清理后继续保留稳定 UUID，避免财务历史断裂。

M2 提供服务内部的 `Charge` / `Settle` 及只读报价 API；浏览器没有直接扣费或退款入口。生图任务创建、调度、上游执行和重启恢复属于 M5，届时接入扣费快照与结算。当前没有任务时图表与图片计数为真实的零。

## 本地完整容器栈

复制 `deploy/.env.example` 为 `deploy/.env`，填入随机 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、至少 32 字节随机 `JWT_SECRET`、32 字节 base64 `ENCRYPTION_KEY` 及首次管理员 `ADMIN_EMAIL` / `ADMIN_PASSWORD`。建议连接密码用 URL 安全的字母数字；连接 URL 中的特殊字符须编码。

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.build.yml up --build -d --wait
```

打开 [首页](http://127.0.0.1:8080)。应用以 uid 10001 运行，启动时加锁执行迁移。数据保存在 `deploy/data`，重建容器不删除数据。后续写入图片时，宿主机 `deploy/data/app` 应授予 uid 10001 写权限。

首次镜像尚未发布时使用本地构建覆盖配置。发布后可执行：

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml pull
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --wait
```

生产环境需 HTTPS、`PUBLIC_BASE_URL` 与 `COOKIE_SECURE=true`。完整部署、备份恢复和升级在 M7 验收。

## 运维接口与命令

| 项目                                        | 行为                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /healthz`                              | 仅检查进程存活                                                                   |
| `GET /readyz`                               | 两秒内检查 PG / Redis；失败 503                                                  |
| `GET /api/version`                          | 返回 version / commit / build_time                                               |
| `lumi serve`                                | 默认；连接依赖、执行迁移、启动 HTTP                                              |
| `lumi migrate`                              | 只执行嵌入的 forward-only 迁移，要求 DATABASE_URL                                |
| `lumi healthcheck`                          | 本地存活检查，供镜像 HEALTHCHECK 使用                                            |
| `lumi admin reset-password --email address` | 使用 `ADMIN_RESET_PASSWORD` 环境变量重置已有管理员密码，撤销其全部会话并记录审计 |

环境变量完整列表见 `deploy/.env.example`。站点、注册与邮件设置遵循环境变量优先于数据库；后台标记受环境管理的字段。数据库缓存 30 秒，保存立即失效；SMTP 密码加密保存且 API 不回传。会话使用内存 access token 与 HttpOnly refresh cookie；跨源写入需匹配配置的 Origin，代理部署须正确设置公开地址。操作恢复命令后清除 `ADMIN_RESET_PASSWORD` 环境变量。

账号软删除后保留 30 天。应用启动后及每小时运行内部维护任务，按每批最多 100 条清理到期账号及其会话，并保留脱敏审计；清理与审计在同一事务，审计失败会回滚删除。维护任务随应用退出停止，不提供额外管理 API。

## CI 与发布

`ci.yml` 检查代码、生成结果、集成与完整容器栈。`release.yml` 在 main 或版本 tag 推送时复用 CI，通过后构建 amd64 / arm64 并推 GHCR。随后按发布 digest 在两种原生架构 runner 上拉取镜像，验证 manifest、非 root 用户、完整 Compose 栈和版本 / commit。main 标签为 edge / sha；版本为 vX.Y.Z、X.Y、latest，两种架构验收通过后生成 Release。

仓库需启用 Actions，`GITHUB_TOKEN` 需 Packages 写权限。私有镜像需服务器登录 GHCR。远程验收以实际工作流与镜像结果为准。
