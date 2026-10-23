# AI 对话 + 生图 C 端平台 · 需求清单（Codex 执行版）

版本 v1.0 ｜ 日期 2026-10-21 ｜ 项目代号 `lumi`（可自行替换，全文以 `lumi` 指代）

## 0. 如何使用本文档

- 将本文放入仓库 `docs/REQUIREMENTS.md`，并把第 4.5 节摘成根目录 `AGENTS.md`。
- 严格按第 17 章里程碑 M0→M7 顺序执行，**一次只做一个里程碑**，通过第 18 章验收后再进入下一个。
- 优先级：**P0** 必须（MVP）；**P1** 上线前尽量完成；**P2** 后续迭代，本期不做。
- 编号：`F-` 功能、`BR-` 业务规则、`D-` 默认决策（你没指定的地方我先定了默认值，可改）、`NFR-` 非功能要求。
- 本文依据各参考项目的公开 README 整理，未逐行阅读源码。**上游 chatgpt2api 的精确请求/响应字段必须以你实际部署的实例为准**，见 10.3 的“契约确认”任务。
- Codex 遇到本文未覆盖的细节：选最简单、最安全的方案实现，在 `docs/DECISIONS.md` 记一行，不要停下来提问。

## 1. 项目概述

**一句话**：面向 C 端用户的网页应用——ChatGPT 网页端风格的“聊天 + 生图”，带注册、积分、兑换码和管理后台；所有模型能力来自自部署的 chatgpt2api（OpenAI 兼容接口）。

**范围内**

- 用户注册/登录、个人中心（资料、积分、积分流水、会话历史、生图历史、兑换码）
- 聊天（免费）、生图/改图（按积分）
- 管理后台：用户 CRUD、积分调整、兑换码、系统设置、上游与模型、价格表、数据看板、审计日志

**范围外（本期不做）**

在线支付/充值；给开发者发 API Key 的开放 API；多租户/团队；订阅套餐；RAG/文件知识库；MCP/工具调用；联网搜索；原生 App；账号池管理（属于 chatgpt2api 自身职责）。

### 核心业务规则

| 编号 | 规则 |
| --- | --- |
| BR-01 | 聊天对所有已登录用户免费，仅受后台配置的频率/每日条数限制（保护上游号池） |
| BR-02 | 生图/改图消耗积分，单价由后台“价格表”按质量配置（例：低 5 / 中 7 / 高 10 积分每张） |
| BR-03 | 注册赠送积分数后台可配：配 0 则新用户余额为 0，配 10 则为 10 |
| BR-04 | 每日赠送生图积分，数量后台可配（0 = 关闭）；当天有效、次日重置、不累计 |
| BR-05 | 用户可用兑换码兑换积分；兑换码由后台批量生成与管理 |
| BR-06 | 积分一律为整数；所有变动写入只增不改的流水表；扣费事务化、幂等，失败自动退还 |

### 默认决策（可改）

| 编号 | 决策 |
| --- | --- |
| D-01 | 注册方式：邮箱 + 密码；邮箱验证码开关由后台控制（默认开），SMTP 在后台配置 |
| D-02 | 积分分两个桶：**每日赠送桶**（当日有效）+ **永久桶**（注册赠送、兑换码、管理员发放）。扣费顺序：先每日桶，后永久桶 |
| D-03 | 每日桶按后台设置的时区（默认 `Asia/Shanghai`）零点重置，采用“懒重置”：用户当日首次读取/扣费时检查并重置，不依赖定时任务 |
| D-04 | 生图失败/部分失败：按实际成功张数结算，其余退回原来扣的桶（可追溯） |
| D-05 | 首位管理员由环境变量 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 在首次启动时创建 |
| D-06 | 界面默认简体中文，所有文案走 i18n key，预留英文 |
| D-07 | 图片默认存本地卷 `/data/images`，通过存储接口抽象，后续可换 S3 |

## 2. 参考项目：只借逻辑，不复制代码

| 项目 | 借鉴什么 | 不要什么 |
| --- | --- | --- |
| DEEIX Chat | 上游渠道 → 平台模型 → 真实模型 的映射；模型能力 JSON；优先级/权重/熔断思路；SSE 流式对话；生图与文本分离的“任务”式流程；单进程托管前端静态资源 | RAG、MCP、SSO、订阅计费、对话分支等重功能 |
| sub2api | 后台用户管理（列表/搜索/筛选/详情/余额调整/批量操作）；兑换码（批量生成/状态/使用记录）；系统设置页结构；Docker Compose 一键部署脚本（自动生成密钥）；GHCR 镜像发布 | API Key 分发、账号调度、并发槽、token 级计费 |
| chatgpt2api | 上游接口契约（OpenAI 兼容的 `/v1/images/generations`、`/v1/images/edits`）；在线画图页交互：质量/尺寸/比例/数量选择、参考图上传、多图编辑、结果再加入编辑 | 号池管理、账号导入、注册机（属上游职责） |
| new-api | 渠道与模型管理、可配置定价/倍率、兑换码、额度日志的思路 | 令牌管理、多渠道协议转换 |
| grok2api | 仅作“同类上游网关”参考，用来确认适配器边界（将来可加其它上游） | MVP 不接入 |

**许可证提醒**：本项目要求“从 0 重写”，即使思路相同也不得拷贝参考项目的文件或函数。部分参考项目使用 AGPL/LGPL 等有传染性的许可证，请自行核实后再决定是否借鉴具体实现。

## 3. 角色与总体架构

**角色**：访客（仅能看到登录/注册页）、注册用户、管理员。

```
浏览器 (Vue SPA)
    │  HTTPS (SSE / JSON / multipart)
    ▼
lumi 单进程 (Go)：API + 静态资源 + 后台任务
    │            │            │
    ▼            ▼            ▼
PostgreSQL     Redis      本地卷 /data (图片)
    │
    ▼  OpenAI 兼容协议（经 upstream.Adapter）
你自部署的 chatgpt2api
```

- 模块化单体，模块：`auth` `user` `credits` `redeem` `upstream` `model` `chat` `image` `storage` `settings` `admin` `audit` `jobs`。
- 分层：`handler → service → repository`；上游访问只经 `upstream.Adapter` 接口，方便以后换上游。

## 4. 技术要求与规范

### 4.1 技术栈（已锁定，不要自行替换）

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 后端 | Go 1.24+、Gin | 模块化单体 |
| 数据库 | PostgreSQL 16 | `pgx/v5` + `sqlc`；迁移用 `goose`（SQL 文件嵌入二进制，启动时自动执行并加 advisory lock） |
| 缓存 | Redis 7 | 限流、登录防爆破、验证码、并发控制、SSE 断线重连缓冲 |
| 前端 | Vue 3 + Vite + TypeScript(strict) + Pinia + Vue Router + TailwindCSS | 与 sub2api 同栈，便于对照后台交互；构建产物由 Go `go:embed` 托管 |
| 渲染 | markdown-it + Shiki(懒加载) + KaTeX(懒加载) + DOMPurify | 防 XSS |
| UI | lucide 图标 + Reka UI（无样式组件） | 不引入重型 UI 库 |
| 实时 | 聊天流式用 SSE；生图任务进度用 SSE，失败降级为轮询 |  |
| 认证 | access JWT（15 分钟）+ refresh token（HttpOnly、SameSite=Lax cookie，30 天，服务端可吊销，使用即轮换） |  |
| 密码 | argon2id |  |
| 日志 | `log/slog` JSON，带 request\_id |  |
| 接口文档 | `docs/openapi.yaml`，前端类型由 openapi-typescript 生成 |  |
| 镜像 | 多阶段构建，非 root 运行，linux/amd64 + linux/arm64 |  |
| CI/CD | GitHub Actions → GHCR | 见第 16 章 |

