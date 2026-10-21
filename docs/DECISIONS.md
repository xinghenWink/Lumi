# 技术决策记录

以下为 M0（2026-10-22）决策。依赖版本锁定在 `backend/go.mod` / `backend/go.sum` 与根目录 `pnpm-lock.yaml`。

| 编号    | 决策与理由                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-001 | 严格按 M0→M7 推进。本轮仅建立基础设施，不移植 HTML 演示业务，不引入演示身份切换。                                                                                                          |
| ADR-002 | Go 使用 1.26.10 构建镜像与 CI，模块最低版本 1.26.0，符合需求的 1.24+；新版 Redis/goose/sqlc 要求 Go 1.26。                                                                                 |
| ADR-003 | Node 22、pnpm 10.27.0；TypeScript 5.9.3、Vue Router 4.6.4、Pinia 3.0.4 保持 Vue 3 已验证的组合。ESLint 使用 10，避免新增已弃用的 9 系列。                                                  |
| ADR-004 | Gin 1.12.0 提供路由；pgx/v5 5.11.0 提供连接池；go-redis/v9 9.23.0 提供 Redis；goose/v3 3.29.0 提供嵌入 SQL、实例化 Provider 与 session advisory lock。均为需求指定技术栈。                 |
| ADR-005 | M0 只创建 `lumi` 基础 schema。业务表按里程碑追加迁移，无 SQL Down 路径。sqlc 1.31.1 先生成真实的 `SELECT 1` 查询，CI 检查生成结果。                                                        |
| ADR-006 | goose Provider 禁用全局迁移注册；应用对象经构造函数传递。仅 embed 只读资源与链接器构建信息保留为包级变量。                                                                                 |
| ADR-007 | Vue 3.5、Vite 8、TailwindCSS 4 官方 Vite 插件、Pinia、Router、vue-i18n、lucide-vue-next 构成前端。Reka UI 为指定组件基础，后续需要弹窗时使用。文案默认 zh-CN，备用 en。                    |
| ADR-008 | `production` Go build tag 嵌入 Vite 产物，避免干净检出无法测试。开发构建读取 `backend/web/dist`；生产构建必须先 `pnpm build`，缺失产物时编译失败。产物不入 Git。                           |
| ADR-009 | 开发环境允许缺失 PG/Redis 以验证欢迎页与版本，但 `/readyz` 必须 503；生产环境两项必填，连接或迁移失败退出。                                                                                |
| ADR-010 | testcontainers-go 0.44.0 用于 PG16/Redis7 集成，`integration` build tag 运行；无 Docker 时失败，不静默跳过。Vitest 5、jsdom 26、Playwright 1.64 用于前端；jsdom 26 兼容开发机 Node 22.19。 |
| ADR-011 | openapi-typescript 7.13.0 生成 OpenAPI 3.1 类型；JSON 仍以 `unknown` 校验，禁止 `any`。Prettier 3、ESLint 10、typescript-eslint 8、eslint-plugin-vue 10 统一质量检查。                     |
| ADR-012 | 服务端生成请求 ID，贯穿 context、响应与日志。不记录正文、查询字符串、授权头、panic 内容或含凭据的连接错误。前端按错误 code 翻译文案。                                                      |
| ADR-013 | 仅 `assets/` 哈希文件长期 immutable 缓存；HTML 不强缓存。未知 API 与缺失资源不回退为 HTML；SPA 未知页面由 Router 显示 404。                                                                |
| ADR-014 | healthcheck 只访问 loopback 的有效数字端口，不跟随重定向。HTTP 不设 WriteTimeout 以支持后续 SSE；读取响应头 5 秒超时，SIGTERM 最多等待 60 秒。                                             |
| ADR-015 | CI 覆盖 lint、类型、单元、集成、生成、构建、浏览器与完整 Compose 栈。release 复用 CI 后推送 amd64/arm64；main 推 edge/sha，tag 推版本/次版本/latest。                                      |
| ADR-016 | `.env.example` 预留认证和上游变量，M0 不使用其凭据。生产栈要求非空 PG/Redis 密码；开发栈只绑定 loopback。部署脚本、反向代理与备份演练在 M7 完成。                                          |

参考：[Go 发布](https://go.dev/dl/)、[Vite 环境要求](https://vite.dev/guide/)、[Tailwind Vite 集成](https://tailwindcss.com/docs/installation/using-vite)、[goose Provider 与锁](https://pressly.github.io/goose/documentation/provider/)。版本经官方 Go proxy、npm registry 与 GitHub releases 核定。
