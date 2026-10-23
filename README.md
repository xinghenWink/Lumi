# Lumi

AI 对话与图像创作平台：Go + Gin + PostgreSQL 16 + Redis 7，Vue 3 + TypeScript + Vite。前端嵌入单一 Go 二进制，所有模型通过自部署的 OpenAI 兼容上游提供。

当前阶段：**M7 加固与发布验收**。正式发布状态和未通过项见 [M7 验收](docs/M7_ACCEPTANCE.md)；部署从 [部署、备份与发布](docs/DEPLOYMENT.md) 开始。

## 功能

- 邮箱注册、验证码、登录与令牌轮换、忘记密码、Turnstile、IP 配额、设备管理和账号删除。
- 免费流式聊天、Markdown / 公式 / 代码、自定义指令、图片理解、Redis 五分钟续传、历史与导出。
- 生图与改图独立会话、参考图复用、异步队列、SSE / 轮询、签名图片与 WebP 缩略图、历史图库和批量操作。
- 每日 / 永久双桶整数积分，原子扣费、价格快照、部分失败退款、幂等兑换与只增不改流水。
- 管理后台：用户、兑换码、定价、上游与模型路由、熔断、任务、统计看板、公告、系统设置和审计。

本期不包含支付、开放 API Key、团队、RAG、联网搜索、工具调用、原生 App、蒙版重绘或上游账号池。未复制参考项目代码。

## 文档

[需求](docs/REQUIREMENTS.md) · [技术决策](docs/DECISIONS.md) · [OpenAPI](docs/openapi.yaml) · [上游实测契约](docs/UPSTREAM_CONTRACT.md) · [安全检查](docs/SECURITY_REVIEW.md) · [M7 计划](docs/M7_PLAN.md)

验收：[M0](docs/M0_ACCEPTANCE.md) · [M1](docs/M1_ACCEPTANCE.md) · [M2](docs/M2_ACCEPTANCE.md) · [M3](docs/M3_ACCEPTANCE.md) · [M4](docs/M4_ACCEPTANCE.md) · [M5](docs/M5_ACCEPTANCE.md) · [M6](docs/M6_ACCEPTANCE.md) · [M7](docs/M7_ACCEPTANCE.md)

## 开发

发布与 CI 固定 Go 1.26.10；Node 22.19+（22.x）、pnpm 10.27.0。完整集成与 E2E 需要 Docker。建议设置 `GOTOOLCHAIN=go1.26.10`，较新的未打补丁 Go 版本不能替代发布工具链。Make 以 Linux / macOS / WSL 为主。

```sh
corepack enable
corepack prepare pnpm@10.27.0 --activate
make install
make dev-deps
pnpm build
```

本地环境示例（不要提交实际密钥）：

```sh
export DATABASE_URL='postgres://lumi:lumi-dev-only@127.0.0.1:5432/lumi?sslmode=disable'
export REDIS_URL='redis://:lumi-dev-only@127.0.0.1:6379/0'
export JWT_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_KEY="$(openssl rand -base64 32)"
export ADMIN_EMAIL='admin@example.com'
read -rs ADMIN_PASSWORD; export ADMIN_PASSWORD
make dev
# 另一终端运行 pnpm dev，打开 http://127.0.0.1:5173。
```

PowerShell 使用 `$env:变量名 = '值'` 后从 backend 运行 `go run ./cmd/lumi serve`。Go 不自动读取 .env；Compose 会读取。随机密钥应安全持久保存，重启复用。管理员只在系统没有管理员时创建，修改环境密码不会重置已有账号。生产密钥、管理员救援、TLS / 代理、数据库迁移和文件权限见部署手册。

无数据库 / Redis 的开发模式仅供访客页面检查，readyz 为 503。生产模式要求全部依赖。开发验证码仅在 development 日志输出，生产需 SMTP。

## 构建与验证

```sh
make lint test
make sqlc api
make test-integration
make build
pnpm --filter @lumi/frontend exec playwright install --with-deps chromium
pnpm test:e2e
```

E2E 需显式设置 E2E_DATABASE_URL / E2E_REDIS_URL，使用**空的独立测试数据库 / 缓存**；不同运行的临时管理员密码与加密密钥不同，不可复用有旧账号 / 渠道的数据库。测试启动 18080 端口真实应用，验证桌面 / 320px 手机的注册、聊天、兑换、生图和后台操作。无依赖可用 `pnpm test:e2e --grep '@guest'`。

100 VU、Lighthouse、500 消息、1000 图、双版本部署 / 升级回滚 / 备份恢复的可重复命令和测量边界见部署手册。`production` 构建先构建前端，再嵌入二进制；内嵌时区使独立运行不依赖宿主 Go 安装。数据库迁移只增不改。

## 数据与运行边界

聊天免费；生图按创建时价格快照扣费，先每日后永久。失败按成功张数结算，跨日退款转永久桶。重试必须复用原请求键，未知图像写入结果不自动重发。管理员内容查看默认关闭，开启后每次查看审计。访问他人会话 / 图片 / 任务返回 404。

access token 仅放前端内存；refresh 为 HttpOnly / SameSite=Lax Cookie。公开生产部署必须 HTTPS + Secure Cookie，仅回环 HTTP 允许本地演练例外。上游密钥 AES-GCM 加密，DTO / 审计不回传；默认拒绝私网目的地和全部重定向。真实上游已确认能力与未测能力见契约，不把 fixture 当作供应商实测。

图片存于 DATA_DIR/images，生产 /data，持久挂载必需。上传按魔数 / 大小 / 像素限制校验，PNG 重编码去除元数据，缩略图长边 ≤512 WebP；原图和缩略图均鉴权并签名。多实例需共享目录和密钥，自动备份脚本只面向单应用实例、内置 PG / Redis。

## CI 与发布

CI 检查 lint / 类型 / 单测 / 真实集成 / 生成一致性 / 构建 / 全流程 E2E / Lighthouse / 100 VU / 容器部署恢复及生产依赖漏洞。所有报告保留为受限 CI artifact，测试令牌文件不上传。

main 生成 edge / sha 镜像；已验收版本 tag 生成版本 / X.Y / latest 的 amd64 + arm64 GHCR 镜像。两种原生架构按 digest 验证后生成带部署包及官方 amd64 归档的 Release 草稿；整个工作流全绿且正式镜像在目标服务器验收后，授权发布者才发布草稿。私有镜像可使用只读 Packages PAT 或官方离线归档。M7 未通过项完成前不创建 v1.0.0 标签。