### 4.2 仓库结构

```
lumi/
├─ AGENTS.md
├─ docs/            REQUIREMENTS.md  DECISIONS.md  openapi.yaml
├─ backend/
│  ├─ cmd/lumi/main.go
│  ├─ internal/
│  │  ├─ config/  http/{handler,middleware,router}/
│  │  ├─ auth/ user/ credits/ redeem/ settings/ audit/
│  │  ├─ upstream/{adapter,client,health,mock}/ model/
│  │  ├─ chat/ image/ storage/ admin/ jobs/
│  │  └─ platform/{db,redis,mailer,logger}/
│  ├─ migrations/   queries/   sqlc.yaml
│  └─ web/dist/     (前端构建产物，git 忽略，用于 embed)
├─ frontend/src/{app,pages,features,components,stores,api,i18n,styles}
├─ deploy/  docker-compose.yml  docker-compose.dev.yml  .env.example
│           docker-deploy.sh  Caddyfile.example  nginx.conf.example
├─ .github/workflows/  ci.yml  release.yml
├─ Dockerfile
└─ Makefile         (dev / lint / test / build / migrate / sqlc / docker)
```

### 4.3 前端性能要求（针对“卡顿”问题，必须达标）

| 编号 | 要求 |
| --- | --- |
| NFR-P01 | 首屏 JS（gzip）≤ 250KB；路由级拆包；Shiki、KaTeX 等按需动态 import |
| NFR-P02 | 流式渲染节流：SSE 增量先进缓冲，用 `requestAnimationFrame` 合并，每帧最多更新一次 DOM；markdown 增量解析——已完成的块（段落/代码块）缓存不重渲，只重渲最后一个未完成块 |
| NFR-P03 | 长列表虚拟化：会话侧栏、消息列表（超过 100 条）、图库 |
| NFR-P04 | 图片列表一律使用服务端生成的 WebP 缩略图（长边 ≤ 512）；原图仅在预览/下载时加载；懒加载 + 固定宽高占位，避免布局抖动 |
| NFR-P05 | 消息数据用不可变更新 + `shallowRef`，禁止对大数组做深度监听 |
| NFR-P06 | 输入框状态与消息列表隔离，打字时不得触发消息列表重渲染 |
| NFR-P07 | 自动滚动：仅当用户停留在底部时跟随；用 IntersectionObserver 判断，不在每个 token 上读取布局 |
| NFR-P08 | 指标：桌面 Lighthouse Performance ≥ 90；INP < 200ms；流式输出期间主线程长任务（>50ms）占比 < 5% |
| NFR-P09 | 后端：SSE 响应设置 `X-Accel-Buffering: no` 且不做 gzip 缓冲；平台自身额外延迟（不含上游）p95 < 100ms；列表接口全部游标分页，无 N+1 查询 |

### 4.4 后端规范

- 统一错误响应体包含 `code`（大写蛇形常量，如 `CREDITS_INSUFFICIENT`）、`message`、`request_id` 三个字段。
- 时间一律 UTC 存储（`timestamptz`），接口返回 RFC3339，展示层按用户时区转换。
- **积分变动只能经 `credits.Service`**：同一事务内 `SELECT ... FOR UPDATE` 锁定用户积分行并写流水；流水带 `idempotency_key` 唯一约束。
- 生图提交、兑换码兑换必须支持 `Idempotency-Key` 请求头。
- 业务层不得直接拼 HTTP 调上游，只能调 `upstream.Adapter`。
- 上游 API Key 用 AES-256-GCM 加密入库（密钥来自 `ENCRYPTION_KEY`），接口永不回传明文，只回传尾 4 位。
- 配置优先级：环境变量 > 数据库 `settings` 表；后台可改的配置带 30 秒内存缓存并在变更时主动失效。
- 限流（Redis 滑动窗口）：登录、注册、发验证码、兑换、聊天、生图分别独立配置。
- 优雅退出：收到 SIGTERM 后最多等待 60 秒让进行中的 SSE 与生图任务收尾；启动时扫描状态为 `running` 的任务，标记失败并退款。

### 4.5 工程规范（摘成 AGENTS.md）

- 代码与注释用英文；用户可见文案全部走 i18n（zh-CN 为主）。
- Go：`gofmt`、`golangci-lint`（启用 errcheck、govet、staticcheck、gosec）；错误用 `fmt.Errorf("...: %w", err)` 包装；`context` 贯穿调用链；不使用全局可变状态。
- TypeScript：`strict`；ESLint + Prettier；禁止 `any`（例外需注释说明）。
- 提交遵循 Conventional Commits；每个里程碑一个分支/PR，PR 描述附验收清单勾选情况。
- 不得拷贝参考项目代码；不得提交任何密钥；`.env` 加入 `.gitignore`。
- 新增依赖要在 `docs/DECISIONS.md` 记理由；依赖版本锁定（`go.sum`、`pnpm-lock.yaml`）。
- 每个功能随 PR 附：迁移文件、测试、OpenAPI 更新、必要文档。
- SQL 迁移只增不改（forward-only）。

### 4.6 测试要求

- 后端：service 层单元测试 + 集成测试（testcontainers 启动 PG/Redis）。**必须覆盖**：积分并发扣费不超扣；兑换码并发只能用一次；每日桶跨日懒重置；生图部分失败退款；幂等键重复提交。
- 提供 `mock-upstream`（`internal/upstream/mock`，基于 httptest）模拟 chatgpt2api：成功 / 超时 / 429 / 5xx / 部分成功 / 流中断。
- 前端：Vitest（store、工具函数）+ Playwright E2E 冒烟（注册 → 聊天 → 兑换 → 生图 → 后台调整积分）。
- CI 门槛：lint + 单测 + 集成测试 + 构建全部通过才可合并。

## 5. 注册、登录与账号（F-AUTH）

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| F-AUTH-01 | P0 | 邮箱 + 密码注册；密码 ≥ 8 位且含字母和数字；邮箱唯一且大小写不敏感 |
| F-AUTH-02 | P0 | 后台可关闭注册；邮箱验证码开关；邮箱域名白名单/黑名单（拦截一次性邮箱） |
| F-AUTH-03 | P0 | 注册成功后按 BR-03 发放注册积分：与创建用户在同一事务，写流水 `signup_bonus`，幂等；配置为 0 则不写流水、余额为 0 |
| F-AUTH-04 | P0 | 登录/登出/刷新令牌；同账号 + IP 连续失败 5 次锁定 15 分钟（Redis 计数） |
| F-AUTH-05 | P0 | 被禁用账号不可登录，已登录会话立即失效（吊销 refresh token，用户表 `token_version` 自增使未过期的 access token 失效） |
| F-AUTH-06 | P1 | 找回密码：邮件一次性链接，30 分钟有效 |
| F-AUTH-07 | P1 | Cloudflare Turnstile（后台开关 + Key 配置），保护注册与发验证码。注册送积分 + 每日赠送很容易被薅，上线前必须有此项或等价的 IP 限流 |
| F-AUTH-08 | P1 | 同 IP 注册频率限制：每 IP 每天最多 N 个（后台可配） |
| F-AUTH-09 | P1 | 多端会话管理：个人中心查看登录设备并可踢出 |
| F-AUTH-10 | P2 | 第三方登录（OAuth/OIDC）、TOTP 两步验证 |

