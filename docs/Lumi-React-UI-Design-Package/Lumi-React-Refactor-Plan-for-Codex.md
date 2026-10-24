# Lumi · React 前端重构与 UI/UX 改版执行方案

> 源仓库：`https://github.com/xinghenWink/Lumi`  
> 检查依据：2026-10-24 读取的 `main` 分支。  
> 性质：**重构设计与 Codex 实施规范**，不是已合并代码。  
> 附件：`Lumi-React-UI-Preview.html` 为独立离线视觉/交互原型，所有用户、积分、模型、后台数字均为演示数据，不可当作业务逻辑或 API 响应。

## 0. 总体决定

**仅重构 `frontend/`；暂不重写 Go 后端、数据库、SSE API、图片存储、账务、部署方式。**

新的网页采用 `React + TypeScript strict + Vite + Tailwind CSS 4 + shadcn/ui + Radix UI + lucide-react`，完成**视觉与交互重设计**，而不是 Vue → JSX 的逐文件转换。继续编译出 `backend/web/dist` 静态产物，并由 Go 二进制嵌入，维持原 Docker Compose、PG、Redis 部署结构。

## 1. 已核实的当前结构与可复用内容

| 模块        | 当前文件 / 事实                                                                                              | 迁移方案                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Vite 构建   | `frontend/vite.config.ts` 输出到 `../backend/web/dist`；Vite dev proxy `/api` 等                             | 改 React 插件，保留 outDir、assetsInlineLimit=0、proxy 和构建预算                                         |
| Go 静态资源 | `backend/web/assets_production.go` embed `all:dist`；`backend/web/web.go` SPA fallback                       | 不改 URL 约定和产物路径                                                                                   |
| CI / 质量   | `.github/workflows/ci.yml` 跑 `make lint test`、build、Playwright、k6、audit                                 | 接好 React lint/typecheck/test/e2e 后才上线                                                               |
| OpenAPI     | `docs/openapi.yaml` -> `frontend/src/api/schema.d.ts`                                                        | 路径保持，继续自动生成与一致性检查                                                                        |
| 传输层      | `frontend/src/api/transport.ts`                                                                              | 复用纯 TypeScript 解析/请求逻辑与 CSRF 头规则                                                             |
| API 校验    | `src/api/*-contracts.ts`、`accounts.ts`、`chat.ts`、`images.ts`、`credits.ts`、`catalog.ts`、`operations.ts` | 审计并复用不依赖 Vue 的业务请求、运行时验证、类型；不要重新猜测后端字段                                   |
| 认证耦合点  | `frontend/src/api/protected.ts` import `../stores/auth`                                                      | 必须替换为框架无关的 session/token provider 或请求适配器；保留 token refresh 单飞、401 retry 及跨用户隔离 |
| 前端状态    | `frontend/src/stores/{auth,chat,images,models,...}.ts` 都是 Pinia/Vue                                        | **必须重写**：服务端请求 TanStack Query，流/草稿/模态等用 Zustand 或受控 React state                      |
| SSE         | `frontend/src/api/chat.ts` 的流解析器                                                                        | 保留独立 UTF-8 解码 / SSE 边界解析、事件 last-id、停止/重试/断线续传语义                                  |
| 图库        | `frontend/src/pages/ImageGalleryPage.vue` 有缩略图、批量操作和回到编辑                                       | React 重建 UI，保留原有任务与授权图片链路                                                                 |
| 国际化      | `frontend/src/i18n/*.ts` 的中文/英文消息                                                                     | 复用文案数据，替换 `vue-i18n` 为 `react-i18next`；新文案不得硬编码在组件里                                |
| 格式化规范  | `AGENTS.md`                                                                                                  | 延续 TS strict、禁止 any、英文代码/注释、用户文案 i18n、Conventional Commits                              |

注意：`frontend/src/api/protected.ts` 不是可直接原封不动迁移的“纯请求层”；它对 Pinia 的 `useAuthStore` 存在直接依赖。`api/credits.ts` 的 CSV 下载调用了 DOM API，可以继续浏览器端使用，但需单独测试。

