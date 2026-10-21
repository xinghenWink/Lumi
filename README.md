# Lumi

AI 对话与图像创作平台。Go + Gin + PostgreSQL 16 + Redis 7，以及 Vue 3 + TypeScript + Vite。

当前阶段：**M0 基础工程**。已实现健康检查、版本 API、欢迎页、迁移与代码生成基础、Docker 和自动化配置。账号、积分、聊天、生图和后台按 M1～M7 开发，HTML 原型中的模拟逻辑不进入生产代码。

- [需求清单](docs/REQUIREMENTS.md)
- [开发分析与计划](docs/DEVELOPMENT_PLAN.md)
- [原型对接说明](docs/Lumi-原型对接文档.md)
- [技术决策](docs/DECISIONS.md)
- [M0 验收记录](docs/M0_ACCEPTANCE.md)
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
$env:GIN_MODE = 'release'
Set-Location backend
go run ./cmd/lumi serve
```

另一个终端从仓库根目录运行 `pnpm dev`，打开 [开发页](http://127.0.0.1:5173)。Vite 代理 API 到 8080。也可打开 [Go 托管首页](http://127.0.0.1:8080)，读取最近一次构建产物。

无 Docker 时，可省略两个连接变量，只验证首页。此时 `/healthz` 为 200，`/readyz` 为 503。`APP_ENV=production` 不允许缺失依赖。Go 不自动读取 `.env`；本地请设置环境变量，Compose 通过 `env_file` 加载。

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

集成测试启动临时 PG / Redis 并自动清理；无 Docker 时失败。浏览器测试覆盖桌面、320px 手机、嵌入首页、真实版本接口、失败重试与 SPA 回退。

`production` 构建嵌入前端，二进制可脱离仓库运行。必须先 `pnpm build`。Linux 产物为 `bin/lumi`，Windows 示例为 `bin/lumi.exe`。

## 本地完整容器栈

复制 `deploy/.env.example` 为 `deploy/.env`，填入随机 `POSTGRES_PASSWORD` 与 `REDIS_PASSWORD`。建议用 URL 安全的字母数字密码；连接 URL 中的特殊字符须编码。

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

| 项目               | 行为                                              |
| ------------------ | ------------------------------------------------- |
| `GET /healthz`     | 仅检查进程存活                                    |
| `GET /readyz`      | 两秒内检查 PG / Redis；失败 503                   |
| `GET /api/version` | 返回 version / commit / build_time                |
| `lumi serve`       | 默认；连接依赖、执行迁移、启动 HTTP               |
| `lumi migrate`     | 只执行嵌入的 forward-only 迁移，要求 DATABASE_URL |
| `lumi healthcheck` | 本地存活检查，供镜像 HEALTHCHECK 使用             |

环境变量：`APP_ENV`（development / production / test）、`HTTP_ADDR`（默认 :8080）、`DATABASE_URL`、`REDIS_URL`、`LOG_LEVEL`。完整列表及后续预留项见 `deploy/.env.example`。

## CI 与发布

`ci.yml` 检查代码、生成结果、集成与完整容器栈。`release.yml` 在 main 或版本 tag 推送时复用 CI，通过后构建 amd64 / arm64 并推 GHCR。main 标签为 edge / sha；版本为 vX.Y.Z、X.Y、latest，并生成 Release。

仓库需启用 Actions，`GITHUB_TOKEN` 需 Packages 写权限。私有镜像需服务器登录 GHCR。远程验收以实际工作流与镜像结果为准。