## 6. 聊天模块（F-CHAT）

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| F-CHAT-01 | P0 | 布局参考 ChatGPT 网页端：左侧栏（新建对话、会话列表、底部用户菜单）；顶部模型选择器；中间消息流；底部输入框。移动端侧栏为抽屉 |
| F-CHAT-02 | P0 | 流式回复（SSE）；停止生成；失败显示错误与“重试”按钮 |
| F-CHAT-03 | P0 | Markdown 渲染：代码块（语法高亮 + 一键复制）、表格、列表、LaTeX；所有 HTML 经 DOMPurify 清洗 |
| F-CHAT-04 | P0 | 会话管理：自动命名（首轮结束后让上游生成 ≤ 20 字标题，失败则截取首句）、重命名、删除、置顶、按标题搜索 |
| F-CHAT-05 | P0 | 消息操作：复制、重新生成、编辑最后一条用户消息并重发 |
| F-CHAT-06 | P0 | 上下文策略：发送最近 N 条消息且估算 token 不超过后台上限（默认 N=20、32k 估算 token），超出从最早的开始丢弃，system prompt 始终保留 |
| F-CHAT-07 | P0 | 限制：每用户每分钟请求数、每日消息数（后台可配，0 = 不限），超限给出明确提示 |
| F-CHAT-08 | P1 | 图片理解：模型能力 JSON 中 `vision=true` 时，聊天输入框显示图片上传按钮 |
| F-CHAT-09 | P1 | 个人自定义指令（个人中心设置）+ 后台全局 system prompt，两者拼接注入 |
| F-CHAT-10 | P1 | 断线续传：服务端把流缓冲到 Redis（TTL 5 分钟），前端用 `Last-Event-ID` 续传；不可恢复时落库已生成部分并标记 `interrupted` |
| F-CHAT-11 | P1 | 会话导出为 Markdown；全文搜索会话内容 |
| F-CHAT-12 | P2 | 对话分支、文件/RAG、联网搜索、工具调用、分享链接 |

**聊天后端流程**

1. 校验登录、限流、模型可用。
2. 落库用户消息 + 空的助手消息（`status=streaming`）。
3. 按上下文策略组装 messages，经 `Adapter.ChatStream` 调上游 `POST /v1/chat/completions`（`stream=true`）。
4. 上游增量透传为 SSE 事件：`meta`（消息 id）、`delta`（文本增量）、`done`、`error`（含 code 与 message）；服务端同步累加，每 2 秒或结束时落库一次。
5. 结束时写入 `finish_reason`、usage（如有）、耗时、所用上游与模型。
6. 上游失败：仅在尚未输出任何 token 时，按优先级切换下一个上游重试；已输出内容则直接报错并保留已生成部分。

## 7. 生图模块（F-IMG）

### 7.1 模式切换（对标 ChatGPT 网页端的聊天/工作切换）

- **F-IMG-01（P0）**：对话页提供分段切换器「聊天｜生图」（桌面放在侧栏顶部，移动端放页面顶部）。切换时：路由在 `/chat` 与 `/create` 之间切换（保留 `/chat/:id`、`/create/:id`）；侧栏会话列表、顶部模型选择器、底部输入区随模式变化；两种模式各自记住最后打开的会话；切换无整页刷新、无白屏。
- 会话表 `conversations.type` 取 `chat` 或 `image`，两类会话分别列表，互不混杂。

### 7.2 生图对话（用对话的方式生图）

- **F-IMG-02（P0）**：生图会话是消息流。用户消息 = 提示词 + 参数快照 + 参考图；助手消息 = 结果图片网格 + 状态（排队/生成中/完成/部分失败/失败）+ 实际消耗积分。同一会话内可连续追问、基于上一次结果继续改。
- **F-IMG-03（P0）**：输入区参数栏（参考 chatgpt2api 画图页）：

| 参数 | 选项 | 说明 |
| --- | --- | --- |
| 质量 quality | low / medium / high（默认 medium） | 选项与单价取自价格表，后台关闭的档位不显示 |
| 尺寸 size | 1024×1024、1536×1024、1024×1536、auto | 可用尺寸列表后台可配 |
| 宽高比 ratio | 1:1、3:2、2:3、4:3、3:4、16:9、9:16 | 选比例后自动映射到最接近的受支持尺寸；映射表存 settings，可在后台改；尺寸与比例联动，不得出现冲突状态 |
| 数量 n | 1–4 | 上限后台可配，默认 4 |
| 参考图 | 0–N 张 | 上限后台可配，默认 4；单张 ≤ 10MB；jpeg/png/webp；服务端校验魔数并重编码去除 EXIF |

- **F-IMG-04（P0）**：费用预估。输入区实时显示「本次预计消耗 X 积分｜当前可用 Y」；不足时发送按钮置灰并提示，附“去兑换”入口。
- **F-IMG-05（P0）**：提交后立即返回任务 id；前端显示占位骨架；进度经 SSE 推送，断线自动降级为 3 秒轮询；用户离开页面任务继续，回来能在历史里看到结果。
- **F-IMG-06（P0）**：并发限制：每用户同时进行的任务 ≤ 2（后台可配）；全站并发上限（后台可配，保护上游号池）；超出则排队（Redis 队列），显示排队位置。

### 7.3 结果展示与操作

- **F-IMG-07（P0）**：图片网格 + 点击进入大图预览（左右切换、缩放、显示提示词与参数）。
- **F-IMG-08（P0）**：每张图的操作：下载原图、复制图片、**加入编辑**、用同参数重新生成、查看参数、删除。
- **F-IMG-09（P1）**：批量选择下载（zip）与批量删除。
- **F-IMG-10（P1）**：列表使用服务端缩略图；原图通过带过期签名的鉴权 URL 访问（默认 1 小时有效），防盗链与遍历。

### 7.4 编辑（改图）

- **F-IMG-11（P0）**：输入区添加参考图有 4 种来源：本地选择、拖拽、粘贴、**从已有图片添加**（本会话历史图、生图历史图库、聊天里上传过的图片）。
- **F-IMG-12（P0）**：在任意已生成图片上点“加入编辑”，该图作为参考图加入当前输入区（可继续叠加其他参考图），提示词框自动聚焦。
- **F-IMG-13（P0）**：提交规则：无参考图走 `images/generations`；有参考图走 `images/edits`（多图参考遵循上游契约）。费用规则同 BR-02，编辑与生成共用价格表（可在后台为“编辑”设置倍率，默认 1.0）。
- **F-IMG-14（P0）**：已在库中的图片按 file id 引用，服务端直接复用，不让浏览器重复上传。
- **F-IMG-15（P2）**：局部重绘（蒙版）、画笔涂抹。

### 7.5 生图任务状态机与结算

状态：`queued → running → succeeded / partial / failed / canceled`。

- 提交时：校验参数 → 计算费用 → 同一事务内扣费（流水 `image_charge`，记录扣自哪个桶）并创建任务。
- 完成时：按成功张数结算；失败的张数写 `image_refund` 退回。
- 失败/取消/超时：全额退回。
- 服务重启：启动时扫描超时的 `queued`/`running` 任务，标记失败并退款。
- 上游调用超时默认 180 秒（可配）。
- 当 n > 1 时，后台开关“拆分并发请求”：对上游并发发 n 个 `n=1` 的请求，提高成功率并支持部分成功。

## 8. 积分体系（F-CR）

### 8.1 账户结构

- 表 `credit_accounts`：`user_id`、`permanent_balance`、`daily_balance`、`daily_reset_on`（日期，按配置时区）、`version`。
- 可用积分 = `daily_balance` + `permanent_balance`；每次读取与扣费前先做**每日懒重置**。
- 每日懒重置（同一事务）：若 `daily_reset_on` 早于今天，则先把旧的每日余额写一条 `daily_expire`（负数，旧余额 > 0 时才写），再按当前配置写一条 `daily_grant`（正数），并更新 `daily_reset_on`。