## 2. 前台 UI 交互规范

### 2.1 整体布局

- 默认 **浅色模式**，支持暗色模式与系统模式。
- 桌面侧栏宽 248～264px；顶部区域高 60～68px；主内容区自适应；对话内容最大宽 800～840px。
- 侧边栏一级入口只保留「AI 对话」「AI 绘图」「我的作品」「积分与兑换」；管理员显示「管理后台」。
- 历史记录置于常用入口下方：聊天和绘图分别维护独立搜索、列表、置顶、重命名、删除，切换模式时自动替换历史类型。
- 侧栏底部显示可用积分和用户菜单。不要重演旧版“左下角弹窗铺满整个画面”问题：Popover 依托触发器定位，使用边界碰撞检测、portal、max-width、滚动，并在 320px 宽手机端验证。
- 手机端侧栏以 drawer 呈现；自动关闭、正确焦点管理、Esc / 背景点击关闭。浏览器回退能恢复模式和 URL。

### 2.2 Chat / AI 对话

- 空状态：简洁欢迎语 + 3 个可点击的创作建议，不显示后台式数据卡片。
- 会话状态：有清晰用户与 AI 角色信息、流式内容、代码高亮、公式、Markdown、安全渲染、复制、重试、编辑和停止生成。
- 输入框固定底部且不会遮挡末条消息；工具栏在输入框**内部**放置「对话/绘图模式」「模型切换」「参考图（仅模型支持 vision 时）」与发送按钮。
- 发送 Enter，换行 Shift+Enter；IME 中文输入期间不能误发送。保留输入草稿按 `用户ID + 模式 + conversationID` 隔离；不跨账号共享草稿。
- 流式生成保持 `Last-Event-ID`、重连恢复、AbortController、幂等 request_id 等约定；针对中断、重试、401 续期编写回归测试。

### 2.3 Image / AI 绘图

- **继续采用对话式图像生成，不做工作台画布**：提示词（用户气泡）→ 任务状态（排队/执行/完成/部分完成/失败/取消）→ 图片结果卡片，纵向按时间排列。
- 提示词输入框支持粘贴/拖拽/上传参考图、图库选择、已发图片继续编辑，展示真实的参考数和能力约束。
- 常用工具栏：参考图、对话/绘图、模型、参数、报价、生成。把比例、尺寸、质量、张数收在一个有正确焦点/关闭机制的参数 Popover，默认显示轻量摘要。
- **报价必须使用真实后端 quote API**，按模型/operation/quality/size/count 与参考图状态联动计算；示例原型的 `7 积分` **不能硬编码进生产环境**。不得在前端自作账务扣减。提交后按后端状态和退款规则更新余额。
- 结果：可查看大图、下载、再次编辑、复用提示词、取消任务、展示失败原因及部分成功情况；有 alt 文本、懒加载、适当尺寸，并保留 signed file URL/鉴权和失效刷新机制。

### 2.4 Gallery / 我的作品

- 响应式网格；分类筛选；缩略图；全屏预览；批量选择/删除/下载；加入当前绘图创作。删除需显式确认；图片选择回到正确模式与草稿。

### 2.5 Credits / 积分

- 信息拆成「可用余额」「每日额度」「永久积分」「兑换码」「流水/使用统计」。展示后台真实数据、失败原因、退款；不要将每日额度当永久余额或把重置日期写死。

### 2.6 Admin / 管理后台

- 为后台建立独立 `AdminShell`，**不是在用户侧栏平铺 16 个入口**。
- 一级分组建议：① 工作台（概览）；② 用户与财务（用户、积分、兑换码）；③ AI 服务（上游、模型、任务、定价）；④ 运营与安全（公告、系统设置、日志审计）。
- 用户列表、筛选、角色、状态、余额调整、导入导出、批量操作及危险操作二次确认，不得因 UI 重做减少后端已有能力。
- 数据看板 KPI 和趋势图必须接真实 API；原型中的曲线和统计量只是占位。图表采用轻量 SVG / Recharts 动态加载，避免增加主聊天包体积。
- 上游 Key 只经后端管理接口处理，不能在客户端持久化、URL query 或错误日志中泄露。

