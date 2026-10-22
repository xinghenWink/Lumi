# Lumi

AI 对话与图像创作平台。Go + Gin + PostgreSQL 16 + Redis 7，以及 Vue 3 + TypeScript + Vite。

当前阶段：**M5 生图开发完成**。M0 / M1 已合并，M2 / M3 / M4 已验收待审查；M5 的 PR #6 基于 M4，提供生图会话、参考图、异步任务、原子扣费退款、图库、头像与后台图像配置。验收证据见 [M5 记录](docs/M5_ACCEPTANCE.md) 与 [PR 检查](https://github.com/xinghenWink/Lumi/pull/6/checks)。

- [需求清单](docs/REQUIREMENTS.md)
- [开发分析与计划](docs/DEVELOPMENT_PLAN.md)
- [原型对接说明](docs/Lumi-原型对接文档.md)
- [技术决策](docs/DECISIONS.md)
- [M0 验收记录](docs/M0_ACCEPTANCE.md)
- [M1 开发范围](docs/M1_PLAN.md)
- [M1 验收记录](docs/M1_ACCEPTANCE.md)
- [M2 开发范围](docs/M2_PLAN.md)
- [M2 验收记录](docs/M2_ACCEPTANCE.md)
- [M3 开发范围](docs/M3_PLAN.md)
- [M3 验收记录](docs/M3_ACCEPTANCE.md)
- [M4 开发范围](docs/M4_PLAN.md)
- [M4 验收记录](docs/M4_ACCEPTANCE.md)
- [M5 开发范围](docs/M5_PLAN.md)
- [M5 验收记录](docs/M5_ACCEPTANCE.md)
- [上游实例契约](docs/UPSTREAM_CONTRACT.md)
- [OpenAPI](docs/openapi.yaml)

## 开发环境

需要 Go 1.26+（镜像与 CI 固定 1.26.10）、Node 22.19+（22.x）、pnpm 10.27.0。完整依赖与集成测试需要 Docker。Make 命令面向 Linux / macOS / WSL。

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

上述随机密钥须保存在本地安全配置中以便重启复用；更换 JWT 密钥会使旧 access token 和验证码失效，更换加密密钥会使已有 SMTP、兑换码和上游渠道密文无法解密。管理员仅在系统尚无管理员时创建，修改环境密码不会重置已有账号。`PUBLIC_BASE_URL` 默认 `http://127.0.0.1:8080`，开发时额外接受 `DEV_ORIGIN=http://127.0.0.1:5173`。注册默认要求邮箱验证；开发环境未设置 SMTP 时，验证码仅输出到后端开发日志；生产环境须在后台邮件设置中配置 SMTP。

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

M2 提供服务内部的 `Charge` / `Settle` 及只读报价 API；浏览器没有直接扣费或退款入口。M5 使用 `ChargeTx` / `SettleTx` 在调用方事务内完成建单扣费及终态结算，没有任务时图表与图片计数为真实的零。

## 上游与平台模型

管理员在 `/admin/upstreams` 创建渠道，填写带版本路径的 Base URL（例如 `https://upstream.example/v1`）、密钥、文本 / 生图超时和可选 HTTP 代理，测试连接后同步模型。读取渠道只返回密钥是否配置；编辑时密钥留空保留原值。`ENCRYPTION_KEY` 必须稳定保存。调用不隐式读取系统代理环境变量，不跟随重定向；内网实例或私有代理需显式设置 `UPSTREAM_ALLOW_PRIVATE_NETWORKS=true`，默认关闭。

同步模型时填写平台展示名称和类型，新导入模型保持停用。在 `/admin/models` 核对能力及“平台模型 → 渠道 → 真实模型 ID”路由后启用；可配置多个路由、排序和每种类型的唯一默认模型。渠道停用 / 删除或没有可用路由的模型不会出现在普通用户目录；聊天模型还须启用 stream 能力。`/chat` 与 `/create` 分别加载聊天 / 图片模型，菜单在输入区底部向上展开；图像写请求仅使用第一条有效优先级路由，不自动切换重试。