### 8.2 流水类型

| type | 方向 | 桶 | 说明 |
| --- | --- | --- | --- |
| signup\_bonus | + | 永久 | 注册赠送，数量取自后台配置，0 则不写 |
| daily\_grant | + | 每日 | 每日重置时发放 |
| daily\_expire | − | 每日 | 重置时清零前一天的剩余 |
| redeem | + | 永久 | 兑换码兑换 |
| admin\_adjust | ± | 默认永久 | 管理员增加/扣减/设为，必须填备注 |
| image\_charge | − | 先每日后永久 | 一次扣费可能拆成两条流水（每桶一条） |
| image\_refund | + | 原桶 | 若原每日桶已跨日重置，则退入永久桶 |

流水表字段：`id`、`user_id`、`type`、`bucket`、`delta`、`bucket_balance_after`、`total_after`、`ref_type`、`ref_id`、`idempotency_key`（唯一）、`operator_id`、`note`、`created_at`。

### 8.3 价格表（后台可配）

- 表 `pricing_rules`：`model_id`（空 = 全局默认）、`operation`（generate/edit）、`quality`（low/medium/high）、`credits_per_image`（整数 ≥ 0）、`enabled`。
- 费用 = `ceil(单价 × 编辑倍率 × 尺寸倍率) × n`；尺寸倍率存 settings（默认全部 1.0，用于大尺寸加价）。
- 后台页面：表格内直接编辑；支持“全局默认 + 按模型覆盖”；保存即生效（缓存主动失效）。
- 价格在任务创建时快照到任务（`unit_price`、`total_cost`），之后改价不影响在途与历史任务。

### 8.4 赠送配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `signup_bonus_credits` | 10 | 整数 ≥ 0；0 = 新用户余额为 0；只影响之后的注册 |
| `daily_free_credits` | 5 | 整数 ≥ 0；0 = 关闭每日赠送；只影响之后的重置 |
| `credits_timezone` | Asia/Shanghai | 每日重置所用时区 |

每日赠送桶只用于生图扣费（聊天免费不涉及积分）。

### 8.5 一致性要求（必须有测试）

- 所有积分变动在单个事务内完成：锁 `credit_accounts` 行 → 校验 → 更新 → 写流水。
- 余额不得为负（DB `CHECK` 约束 + 业务校验）。
- 管理员“设为”操作换算为差值流水，不允许直接覆盖余额。
- 流水表只增不改：业务层不提供 UPDATE/DELETE，生产库用权限或触发器兜底。
- P1：每日对账任务校验 `余额 == 流水之和`，不一致写审计告警。

## 9. 兑换码（F-RC）

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| F-RC-01 | P0 | 个人中心“兑换积分”输入框；成功返回获得积分与新余额；失败原因区分：无效 / 已使用 / 已过期 / 已禁用 |
| F-RC-02 | P0 | 限流：每用户每分钟 ≤ 5 次；连续失败 10 次冷却 1 小时（防暴力猜码） |
| F-RC-03 | P0 | 用户可查看自己的兑换记录（时间、码尾号、积分） |
| F-RC-04 | P0 | 后台批量生成：数量 1–1000、每码积分、前缀（可选）、有效期（可选）、可用次数（默认 1；大于 1 表示多人可用，每个用户限兑 1 次）、批次名/备注。码用加密安全随机数生成，16 位 Crockford Base32，按 4-4-4-4 分组 |
| F-RC-05 | P0 | 后台列表：按批次、状态（未使用/已使用/已过期/已禁用）筛选，搜索码，分页；操作：禁用/启用、删除（仅未使用）、复制、批量导出 CSV |
| F-RC-06 | P0 | 后台兑换记录：谁、何时、哪个码、IP；可按用户或码查询 |
| F-RC-07 | P0 | 兑换事务：锁码行 → 校验状态/有效期/次数/该用户是否已兑 → 增加永久桶 → 写 `redeem` 流水 → 写 `redeem_records`；`(code_id, user_id)` 唯一约束；次数用完则状态置为 used |

## 10. 上游接入与模型管理（F-UP）

### 10.1 上游渠道（后台）

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| F-UP-01 | P0 | 渠道增删改查：名称、Base URL（如 `https://你的域名/v1`）、API Key（加密存储）、超时（文本/生图分别配置，默认 120s / 180s）、代理（可选）、启用状态、优先级、权重、备注 |
| F-UP-02 | P0 | “测试连接”：调用 `GET /v1/models`，显示延迟与结果；失败给出原因（网络/401/超时） |
| F-UP-03 | P0 | “同步模型”：拉取上游模型列表，勾选后导入为平台模型 |
| F-UP-04 | P1 | 健康检查与熔断：连续 5 次失败 → 熔断 60 秒 → 半开探测（次数与时长可配）；熔断期间路由跳过；后台显示状态与最近错误 |
| F-UP-05 | P1 | 路由：按平台模型绑定的渠道列表，先按优先级、同优先级按权重随机；失败自动切换（规则见第 6、7 章） |
| F-UP-06 | P1 | 环境变量引导：首次启动若设置了 `UPSTREAM_BASE_URL` 与 `UPSTREAM_API_KEY`，自动创建默认渠道与默认平台模型 |

### 10.2 平台模型

- 表 `models`：`id`、`display_name`（用户看到的名字）、`type`（chat/image）、`description`、`icon`、`sort_order`、`enabled`、`is_default`、`capabilities`（JSONB）。
- 表 `model_routes`：`model_id`、`upstream_id`、`upstream_model_name`、`priority`、`weight`、`enabled`。即“平台模型 → 渠道 → 真实模型名”的映射（借鉴 DEEIX 的思路，精简为一层）。
- `capabilities` 字段：聊天模型 `vision`、`max_context_tokens`、`stream`；生图模型 `qualities`、`sizes`、`max_n`、`supports_edit`、`max_reference_images`、`response_format`。
- **F-UP-07（P0）**：用户端只看到已启用的模型；前端模型选择器按当前模式（聊天/生图）过滤；默认模型自动选中。
- **F-UP-08（P0）**：用户端永不暴露上游名称、URL、真实模型名。

### 10.3 上游契约与适配器

```go
type Adapter interface {
    ListModels(ctx context.Context) ([]UpstreamModel, error)
    ChatStream(ctx context.Context, req ChatRequest) (<-chan ChatEvent, error)
    GenerateImages(ctx context.Context, req ImageGenRequest) (ImageResult, error)
    EditImages(ctx context.Context, req ImageEditRequest) (ImageResult, error)
}
```

已知信息（来自 chatgpt2api README，**以下全部待实测确认**）：

| 能力 | 端点 | 备注 |
| --- | --- | --- |
| 模型列表 | `GET /v1/models` | OpenAI 兼容 |
| 聊天 | `POST /v1/chat/completions` | 使用 `stream=true`；README 称支持文本模型 |
| 生图 | `POST /v1/images/generations` | 常见字段 `model`、`prompt`、`n`、`size`、`response_format`；质量与比例的字段名待确认 |
| 改图 | `POST /v1/images/edits` | 可能是 multipart 上传，也可能是 JSON 的 `images` 数组（元素含 `image_url`），待确认 |
| 鉴权 | `Authorization: Bearer <key>` |  |

**契约确认任务（M3 的第一步，必须先做）**：写一个探测工具 `backend/cmd/probe`，读取 `UPSTREAM_BASE_URL` 与 `UPSTREAM_API_KEY`，实测并把结果写入 `docs/UPSTREAM_CONTRACT.md`：