## 3. 视觉 Token（先冻结，再动业务）

| 项目            | 浅色模式  | 深色模式  |
| --------------- | --------- | --------- |
| page background | `#FAFBFE` | `#14141C` |
| surface         | `#FFFFFF` | `#1D1D27` |
| sidebar         | `#F7F7FA` | `#191922` |
| text primary    | `#252537` | `#F0EEF8` |
| text secondary  | `#6E7186` | `#B1B0C4` |
| border          | `#E9E9F0` | `#32313E` |
| accent          | `#6F58EE` | `#9886FF` |
| accent soft     | `#F0EDFF` | `#312948` |

- 8px spacing system，控件优先 8/12/16/24/32px；常规按钮 9～12px 圆角，输入区域约 18px，信息卡片约 14px。
- 不滥用渐变、玻璃拟态和大面积彩色背景；渐变只允许标志或极少数品牌内容。
- 标准字体系统字体栈，中文使用 PingFang SC / Microsoft YaHei 等；正文 13～14px，移动端输入不得过小；组件高度满足易点击和可访问性。
- 保留 `prefers-reduced-motion`、键盘焦点、对比度、滚动定位与骨架屏。

## 4. 推荐 React 依赖 / 工程布局

框架和基础：React、React DOM、TypeScript strict、Vite（React 插件）、Tailwind 4、React Router、shadcn/ui（Radix primitives）、lucide-react、react-i18next。数据层：`@tanstack/react-query`、`zustand`。表单：`react-hook-form`、`zod` 与 resolver（如果已有纯 TS validator 足够，可避免对同一字段重复定义 schema）。列表：`@tanstack/react-virtual`。Markdown、代码高亮、公式及净化尽可能沿用现有 `markdown-it` / `shiki` / `katex` / `dompurify`，确认 React 适配和 CSP；富文本不得裸 `dangerouslySetInnerHTML` 而跳过清理。

建议目录（具体实现可依真实仓库微调）：

```text
frontend/
  src/
    app/
      App.tsx
      router.tsx              # React Router, guards/redirects
      providers.tsx           # QueryClient, i18n, theme, auth
    layouts/
      PublicLayout.tsx
      WorkspaceLayout.tsx     # user navigation, history
      AdminLayout.tsx         # separate grouped nav
    components/
      ui/                     # shadcn-generated generic primitives
      common/                # Logo, AccountMenu, CreditBadge, ModelPicker
      chat/                  # ChatComposer, MessageList, MarkdownMessage
      images/                # ImageComposer, ImageTaskCard, ImagePreview
      admin/                 # AdminSidebar, StatCard, DataTable, Filters
    features/
      auth/{api,session,store,components}/
      chat/{hooks,store,components}/
      images/{hooks,store,components}/
      credits/{hooks,components}/
      catalog/{hooks,components}/
      admin/{hooks,components}/
    pages/
      ChatPage.tsx
      ImagePage.tsx
      GalleryPage.tsx
      CreditsPage.tsx
      ProfilePage.tsx
      AuthPage.tsx
      admin/{DashboardPage,UsersPage,ModelsPage,...}.tsx
    api/
      transport.ts
      protected.ts            # REWRITE, auth adapter not Pinia
      schema.d.ts             # generated from OpenAPI
      chat.ts / images.ts / credits.ts / ... # reuse/adapt
    i18n/
    styles/
      globals.css             # tokens and Tailwind layers
  tests/
```

**明确避免：** 先引入 Next.js/SSR、重写 Go 路由、把服务端请求全面缓存进 Zustand、复制旧 CSS 到 React 类名、为了 UI 改版顺手改积分结算模型。

## 5. URL 兼容表

继续兼容现有路径及直链：