`00005_upstreams_models.sql` 为新增迁移。配置变更与脱敏审计在同一事务，版本冲突要求刷新后重试。上游调用记录保留 30 天，仅存模型、调用类型、状态、耗时、受控错误码和请求 ID；启动及每小时分批清理，不保留请求正文、图片或供应商原始错误。

独立探测工具读取 `UPSTREAM_BASE_URL` / `UPSTREAM_API_KEY`，默认只读模型列表，不写入数据库。凭据请在进程环境中设置：

```sh
cd backend
go run ./cmd/probe -output ../.tools/upstream-observed.json
```

文本 SSE 需显式传 `-chat-model`；生图需 `-images -image-model`；改图需 `-edit -image-model -reference-file`。这些选项会真实调用上游并可能计费。可选 `-proxy`、`-allow-private`、`-image-output`，完整参数见 `go run ./cmd/probe -help`。报告不记录密钥或正文，本地图像和报告置于 Git 忽略的 `.tools`。

已授权的实例测试确认模型列表、文本 SSE、单张 low / 1024×1024 生图及 multipart 单图编辑；实际返回为 1254×1254。vision、其他质量 / 尺寸 / 张数上限及 JSON 编辑仍未实测，新模型的未确认能力默认关闭。详见上游契约文档。首次启动环境变量自动创建渠道、熔断及按权重自动切换属于 P1。

## 聊天与历史

`/chat` 新建聊天，`/chat/:id` 打开已有会话。侧栏支持按标题搜索、置顶、重命名和删除，Ctrl / Cmd + K 聚焦搜索；`/me/chats` 支持批量删除与清空确认。聊天与生图模式分别保留内存草稿和模型，退出账号时清空。切回聊天时保留上次会话。

发送、重新生成和编辑最后一条用户消息均使用客户端请求 UUID。同一请求重放已保存结果，不重复调用上游或计数；响应丢失时页面保留原请求用于重试。SSE 提供 meta / delta / error / done，15 秒心跳，无 gzip，并设置 `X-Accel-Buffering: no`。首段非空文本前按路由优先级回退；收到文本后不切换供应商。上游返回空结果或中断时显示受控错误，已生成内容保留。

流式内容每 2 秒及结束时落库。停止或客户端断开会取消上游并保存部分；进程崩溃最多丢失最近一个检查点内的内容，45 秒租约到期后由每 15 秒运行的维护任务标记 interrupted。刷新读取数据库中的内容，不提供 Redis / Last-Event-ID 断点续传。

管理员在 `/admin/chat-settings` 设置每分钟 / 每日限额（默认 20 / 0，0 为不限）、上下文条数与估算 token（默认 20 / 32768）、全局 system prompt 和标题模型。每日按 UTC 计数，已接收的发送 / 编辑 / 重新生成各算一次，失败与停止不退回次数；聊天不消耗图像积分。上下文与模型声明上限取较小值，保留 system，优先丢弃最早完整轮次；单条内容超预算直接拒绝。token 为启发式估算，不能代替供应商 tokenizer。首轮结束后生成最长 20 字标题，失败回退用户首句。

Markdown 支持表格、列表、代码复制和 LaTeX；高亮与公式按需加载。原始 HTML 禁用，最终 HTML 经 DOMPurify 清洗；不自动加载 Markdown 外站图片。CSP 仅为 KaTeX / Shiki 允许样式属性，继续限制脚本和样式标签。聊天正文和标题持久化，所选上游接收生成所需上下文与标题请求；调用日志不保存正文。删除历史使用软删除并立即隐藏，当前没有单独的会话物理清理周期；账号删除保留 30 天后级联清理聊天数据。