1. `/v1/models` 返回哪些模型 id（文本模型、图片模型）。
2. 聊天流式 chunk 格式；是否支持 vision、system role。
3. 生图：支持哪些 size / quality 取值、n 的上限、返回 `b64_json` 还是 `url`、单次耗时、失败时的错误体格式。
4. 改图：multipart 还是 JSON、字段名、最多几张参考图。
5. 限流（429）时的表现。

然后据此调整 Adapter 实现和 7.2 的参数表；`mock-upstream` 必须与该契约一致。

### 10.4 其它要求

- 生图结果入库：上游返回 `url` 时由服务端下载（超时 + 20MB 上限，只允许下载与渠道同域的地址，防 SSRF）；返回 `b64_json` 则直接解码。统一保存原图 + WebP 缩略图。
- 上游错误统一映射为平台错误码：`UPSTREAM_TIMEOUT`、`UPSTREAM_RATE_LIMITED`、`UPSTREAM_UNAVAILABLE`、`UPSTREAM_REJECTED`（内容被拒绝，不重试，退款）。用户端只显示友好文案，原始错误只进日志与后台任务详情。
- 每次上游调用记录到 `upstream_calls`：渠道、模型、耗时、状态、错误摘要，保留 30 天。

## 11. 用户个人中心（F-ME）

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| F-ME-01 | P0 | 个人资料：昵称、头像（≤ 2MB，服务端缩放到 256px）、邮箱（只读）、注册时间、修改密码（需旧密码） |
| F-ME-02 | P0 | 积分概览：总可用、每日赠送余额与下次重置时间、永久余额；兑换码输入入口 |
| F-ME-03 | P0 | 积分流水：分页列表（时间、类型、变动、变动后余额、备注/关联生图任务）；按类型与时间筛选 |
| F-ME-04 | P0 | 积分使用情况：近 30 天按天的消耗柱状图 + 本月已消耗积分 + 生图张数（按质量分） |
| F-ME-05 | P0 | 聊天历史：全部聊天会话，支持搜索、重命名、删除、批量删除、清空全部 |
| F-ME-06 | P0 | 生图历史：图库网格（时间倒序、游标分页、虚拟滚动）；按质量/日期/状态筛选；点击看大图与参数；下载、删除、**加入编辑**（跳转生图页并带入参考图） |
| F-ME-07 | P1 | 个人偏好：语言、主题（浅色/深色/跟随系统）、自定义指令、默认生图参数（质量/比例/数量） |
| F-ME-08 | P1 | 账号安全：登录设备列表与踢出；删除账号（二次确认，立即注销，7 天后清除数据） |
| F-ME-09 | P1 | 数据导出：聊天记录导出为 JSON / Markdown |

## 12. 管理后台（F-ADM）

入口 `/admin`，仅 `role=admin` 可访问；独立布局（左侧导航），信息架构参考 sub2api 后台。**所有写操作记入审计日志。**

### 12.1 数据看板

- **F-ADM-01（P0）**：今日 / 近 7 天 / 近 30 天：用户总数、新增、活跃（DAU）；聊天消息数；生图张数（成功/失败）与成功率；积分发放（注册/每日/兑换/管理员）与消耗；上游调用成功率与平均耗时；配趋势图。

### 12.2 用户管理（对标 sub2api）

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| F-ADM-02 | P0 | 列表：分页；搜索（邮箱/昵称/ID）；筛选（状态、角色、注册时间、余额范围）；排序（注册时间、最后登录、余额）；列含 ID、邮箱、昵称、角色、状态、总积分（每日 + 永久）、生图数、最后登录时间与 IP、注册时间 |
| F-ADM-03 | P0 | 新增用户：邮箱、密码、昵称、角色、初始积分（可选，写 `admin_adjust` 流水） |
| F-ADM-04 | P0 | 编辑用户：昵称、邮箱、角色、状态（启用/禁用）、重置密码（直接设置新密码，或发送重置邮件） |
| F-ADM-05 | P0 | 调整积分：增加 / 扣减 / 设为；可选桶（默认永久）；备注必填；扣减不得使余额为负；结果实时回显 |
| F-ADM-06 | P0 | 删除用户：软删除（`deleted_at`），保留 30 天后物理清理；弹窗需输入邮箱二次确认；不可删除自己，也不可删除最后一个管理员 |
| F-ADM-07 | P0 | 用户详情页（分 Tab）：资料 / 积分与流水 / 生图记录 / 聊天会话（元数据，内容可见性见 D-08）/ 登录与设备 / 兑换记录 |
| F-ADM-08 | P1 | 批量操作：批量启用/禁用、批量发放积分、批量删除；导出用户 CSV |
| F-ADM-09 | P1 | 强制下线：吊销该用户全部会话 |

**D-08（默认决策）**：管理员查看用户聊天内容与生图提示词的权限默认关闭，由后台开关 `admin_can_view_content` 控制；开启后每次查看都写审计日志；需在隐私政策中告知用户。

### 12.3 兑换码、积分与价格

- **F-ADM-10（P0）**：兑换码管理，见第 9 章。
- **F-ADM-11（P0）**：价格表页面、赠送配置页面，见 8.3 与 8.4。
- **F-ADM-12（P0）**：全站积分流水查询（按用户、类型、时间范围，可导出 CSV）。

### 12.4 上游与模型

- **F-ADM-13（P0）**：渠道管理，见 10.1。
- **F-ADM-14（P0）**：平台模型管理与路由绑定，见 10.2。

### 12.5 内容与任务

- **F-ADM-15（P0）**：生图任务列表：用户、状态、质量、张数、耗时、错误、费用；可筛选，可查看详情与参数，可删除图片；P1 增加“手动退款”。
- **F-ADM-16（P1）**：聊天会话列表（元数据，受 D-08 控制）。

### 12.6 系统设置（分组页面，保存即生效）

| 分组 | 配置项 |
| --- | --- |
| 站点 | 名称、Logo、Favicon、公告（登录后顶部横幅，支持 Markdown）、页脚、联系方式、服务条款与隐私政策链接 |
| 注册与安全 | 开放注册、邮箱验证、域名白/黑名单、Turnstile、每 IP 注册上限、登录失败锁定参数 |
| 邮件 | SMTP 主机/端口/账号/加密方式/发件人，“发送测试邮件”按钮 |
| 聊天 | 每分钟/每日上限、上下文条数与 token 上限、全局 system prompt、标题生成所用模型 |
| 生图 | 最大 n、最大参考图数与大小、可用尺寸与比例映射、每用户并发、全站并发、超时、拆分并发开关、结果保留天数（0 = 永久）、提示词敏感词（P1） |
| 积分 | 注册赠送、每日赠送、重置时区 |
| 存储 | 图片目录、保留策略、缩略图参数 |
| 维护模式 | 开启后非管理员看到维护页 |

### 12.7 其它后台功能

- **F-ADM-17（P0）**：审计日志：谁、何时、做了什么（用户/积分/兑换码/设置/上游）、对象、变更前后（敏感字段脱敏）、IP；可筛选；保留 180 天。
- **F-ADM-18（P1）**：公告管理（可多条，支持起止时间）。
- **F-ADM-19（P1）**：系统信息页：版本、构建时间、运行时长、DB/Redis 状态、图片目录占用、一键清理过期图片。

### 12.8 后台定时任务（`jobs` 模块）

每小时执行（Redis 锁保证多实例只跑一次）：清理超过保留期的图片；物理清理软删除超过 30 天的用户；清理过期验证码与 refresh token；清理 `upstream_calls` 过期记录；标记并退款超时的生图任务。

## 13. 数据模型（主要表）

主键用 UUID（v7 优先），时间字段均为 `timestamptz`。字段为最小集合，Codex 可按需补充，但不得删减。