- `/chat`、`/chat/:id`
- `/create`、`/create/:id`
- `/me/images`、`/me/chats`、`/me/credits`、`/me`、`/me/security`
- `/login`、`/register`、`/forgot-password`、`/reset-password`
- `/admin`、`/admin/dashboard`、`/admin/users`、`/admin/users/:id`、`/admin/models`、`/admin/upstreams`、`/admin/image-tasks`、`/admin/pricing`、`/admin/settings/:group?` 等原有后台路径
- `/terms`、`/privacy`、未知路径 404

新导航可把部分路径归类，但旧 URL 的 redirect/route 不应凭空断掉。登录、管理员角色判断仍保持“前端导航限制 + 后端实际鉴权”的双重保障。

## 6. PR / 分阶段实施策略

1. **PR-0 · 基线和视觉冻结：** 在新分支 `refactor/react-ui` 固定当前 main commit；保存现有流程的 desktop / 320px mobile 截图、Playwright 报告、API 契约和功能清单。以附件 HTML 为外观参考，先确认用户/后台 Shell、创作两种模式。**不写生产前端业务代码。**
2. **PR-1 · React 工程与 API 解耦：** 配置 React Vite、ESLint、TS strict、Tailwind tokens、i18n；提取框架独立 API 层，重写 `protected.ts` 的 AuthSession 依赖；保证 `pnpm build` 仍产 `backend/web/dist`，root scripts / Makefile / Dockerfile / CI 可用。
3. **PR-2 · Auth + Layout：** 登录/注册/找回密码、主题、Mobile Drawer、权限 guard、用户菜单、最近历史列表与分组 AdminShell。验证 401 refresh、切账号清空数据、路由直达、无弹窗越界。
4. **PR-3 · Chat：** SSE 与历史/草稿/模型/Markdown/图片理解/停止/重试/编辑，先保证数据状态机和主要 E2E，再调动效。
5. **PR-4 · Images + Gallery：** 文生图/改图/参考图上传、quote、任务状态/取消/退款刷新、结果编辑、图库、图片签名 URL。验收部分成功及失败结算，尤其不能伪扣积分。
6. **PR-5 · Credits + User Center：** 每日/永久余额、流水、兑换码、个人资料、安全设备管理。
7. **PR-6 · Admin：** 按原功能逐页迁移到 React、后台独立导航；覆盖权限、敏感字段、分页、批量操作、配置提交、审计/任务记录。
8. **PR-7 · 完整验收与发布：** React 单元测试 + Playwright 双视口 + Go 集成测试 + API 生成一致性 + Docker build + Lighthouse/可访问性/包体积审查；保留旧 Vue 分支作为回退点，验收成功后替换 main。最后移除 Vue/Pinia/Reka/vue-i18n/vite-vue 等旧依赖及未引用代码。

**不要在迁移一半时把 React 版作为生产默认入口。** 可在开发分支替换、且在各 PR 里保持可构建；真正替换生产需在核心用户路径完整通过后进行。

## 7. API、安全、账务及性能不可回退清单

- [ ] `X-Lumi-CSRF`、Bearer token、HttpOnly refresh cookie、same-origin credentials、401 refresh 单飞行为保持。
- [ ] SSE 流式聊天处理 UTF-8 分片、增量帧、错误帧、`Last-Event-ID`、断线续传、Abort、retry/edit/regenerate。
- [ ] 账号切换时中止进行中的 stream/upload/quote/list 请求，清理缓存和草稿；不要展示其他账号历史。
- [ ] 图片尺寸、质量、张数、参考图能力由 model capabilities + server config 限制，不写死。
- [ ] 价格只根据后端 quote 与任务账务快照展示；失败退款、跨日策略继续由后端决定。
- [ ] 图片签名 URL、图片缩略图/WebP、下载权限、错误、缓存/过期行为保持。
- [ ] 管理员敏感页面实际权限来自后端，前端仅改善导航体验。
- [ ] 不展示真实上游 API Key，不把 token 持久化到 localStorage，也不在日志中输出 credential。
- [ ] 响应式覆盖：桌面 1440×900、平板 768、移动 390 / 320×740；组件无横向溢出和固定定位覆盖输入框。
- [ ] 可访问性：模态焦点圈定，Esc 关闭，label、键盘操作、主题对比度，减弱动画偏好。
- [ ] 聊天首屏按需加载后台代码；图片组件和图表懒加载，审核 Vite 主包大小及 KaTeX/Shiki 字体/CSP。
- [ ] `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm test:e2e` / `make build` / Docker 测试全通过。