聊天集成与浏览器测试使用真实应用、PG / Redis 和可控 HTTP 上游，不把 fixture 结果写成远程实例实测结论。验收记录包含 60 次真实 SSE 请求的平台额外延迟、登录后桌面 Lighthouse、首屏脚本体积与流式长任务测量边界。

## 生图与图片存储

`/create` 与 `/create/:id` 提供独立生图会话、参数及草稿；`/me/images` 是按时间倒序的个人图库。无参考图生成，有参考图改图；支持本地选择、拖放、粘贴和从已有文件选择。库内图片只传文件 ID，服务端读取已保存的 PNG。模型能力与 `/admin/image-settings` 的范围取交集；后台关闭的质量定价不显示，参数报价与实际建单时价格可能因管理员改价而不同，服务端创建时的快照为准。

提交后返回 202，预扣费用与任务在同一事务保存；全部成功按全部张数收费，部分成功按成功张数收费，取消 / 超时 / 失败全退。积分按原桶退款，跨日退入永久桶。相同 Idempotency-Key 与载荷重放原任务，网络结果未知时前端保留原键；图像写入没有自动重试。默认每用户 2 / 全站 4 个运行任务，超出排队；开启拆分时每个任务最多 4 个独立 n=1 请求并发，因此上游请求数上限为任务并发数 × 4。

SSE 展示任务变化，断线后每 3 秒轮询；离页不取消后台任务。PostgreSQL 保存事实状态，Redis 丢失投递在启动 / 每 15 秒补偿；运行租约 30 秒，每 2 秒续期，恢复只处理过期任务，不重复调用上游。崩溃后的生成任务不自动重新生成，租约过期后失败并退款。

文件按魔数 / 解码头校验，参考图输入 ≤10 MB，生成结果 ≤20 MB；所有图像最长边 ≤8192、总像素 ≤2400 万。重编码为去除元数据的 PNG，缩略图为长边 ≤512px 的 WebP。列表仅加载缩略图，预览 / 下载取原图；两者都要求登录和绑定查看者的过期签名，复制 URL 给其他用户不能访问。头像限 2 MB，自动居中裁剪至 256×256，原子替换并隐藏旧文件。

`DATA_DIR` 开发默认 `backend/data`（从 backend 启动时），生产默认 `/data`；必须持久化，启动检查可写。多实例共享同一存储目录及 JWT / 加密密钥，数据库与图片目录一起备份。默认永久保留生成图片；保留天数可配。启动及每小时清理，每轮最多物理清除 100 条软删除文件，并清理超过 24 小时的未引用上传、无主头像和异常退出的孤立文件（单轮孤立文件最多 100 个）；正在作为任务输入的图片不清理。账号物理清理跳过未结算的图像扣费，避免丢失退款所有者。

后台 `/admin/image-tasks` 提供任务筛选、费用、耗时、错误及图片删除。内容查看默认关闭，开启后提示词 / 参考图 / 结果的列表、详情、元数据与字节访问均审计；删除图片始终记录审计。全量 ZIP、批量删除与手动退款留在后续阶段。

## 本地完整容器栈

复制 `deploy/.env.example` 为 `deploy/.env`，填入随机 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、至少 32 字节随机 `JWT_SECRET`、32 字节 base64 `ENCRYPTION_KEY` 及首次管理员 `ADMIN_EMAIL` / `ADMIN_PASSWORD`。建议连接密码用 URL 安全的字母数字；连接 URL 中的特殊字符须编码。

```sh
mkdir -p deploy/data/app
sudo chown 10001:10001 deploy/data/app
docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.build.yml up --build -d --wait
```

打开 [首页](http://127.0.0.1:8080)。应用以 uid 10001 运行，启动时加锁执行迁移。数据保存在 `deploy/data`，重建容器不删除数据。Linux 宿主机 `deploy/data/app` 必须授予 uid 10001 写权限；Docker Desktop 使用宿主机文件共享权限。

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