| 表 | 关键字段 | 索引与备注 |
| --- | --- | --- |
| `users` | `id`、`email`（citext）、`password_hash`、`nickname`、`avatar_file_id`、`role`（user/admin）、`status`（active/disabled）、`token_version`、`locale`、`timezone`、`last_login_at`、`last_login_ip`、`created_at`、`deleted_at` | `email` 在未删除范围内唯一；`created_at` 索引 |
| `user_sessions` | `id`、`user_id`、`token_hash`、`device`、`ip`、`user_agent`、`expires_at`、`revoked_at`、`rotated_from` | refresh token 只存哈希；`(user_id, revoked_at)` |
| `verification_codes` | `id`、`target`、`purpose`、`code_hash`、`attempts`、`expires_at`、`used_at` | 过期清理任务 |
| `credit_accounts` | `user_id`（PK）、`permanent_balance`、`daily_balance`、`daily_reset_on`、`version` | 两个余额均 `CHECK >= 0` |
| `credit_ledger` | 见 8.2 | `(user_id, created_at desc)`；`idempotency_key` 唯一 |
| `redeem_batches` | `id`、`name`、`note`、`created_by`、`created_at` |  |
| `redeem_codes` | `id`、`batch_id`、`code`、`credits`、`max_uses`、`used_count`、`expires_at`、`status`、`created_at` | `code` 唯一 |
| `redeem_records` | `id`、`code_id`、`user_id`、`credits`、`ip`、`created_at` | `(code_id, user_id)` 唯一 |
| `upstreams` | `id`、`name`、`base_url`、`api_key_enc`、`timeout_chat_s`、`timeout_image_s`、`proxy_url`、`enabled`、`priority`、`weight`、`circuit_state`、`note` |  |
| `models` | 见 10.2 |  |
| `model_routes` | 见 10.2 | `(model_id, priority)` |
| `pricing_rules` | 见 8.3 | `(model_id, operation, quality)` 唯一 |
| `conversations` | `id`、`user_id`、`type`（chat/image）、`title`、`model_id`、`pinned`、`last_message_at`、`deleted_at` | `(user_id, type, last_message_at desc)` |
| `messages` | `id`、`conversation_id`、`role`、`content`、`status`、`model_id`、`upstream_id`、`meta`（JSONB：usage、finish\_reason、耗时）、`created_at` | `(conversation_id, created_at)` |
| `files` | `id`、`user_id`、`kind`（upload/generated/thumbnail/avatar）、`path`、`mime`、`size`、`width`、`height`、`sha256`、`created_at`、`deleted_at` | 路径不含用户输入；`(user_id, created_at desc)` |
| `image_tasks` | `id`、`user_id`、`conversation_id`、`message_id`、`operation`、`model_id`、`prompt`、`params`（JSONB：quality/size/ratio/n）、`reference_file_ids`、`unit_price`、`total_cost`、`refunded_cost`、`status`、`idempotency_key`、`error_code`、`error_message`、`started_at`、`finished_at` | `(user_id, created_at desc)`、`(status, created_at)`；`idempotency_key` 按用户唯一 |
| `image_results` | `id`、`task_id`、`file_id`、`position`、`revised_prompt` |  |
| `settings` | `key`、`value`（JSONB）、`updated_by`、`updated_at` |  |
| `audit_logs` | `id`、`actor_id`、`action`、`target_type`、`target_id`、`before`、`after`、`ip`、`created_at` | `(actor_id, created_at)`、`(target_type, target_id)` |
| `upstream_calls` | `id`、`upstream_id`、`model`、`kind`、`latency_ms`、`status`、`error_summary`、`request_id`、`created_at` | 保留 30 天 |
| `announcements`（P1） | `id`、`content`、`starts_at`、`ends_at`、`enabled` |  |

## 14. API 清单（前缀 `/api/v1`，完整定义写入 `docs/openapi.yaml`）

| 分组 | 方法与路径 | 说明 |
| --- | --- | --- |
| 公共 | `GET /public/config` | 站点名、注册开关、Turnstile site key、公告 |
| 认证 | `POST /auth/register`、`/auth/login`、`/auth/refresh`、`/auth/logout`、`/auth/send-code`、`/auth/forgot-password`、`/auth/reset-password` |  |
| 我的 | `GET/PATCH /me`、`POST /me/password`、`GET /me/sessions`、`DELETE /me/sessions/{id}` |  |
| 积分 | `GET /me/credits`、`GET /me/credits/ledger`、`GET /me/credits/stats`、`POST /me/redeem`、`GET /me/redeem-records` | 兑换需 `Idempotency-Key` |
| 模型 | `GET /models?type=chat 或 image` | 仅返回已启用模型与用户可见字段 |
| 会话 | `GET/POST /conversations`、`GET/PATCH/DELETE /conversations/{id}`、`DELETE /conversations?type=` | 游标分页 |
| 聊天 | `POST /conversations/{id}/chat`（SSE）、`POST /messages/{id}/regenerate`（SSE） | 客户端断开 = 停止生成 |
| 文件 | `POST /files`（上传参考图）、`GET /files/{id}?sig=`（签名访问）、`GET /files/{id}/thumb` |  |
| 生图 | `POST /image-tasks`、`GET /image-tasks/{id}`、`GET /image-tasks/{id}/events`（SSE）、`POST /image-tasks/{id}/cancel` | 提交需 `Idempotency-Key` |
| 图库 | `GET /me/images`、`DELETE /me/images/{id}`、`POST /me/images/batch-delete` | 游标分页 |
| 后台-概览 | `GET /admin/dashboard` |  |
| 后台-用户 | `GET/POST /admin/users`、`GET/PATCH/DELETE /admin/users/{id}`、`POST /admin/users/{id}/credits`、`DELETE /admin/users/{id}/sessions`、`POST /admin/users/batch` |  |
| 后台-兑换码 | `POST/GET /admin/redeem-batches`、`GET/PATCH/DELETE /admin/redeem-codes`、`GET /admin/redeem-codes/export`、`GET /admin/redeem-records` |  |
| 后台-积分 | `GET /admin/credit-ledger`、`GET/PUT /admin/pricing` |  |
| 后台-上游 | `CRUD /admin/upstreams`、`POST /admin/upstreams/{id}/test`、`POST /admin/upstreams/{id}/sync-models` |  |
| 后台-模型 | `CRUD /admin/models`、`PUT /admin/models/{id}/routes` |  |
| 后台-任务 | `GET /admin/image-tasks`、`GET /admin/image-tasks/{id}`、`POST /admin/image-tasks/{id}/refund`（P1） |  |
| 后台-系统 | `GET/PUT /admin/settings/{group}`、`GET /admin/audit-logs`、`CRUD /admin/announcements`、`GET /admin/system` |  |
| 运维 | `GET /healthz`、`GET /readyz`、`GET /api/version` | 不带前缀 |

## 15. 非功能要求

### 15.1 安全

| 编号 | 要求 |
| --- | --- |
| NFR-S01 | 密码 argon2id；JWT 密钥来自 `JWT_SECRET`；refresh cookie 设 HttpOnly + Secure + SameSite=Lax；access token 只放内存，不进 localStorage |
| NFR-S02 | 依赖 cookie 的接口（refresh/logout）校验 Origin/Referer 与自定义请求头，防 CSRF |
| NFR-S03 | 所有输入服务端校验（长度、枚举、范围）；SQL 一律参数化（sqlc） |
| NFR-S04 | XSS：Markdown 渲染白名单 + DOMPurify；设置 CSP（`default-src 'self'`，`img-src 'self' data: blob:`，禁止内联脚本） |
| NFR-S05 | 上传：限制类型/大小/数量，校验魔数，重编码，文件名随机，不使用用户提供的路径；图片访问走签名 URL |
| NFR-S06 | SSRF：只访问已配置的上游域，禁止跟随到内网 IP 的重定向 |
| NFR-S07 | 权限：admin 路由中间件 + 每个 handler 再校验；访问他人会话/图片/任务一律返回 404 |
| NFR-S08 | 日志脱敏：邮箱部分遮蔽，API Key、token、密码永不入日志；安全响应头（`X-Content-Type-Options`、`Referrer-Policy`、`frame-ancestors`），HSTS 由反向代理负责 |
| NFR-S09 | 备份：文档说明 `pg_dump` 定时备份与恢复流程，以及图片目录备份 |