## 8. 可直接复制给 Codex 的执行指令

```text
请在仓库 https://github.com/xinghenWink/Lumi 的当前代码基础上进行 React 前端重构，但不要立即直接改动 main。

首先阅读根目录 AGENTS.md、README.md、docs/DECISIONS.md、docs/openapi.yaml，以及 frontend/、backend/web/、Dockerfile、Makefile、CI 与现有 Playwright 测试。基于真实仓库检查后执行，不能猜测文件结构。

目标：使用 React + TypeScript strict + Vite + Tailwind 4 + shadcn/ui/Radix + lucide-react + React Router + TanStack Query + Zustand + react-i18next 从头重建前端 UI。以随附 Lumi-React-UI-Preview.html 为视觉和交互参照（此文件只是无真实 API 的原型，勿原样作为生产代码）。

重要约束：
1. 原有 Go 后端 / Gin API、PostgreSQL、Redis、OpenAPI、SSE、任务、账务结算及 Compose 不重写。
2. 继续输出前端到 backend/web/dist，由 Go embed；保留 URL 路径、登录权限、移动端、浅色/深色主题。
3. 原有 src/api 中与框架无关的协议解析和 OpenAPI types 尽量复用；src/api/protected.ts 引用 Pinia，必须抽出独立会话适配器；所有 Pinia 状态改为 React 架构。
4. 聊天和绘图都采用对话式布局，两个模式拥有独立历史/草稿；模型选择必须保留在底部对话框内部；生图质量、比例、尺寸、数量折叠在参数 Popover；所有价格、余额、模型能力从后端获取，不写死。
5. 管理后台独立 AdminShell，按用户财务 / AI 服务 / 运营安全分组，现有所有功能不得丢失。
6. 实施须按阶段拆分小 PR，先提交架构分析、文件变化清单、任务依赖和测试计划，再编码。每一阶段必须自行 typecheck、lint、build 和相关测试，修复失败项；不要删除测试来通过验收。
7. 所有源码注释英文，用户文字接 i18n，依赖版本锁定，新增依赖原因登记 docs/DECISIONS.md，提交 Conventional Commits；避免 any 和硬编码上游密钥。
8. 完成所有功能迁移、Chrome desktop/mobile E2E、SSE/积分/图片编辑回归以及 Docker 嵌入验证之后，才清理 Vue 依赖并提出发布 PR。

请先输出：
A. 现有功能/目录的审查及可复用 vs 必须重写的模块清单；
B. 新 React 文件树和组件图；
C. PR-0 到 PR-7 里程碑执行计划与验收点；
D. 需要保持的 API/SSE/账务兼容性清单；
E. 首个 PR 的具体实现改动。
不要在给出审查前直接开始大规模改写，也不要擅自修改后端业务规则。
```

## 9. 设计评审点

设计稿还应根据真实用户截图核对：

- 空聊天页是否“高级但不空洞”，是否把创作建议放在真正方便点击的位置。
- 聊天/生图切换是否容易且不会丢失输入内容或进行中任务。
- 生成卡片是否清楚区分排队、执行中、部分成功、失败、退款；图片入口是否容易找到。
- 后台侧栏是否可快速找到用户、上游和定价，功能是否既保留又不拥挤。
- 320px 手机、低带宽、无图片、API 报错状态下是否稳定。

> 附件页面和截图不是从当前 Lumi 网站实际运行态截取的截图；它们是根据仓库功能与本方案制作的**新 UI 概念设计**。
