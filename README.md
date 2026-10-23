# Lumi

**可自行部署的 AI 对话与图像创作平台。**

[![CI](https://github.com/xinghenWink/Lumi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/xinghenWink/Lumi/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/xinghenWink/Lumi)](https://github.com/xinghenWink/Lumi/releases) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Lumi 把流式聊天、生图与改图、积分兑换和管理后台整合到一个站点。前端嵌入 Go 二进制，配合 PostgreSQL、Redis 和持久文件目录运行，通过 OpenAI 兼容上游调用模型，适合部署自己的 AI 创作服务。

当前可用版本为 **[v0.1.0](https://github.com/xinghenWink/Lumi/releases/tag/v0.1.0)**，定位为首个可运行的基础版本。M0～M7 的初期功能与验收已完成，支持 `linux/amd64` 和 `linux/arm64`；产品仍在 0.x 阶段持续迭代。版本路线为 `0.0.1 → 0.1.0 → 0.1.x / 0.2.0…`，成熟后再发布 1.0.0，见 [版本策略](docs/VERSIONING.md)。

[功能](#功能) · [技术与架构](#技术与架构) · [快速部署](#快速部署) · [首次配置](#首次配置) · [运维](#运维) · [本地开发](#本地开发) · [文档](#文档)

## 功能

| 模块       | 能力                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AI 对话    | SSE 流式输出、停止与重试、Markdown / 公式 / 代码高亮、上下文控制、自定义指令、历史与导出、断线续传；图片理解按模型能力启用。  |
| 图像创作   | 文生图、参考图改图、质量 / 尺寸 / 比例 / 数量选择、异步任务、进度与取消、历史图库、已有图片加入编辑、签名下载及 WebP 缩略图。 |
| 积分与兑换 | 每日 / 永久双桶积分、注册与每日赠送、质量定价和倍率、扣费快照、失败退款、兑换码批量生成与 CSV 导出、流水及使用统计。          |
| 账号       | 邮箱注册与验证码、登录、忘记密码、会话与设备管理、个人偏好、账号删除、Turnstile 和 IP 注册配额。                              |
| 管理后台   | 用户与余额管理、上游渠道与模型路由、连接测试与模型发现、熔断、任务、定价、看板、公告、邮件与系统设置、审计日志。              |
| 使用体验   | 中文优先的国际化、浅色 / 深色主题、响应式布局，聊天与生图分别保存会话和草稿。                                                 |

聊天免费，生图按积分计费。每日积分先消费、永久积分后消费；生图以创建任务时的价格结算，部分失败退还失败张数对应的积分。每日赠送不累计，跨日退款进入永久桶。

当前版本不包含在线支付、对外 API Key、团队空间、RAG、工具调用、原生 App、蒙版重绘或上游账号池。模型实际能力取决于接入的上游，已验证参数及限制见 [上游实测契约](docs/UPSTREAM_CONTRACT.md)。

## 技术与架构

| 层         | 技术                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 后端       | Go 1.26.10、Gin、pgx、sqlc、goose；JWT / Argon2id、SSE、OpenAPI 3.1。                                      |
| 前端       | Vue 3、TypeScript strict、Vite 8、Pinia、Vue Router、Tailwind CSS 4、Reka UI、vue-i18n。                   |
| 数据与任务 | PostgreSQL 16 保存账号、会话、任务与账务；Redis 7 处理队列、限流和流式续传；图片保存在持久目录。           |
| 部署       | 单个非 root 应用镜像、Docker Compose、Caddy / Nginx HTTPS 反代；GitHub Actions 发布到 GHCR。               |
| 质量检查   | golangci-lint、ESLint、Prettier、Vitest、真实 PG / Redis 集成、Playwright、Lighthouse、k6 和依赖漏洞扫描。 |

```mermaid
flowchart LR
    Browser[浏览器] -->|HTTPS / SSE| Proxy[Caddy / Nginx]
    Proxy --> App[Lumi：Go API + 内嵌 Vue 前端]
    App --> PG[(PostgreSQL)]
    App --> Redis[(Redis)]
    App --> Files[持久图片目录]
    App -->|聊天 / 生图 / 改图| Upstream[OpenAI 兼容上游]
```

Lumi 提供平台和管理能力，上游推理服务需要单独准备。默认适配器使用 `/v1/models`、`/v1/chat/completions`、`/v1/images/generations` 和 `/v1/images/edits`；不同服务支持的模型和参数应逐项确认。

## 快速部署

### 1. 准备环境

- Linux 服务器，安装 Docker Engine 和 Compose v2；部署脚本使用 Bash、OpenSSL、curl、tar、coreutils、flock。
- 准备公开 HTTPS 入口，通常使用域名和 Caddy / Nginx；IP 地址 HTTPS 的配置见 [部署手册](docs/DEPLOYMENT.md#ip-地址-https)。
- 应用容量参考为 2 vCPU / 2 GB，PostgreSQL、Redis 与图片存储需另留资源。图片默认永久保存，应预留磁盘和备份空间。

### 2. 下载正式部署包

```sh
curl --fail --location \
  https://github.com/xinghenWink/Lumi/releases/download/v0.1.0/lumi-deploy.tar.gz \
  --output lumi-deploy.tar.gz
sudo install -d -m 700 /opt/lumi
sudo tar -xzf lumi-deploy.tar.gz -C /opt/lumi
sudo bash /opt/lumi/docker-deploy.sh /opt/lumi
sudoedit /opt/lumi/.env
```

安装器生成数据库 / Redis 密码、JWT / 加密密钥和初始管理员密码，写入权限为 `0600` 的 `.env`；重复运行保留既有配置。先修改这些字段，保留生成的随机密钥：

```dotenv
LUMI_IMAGE=ghcr.io/xinghenwink/lumi
LUMI_VERSION=v0.1.0
ADMIN_EMAIL=admin@example.com
PUBLIC_BASE_URL=https://lumi.example.com
COOKIE_SECURE=true
# Configure SMTP before opening public registration.
REGISTRATION_ENABLED=false
```

不要把 `.env`、上游密钥或备份提交到仓库。只有本机 HTTP 演练可使用 `PUBLIC_BASE_URL=http://127.0.0.1:8080` 和 `COOKIE_SECURE=false`。

### 3. 启动服务

以下命令在 root 终端执行，需要时先运行 `sudo -i`：

```sh
cd /opt/lumi
# If the registry requires authentication, log in with read:packages first.
docker compose pull
docker compose up -d --wait --wait-timeout 180
curl --fail http://127.0.0.1:8080/readyz
curl --fail http://127.0.0.1:8080/api/version
```

Compose 启动应用、PostgreSQL 和 Redis，应用自动执行迁移。应用仅绑定宿主机 `127.0.0.1:8080`，数据库与 Redis 不暴露公网端口；三个服务均配置重启策略，数据保存在 `/opt/lumi/data`。

若 GHCR 返回未授权，先使用仅有 `read:packages` 权限的凭据登录。amd64 也可从同一 Release 下载 `lumi-linux-amd64.tar.gz` 和同名 JSON，通过 `docker load` 离线导入；必须完成 [镜像身份核验](docs/OFFLINE_IMAGE_VERIFICATION.md)，随后启动时跳过 `pull`。不要在服务器保存工作站的广泛仓库凭据。

### 4. 配置 HTTPS 反代

在宿主机安装 Caddy 或 Nginx，使用部署包内的 `Caddyfile.example` 或 `nginx.conf.example`，替换域名 / 证书路径并启用服务。模板已包含 SSE 无缓冲和客户端 IP 转发配置。

确认应用实际看到的代理地址，例如宿主反代经过 Docker 转发时查看网桥网关：

```sh
docker network inspect lumi_default --format '{{(index .IPAM.Config 0).Gateway}}'
```

将该实际地址的 `/32`（IPv6 用 `/128`）写入 `.env` 的 `TRUSTED_PROXIES`，再运行 `docker compose up -d --wait`。仅信任真实代理来源，不填写整个私网或 `0.0.0.0/0`。

完成后打开 `https://你的域名`，访问 `/admin` 进入后台。完整 TLS、代理、权限和离线部署说明见 [部署手册](docs/DEPLOYMENT.md)。

## 首次配置

1. **管理员登录**：邮箱使用 `.env` 中的 `ADMIN_EMAIL`，初始密码由 root 在同一文件查看 `ADMIN_PASSWORD`。登录后在个人中心修改密码；没有固定的默认账号或密码。管理员仅首次创建，修改环境密码不会重置已有账号。
2. **接入上游**：后台「上游渠道」填写 Base URL（包含 `/v1`）和 API Key，执行连接测试与模型发现；导入模型后检查路由、默认模型及启用状态，按实测能力开放参数。不要把未验证的 vision、多参考图等能力直接启用。
3. **配置积分和定价**：设置注册 / 每日赠送、每日重置时区、生图质量价格与倍率，按需生成兑换码。默认注册赠送 10、每日赠送 5，生图低 / 中 / 高质量为 5 / 7 / 10 积分每张。
4. **配置邮件与注册**：填写 SMTP 并发送测试邮件，再开放注册和找回密码。环境变量优先于后台设置；如果设置了 `REGISTRATION_ENABLED=false`，需先移除该覆盖并重新创建应用容器，才能在后台开启注册。

也可在**首次空目录启动前**同时设置 `UPSTREAM_BASE_URL` 和 `UPSTREAM_API_KEY`，自动引导一个渠道和默认模型。该引导预设聊天 `gpt-5-3-mini`、生图 `gpt-image-2`，生图先开放 low / 1024×1024 / 单张 / 单参考图；其他上游建议使用后台配置。已有渠道时不会重复引导。

## 运维

在 `/opt/lumi` 的 root 终端执行：

```sh
# Check services and readiness.
docker compose ps
docker compose logs --tail 100 app
curl --fail https://lumi.example.com/readyz

# Create a consistent backup; briefly stop the app to align PG and image files.
BACKUP_KEEP=7 bash backup.sh
```

备份包含数据库、图片、`.env` 和镜像清单，默认保留最近 7 份。请按 [部署手册](docs/DEPLOYMENT.md#一致备份与恢复) 设置定时任务、加密和异地保存；安装器不会自动安排定时备份。恢复必须使用可信归档和空目标目录，避免覆盖运行中的实例。

升级前先备份，在 `.env` 固定到已验收版本，再执行 `docker compose pull && docker compose up -d --wait`。迁移只增不改，回滚需确认旧二进制兼容新 schema；不兼容时恢复到隔离实例。生产建议使用版本标签或 digest，`edge` 用于跟进主分支开发。

`/healthz` 检查进程，`/readyz` 检查数据库和 Redis，`/api/version` 返回版本 / 提交 / 构建时间，`/metrics` 需要管理员 Bearer。管理员密码救援、磁盘规划与升级恢复命令见部署手册。

## 本地开发

需要 Go **1.26.10**、Node **22.19+（22.x）**、pnpm **10.27.0**、Docker 和 Compose。Make 命令以 Linux / macOS / WSL 为主；Go 版本与 CI / 发布保持一致。

```sh
git clone https://github.com/xinghenWink/Lumi.git
cd Lumi
export GOTOOLCHAIN=go1.26.10
corepack enable
corepack prepare pnpm@10.27.0 --activate
make install
make dev-deps
pnpm build

export DATABASE_URL='postgres://lumi:lumi-dev-only@127.0.0.1:5432/lumi?sslmode=disable'
export REDIS_URL='redis://:lumi-dev-only@127.0.0.1:6379/0'
export JWT_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_KEY="$(openssl rand -base64 32)"
export ADMIN_EMAIL='admin@example.com'
read -rs -p 'Initial admin password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
make dev
```

在另一终端运行 `pnpm dev`，访问 `http://127.0.0.1:5173`；后端在 `8080`。Go 不自动加载 `.env`，Compose 会加载；开发时请安全保存并复用随机密钥。PowerShell 使用 `$env:变量名 = '值'` 设置环境，然后从 `backend` 运行 `go run ./cmd/lumi serve`。

开发模式且未配置 SMTP 时，验证码只输出到开发日志；生产模式需要真实 SMTP。没有 PG / Redis 时仅能检查访客页，`/readyz` 返回 503。

### 构建与验证

```sh
make lint test                 # Go / frontend lint, types and unit tests
make sqlc api                  # Regenerate SQL queries and API types
make test-integration          # Real PostgreSQL / Redis integration tests
make build                     # Build frontend and embed it into the Go binary
pnpm --filter @lumi/frontend exec playwright install --with-deps chromium
pnpm test:e2e                  # Desktop and mobile browser tests
```

集成 / E2E 需要 Docker。E2E 还需显式设置 `E2E_DATABASE_URL` 和 `E2E_REDIS_URL`，指向**空的独立测试数据库与缓存**，不要使用生产数据。测试启动 `18080` 端口的真实应用；仅检查访客页可运行 `pnpm test:e2e --grep '@guest'`。

CI 覆盖质量检查、契约生成一致性、真实集成、完整用户流程、Lighthouse、100 VU 压测、容器部署与恢复及生产依赖漏洞。完整参数、性能测量边界和验收证据见 [M7 验收](docs/M7_ACCEPTANCE.md)。

### 目录

```text
backend/             Go 服务、业务模块、SQL 查询及数据库迁移
frontend/            Vue 页面、组件、状态、API 类型及浏览器测试
deploy/              Compose、环境模板、安装与备份恢复脚本、反代示例
scripts/             部署验收与性能测试工具
docs/                需求、OpenAPI、技术决策及里程碑验收
.github/workflows/   CI、双架构镜像与 Release 自动化
```

## 文档

| 文档                                                                | 内容                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [部署、备份与发布](docs/DEPLOYMENT.md)                              | 首次部署、HTTPS / 代理、管理员救援、升级回滚、备份恢复、发布门槛。 |
| [离线镜像核验](docs/OFFLINE_IMAGE_VERIFICATION.md)                  | 官方 amd64 归档及 Docker 存储后端的身份验证。                      |
| [上游实测契约](docs/UPSTREAM_CONTRACT.md)                           | 已验证的请求格式、质量 / 尺寸 / 数量与供应商差异。                 |
| [OpenAPI](docs/openapi.yaml)                                        | 平台账号、聊天、生图、积分与后台接口契约。                         |
| [技术决策](docs/DECISIONS.md)                                       | 实现选择、依赖及运行边界。                                         |
| [安全检查](docs/SECURITY_REVIEW.md)                                 | 认证、授权、CSRF、上传、SSRF、日志和备份检查。                     |
| [需求](docs/REQUIREMENTS.md) / [开发计划](docs/DEVELOPMENT_PLAN.md) | 产品范围、业务规则和里程碑。                                       |

历史验收：[M0](docs/M0_ACCEPTANCE.md) · [M1](docs/M1_ACCEPTANCE.md) · [M2](docs/M2_ACCEPTANCE.md) · [M3](docs/M3_ACCEPTANCE.md) · [M4](docs/M4_ACCEPTANCE.md) · [M5](docs/M5_ACCEPTANCE.md) · [M6](docs/M6_ACCEPTANCE.md) · [M7](docs/M7_ACCEPTANCE.md)。

## 贡献与许可证

欢迎通过 Issue 反馈问题，或提交范围明确的 PR。请遵循 [AGENTS.md](AGENTS.md)，使用 Conventional Commits；业务改动附测试、必要文档和 API 契约更新，SQL 迁移只增不改。提交前运行 `make lint test`。

本项目采用 [MIT License](LICENSE)，独立实现，未复制参考项目代码。接入的模型和上游服务遵循各自的使用条款。