### 15.2 可观测性

- `slog` JSON 日志，`request_id` 贯穿到上游调用。
- `/healthz` 仅检查进程存活；`/readyz` 检查 PG 与 Redis。
- P1：`/metrics`（Prometheus）：请求量与延迟、SSE 活跃数、各状态生图任务数、上游成功率、积分变动数。

### 15.3 合规与风险（请运营者自行评估，本文不构成法律意见）

- 提供用户协议与隐私政策页面，注册时需勾选同意。
- 内容安全：本期提供后台敏感词拦截（P1）与“上游拒绝即退款”；面向 C 端公开运营前，请自行评估所在地区对生成式 AI 服务、内容安全、数据留存、实名等方面的合规要求。
- 上游风险：chatgpt2api 属于对 ChatGPT 官网能力的逆向封装，其 README 含免责声明且声明限制商用，服务稳定性与条款风险需运营者自担。因此要求所有上游调用只走 `Adapter`，保留切换到官方 API 或其他上游的能力。
- 账号滥用：注册赠送 + 每日赠送天然吸引薅羊毛，F-AUTH-07 / F-AUTH-08 在公开上线前必须完成。

### 15.4 兼容性与体验

- 浏览器：Chrome、Edge、Safari、Firefox 最近 2 个版本；响应式最小宽度 360px；支持深色模式。
- 键盘：Enter 发送、Shift+Enter 换行；P1：Cmd/Ctrl+K 搜索会话。
- 基础无障碍：语义化标签、aria 属性、焦点管理；空状态、加载态、错误态逐页设计，不允许出现空白页。

### 15.5 容量目标（初始）

- 100 在线用户、20 并发 SSE 流、5–10 并发生图任务。
- 应用实例 2 vCPU / 2GB 内存可运行（不含 PG 与 Redis）。
- 图片按每张 1–3MB 估算存储增长，默认保留策略由后台配置，部署文档给出磁盘规划建议。

## 16. 部署与发布（Docker + GitHub Actions + GHCR）

目标流程：**代码推到 GitHub → Actions 构建多架构镜像推送到 GHCR → 服务器 `docker compose pull && up -d`**。

### 16.1 镜像与运行形态

- 一个应用镜像 `ghcr.io/<owner>/lumi`（前端静态产物嵌入 Go 二进制）；compose 同时拉起 `postgres:16-alpine` 与 `redis:7-alpine`。
- `Dockerfile` 三阶段：① `node:22-alpine`（`pnpm install --frozen-lockfile && pnpm build`）→ ② `golang:1.24-alpine`（拷入前端产物，`CGO_ENABLED=0 go build -trimpath`，用 `-ldflags` 注入 `version`、`commit`、`build_time`）→ ③ 精简运行镜像（`distroless` 或 `alpine`，仅含二进制、`ca-certificates`、`tzdata`）。
- 运行镜像要求：非 root 用户（uid 10001）；`EXPOSE 8080`；`VOLUME /data`；镜像体积目标 < 60MB；`HEALTHCHECK` 调用二进制子命令 `lumi healthcheck`（不依赖 curl）。
- 二进制子命令：`lumi serve`（默认）、`lumi migrate`、`lumi healthcheck`、`lumi admin reset-password --email <邮箱>`（运维救援用）。
- 版本信息：`GET /api/version` 返回 `version`、`commit`、`build_time`；后台系统信息页展示。

### 16.2 GitHub Actions

| 工作流 | 触发 | 内容 |
| --- | --- | --- |
| `ci.yml` | PR、push 到 main | 后端：`golangci-lint`、`go test`（含集成测试）、检查 `sqlc generate` 无差异；前端：`pnpm lint`、`typecheck`、`vitest`、`build`；检查 `openapi.yaml` 与生成类型一致；main 分支额外跑 Playwright 冒烟 |
| `release.yml` | push tag `v*.*.*`；push 到 main | 使用 `docker/setup-buildx-action`、`docker/login-action`（`GITHUB_TOKEN`，权限 `packages: write`）、`docker/metadata-action`、`docker/build-push-action`；平台 `linux/amd64,linux/arm64`；缓存 `type=gha`。tag 发布时打标签 `vX.Y.Z`、`X.Y`、`latest` 并创建 GitHub Release（自动生成变更日志）；push main 仅打 `edge` 与 `sha-xxxxxxx` |

- 镜像可设为 public；若保持 private，服务器需 `docker login ghcr.io`（使用只有 `read:packages` 权限的 PAT），文档中写明。
- 构建时注入版本号：tag 名作为 `version`，提交哈希作为 `commit`。

### 16.3 部署文件（`deploy/`）

- **`docker-compose.yml`**
  - `app`：`image: ghcr.io/<owner>/lumi:${LUMI_VERSION:-latest}`；`depends_on` 使用 `service_healthy`；`env_file: .env`；挂载 `./data/app:/data`；端口只绑定 `127.0.0.1:8080:8080`；`restart: unless-stopped`；日志 `json-file`，`max-size 10m`、`max-file 3`。
  - `postgres`：数据卷 `./data/postgres`；`pg_isready` 健康检查；不对外暴露端口。
  - `redis`：开启 `appendonly yes`；数据卷 `./data/redis`；设置 `requirepass`；不对外暴露端口。
- **`.env.example`** 变量：`LUMI_VERSION`、`PUBLIC_BASE_URL`、`TZ`、`DATABASE_URL`（或 `POSTGRES_*`）、`REDIS_URL`、`JWT_SECRET`、`ENCRYPTION_KEY`（32 字节 base64）、`ADMIN_EMAIL`、`ADMIN_PASSWORD`、`UPSTREAM_BASE_URL`（可选）、`UPSTREAM_API_KEY`（可选）、`DATA_DIR`（默认 `/data`）、`LOG_LEVEL`、`COOKIE_SECURE`、`TRUSTED_PROXIES`。每个变量写注释，密钥类变量留空由脚本生成。
- **`docker-deploy.sh`**（借鉴 sub2api 的一键部署思路，自行实现）：创建目录 → 下载 compose 与 `.env.example` → 用 `openssl rand` 生成 `JWT_SECRET`、`ENCRYPTION_KEY`、数据库与 Redis 密码、管理员初始密码 → 写入 `.env` → 打印后续命令；**幂等，已有 `.env` 时不覆盖**。
- **反向代理示例**：`Caddyfile.example`（自动 HTTPS，`reverse_proxy 127.0.0.1:8080`，`flush_interval -1`）与 `nginx.conf.example`（`proxy_buffering off`、`proxy_read_timeout 3600s`、`client_max_body_size 30m`、转发 `X-Forwarded-*`）。
- **`backup.sh`**：`pg_dump` + 打包图片目录，保留最近 N 份；附恢复步骤文档。

### 16.4 服务器上的标准流程

```
mkdir -p /opt/lumi && cd /opt/lumi
curl -fsSL <deploy 脚本地址> | bash      # 生成 compose 与 .env
vi .env                                   # 填 PUBLIC_BASE_URL、管理员邮箱等
docker compose pull && docker compose up -d
docker compose logs -f app
```

- **升级**：`docker compose pull && docker compose up -d`；生产环境建议固定 `LUMI_VERSION=vX.Y.Z`。
- **回滚**：改回旧版本号再 `up -d`。迁移为 forward-only，回滚前必须先备份；发布说明里标注含不可回滚迁移的版本。
- **数据库迁移**：应用启动时自动执行（advisory lock 防并发），也可手动 `docker compose run --rm app lumi migrate`。
- **首次启动**：按 D-05 创建管理员；上游未配置时，用户端聊天/生图提示“服务暂未配置”，管理员登录后引导去配置上游、模型与价格。
- 可选：Watchtower 自动更新（仅写入文档，默认不启用）。

### 16.5 部署验收

全新服务器只装 Docker，按文档 10 分钟内可运行；重启容器后数据不丢；升级与回滚流程在测试环境演练通过。

## 17. 开发里程碑（Codex 按顺序逐个执行）

| 里程碑 | 范围 | 完成标准（DoD） |
| --- | --- | --- |
| **M0 脚手架与 CI** | 初始化 monorepo、Makefile、Dockerfile、dev compose、lint 配置、sqlc、goose、OpenAPI 骨架；Go 服务提供 `/healthz` `/readyz` `/api/version`，`go:embed` 托管前端 Hello 页；CI 与 release 工作流跑通 | `docker compose up` 能打开首页；CI 全绿；打 `v0.0.1` 后 GHCR 出现 amd64/arm64 镜像 |
| **M1 账号与后台基础** | 迁移（users、sessions、settings、audit\_logs）；注册/登录/刷新/登出；邮箱验证码（SMTP，开发模式打印到日志）；管理员引导；前端登录/注册页、整体布局、路由守卫、i18n、深浅色主题；后台用户列表/新增/编辑/禁用/删除/详情；系统设置框架（站点、注册）；审计日志 | F-AUTH-01～05、F-ADM-02～04、06、17 |
| **M2 积分与兑换码** | `credit_accounts`/`credit_ledger`；注册赠送；每日懒重置；管理员调整；价格表与赠送配置；兑换码全流程；个人中心积分概览/流水/使用统计；后台积分流水与用户详情中的积分 Tab | F-AUTH-03、第 8 章与第 9 章全部、F-ME-02～04、F-ADM-05、11、12；并发与跨日测试通过 |
| **M3 上游与模型** | 先做契约探测并写 `UPSTREAM_CONTRACT.md`；Adapter 实现 + mock-upstream；渠道与模型管理界面；测试连接、同步模型、模型路由绑定 | F-UP-01～03、07、08；后台能连上你的 chatgpt2api 并导入模型 |
| **M4 聊天** | 会话/消息；SSE 流式；Markdown 渲染；上下文策略；限流；自动标题；个人中心聊天历史；侧栏会话列表 | F-CHAT P0、F-ME-05；NFR-P01～P09 中聊天相关项达标 |
| **M5 生图** | 文件上传与存储、缩略图；任务队列/状态机/扣费与退款；聊天/生图模式切换；参数栏与费用预估；结果展示；加入编辑；个人中心生图历史；后台任务列表 | F-IMG P0 全部、F-ME-06、F-ADM-15；部分失败退款测试通过 |
| **M6 后台完善与 P1** | 看板、批量操作、公告、系统信息、设置页补全、忘记密码、Turnstile、IP 注册限制、断线续传、熔断、对账任务、导出等所有 P1 项 | 全部 P1 项完成 |
| **M7 加固与发布** | 对照 NFR-S01～S09 做安全检查；k6 压测（100 VU）；Lighthouse；E2E 全流程；部署文档与备份脚本；README；打 `v0.1.0` 发布 | 第 18 章验收清单全部通过，并在干净服务器按文档部署验证 |

### 给 Codex 的启动提示（每个里程碑复用）

```
请先阅读 docs/REQUIREMENTS.md 与 AGENTS.md。现在执行里程碑 M{n}。
1. 先列出实现计划（文件清单、迁移、接口），然后直接开始实现，不需要等我确认。
2. 严格限制在该里程碑范围内，不提前实现后续里程碑的功能。
3. 完成后运行 make lint test，并逐条对照本里程碑的 DoD 给出结果。
4. 文档没写清楚的细节，选最简单安全的方案，并记录到 docs/DECISIONS.md。
5. 不得拷贝任何参考项目的代码。
```

## 18. 验收清单（端到端，M7 逐条勾选）

- [ ] 注册赠送配置为 10：新用户余额 = 10；改为 0 后新注册用户余额 = 0；老用户余额不变。
- [ ] 每日赠送配置为 5：次日首次访问时重置为 5，前一日剩余被清零，并有对应流水。
- [ ] 聊天流式正常，可停止、可重试；超过频率/每日限制时提示明确。
- [ ] 生图在价格表为 5/7/10 时，低/中/高质量每张分别扣 5/7/10 积分，n 张按 n 倍扣；改价后新任务按新价、历史任务不变；积分不足被拒绝并提示兑换。
- [ ] 质量、尺寸、宽高比、数量选择后，参数正确传给上游并得到遵守（以实测契约为准）。
- [ ] 上传参考图改图成功；在已生成图片上点“加入编辑”后再次生成成功；从历史图库添加参考图成功。
- [ ] 部分失败按失败张数退款；全部失败、取消、超时全额退款；退款流水可追溯。
- [ ] 兑换码：批量生成 100 个并导出 CSV；同一码并发兑换只有 1 次成功；过期/禁用/已用提示正确；多人可用码每人限兑 1 次。
- [ ] 后台：用户增删改查可用；禁用用户后立即无法登录且已登录会话失效；调整积分产生流水与审计日志；不可删除最后一个管理员。
- [ ] 用户端可看到：个人信息、积分与每日余额、积分流水与使用情况、聊天历史、生图历史。
- [ ] 聊天/生图模式切换流畅（无整页刷新、无白屏），两个模式各自记住最后的会话。
- [ ] 性能：桌面 Lighthouse ≥ 90；500 条消息的会话滚动流畅；流式输出期间无明显掉帧；1000 张图的图库滚动流畅。
- [ ] CI 全绿；打 tag 后 GHCR 有 amd64/arm64 镜像；新服务器按文档部署成功；重启后数据不丢；升级与回滚演练通过。
- [ ] 安全：未登录/越权访问被拒绝；上游 API Key 不出现在任何响应与日志中；上传非法文件被拒绝。

## 19. 待确认事项（已设默认值，不会阻塞开发）

| 问题 | 默认处理 | 影响范围 |
| --- | --- | --- |
| 邮件服务用哪家 | 后台配置 SMTP；开发模式验证码打印到日志 | 注册、找回密码 |
| 每日赠送是否累计 | 不累计，当日有效（D-02、D-03） | 积分模块 |
| 以后是否要在线充值 | 本期不做；流水 `type` 可扩展，已预留位置 | 积分、订单 |
| 价格是否按尺寸区分 | 只按质量计价，预留尺寸倍率配置 | 价格表 |
| 管理员能否查看用户聊天内容 | 默认不能，由后台开关控制（D-08） | 隐私与合规 |
| chatgpt2api 实际支持的质量/尺寸/比例字段 | 以 M3 实测契约为准 | 7.2 参数表、Adapter |
| 项目名、域名、GitHub 组织与仓库名 | 暂用 `lumi`，镜像路径 `ghcr.io/<owner>/lumi` | 镜像与部署脚本 |
| 是否需要手机号注册或实名 | 不需要 | 注册流程 |
| 仓库与镜像是否公开 | 仓库私有；镜像按需选择公开或私有 | 部署方式 |
