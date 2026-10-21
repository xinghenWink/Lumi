# M0 验收记录

日期：2026-10-22；分支：`codex/m0-foundation`。

## 已实现

- [x] Go / Vue monorepo、Makefile、锁文件、代码风格与忽略规则。
- [x] `/healthz`、`/readyz`、`/api/version`，统一错误、请求 ID、JSON 日志与安全头。
- [x] PG / Redis 客户端，启动迁移，60 秒优雅退出，healthcheck / migrate 子命令。
- [x] goose Provider 嵌入 forward-only SQL，使用 PostgreSQL advisory lock；sqlc 生成查询。
- [x] i18n 欢迎页、懒加载路由、Pinia、版本读取与失败重试、320px 适配。
- [x] `production` 构建嵌入前端，非 root 多阶段 Dockerfile，开发 / 生产 Compose。
- [x] OpenAPI 与生成 TypeScript 类型；CI、release 与 PR 验收模板。

## 本机实际验证

另已用 Go 1.26.10 完成 Windows amd64、Linux amd64、Linux arm64 的生产编译，前端嵌入二进制。OpenAPI / sqlc 再生成后的文件哈希一致。

| 验证                                                      | 结果                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Go 1.26.10 `go test ./...`                                | 通过；配置与凭据脱敏、存活/就绪、错误与请求 ID、panic 处理、静态资源/SPA、healthcheck |
| golangci-lint v2.15.0 `run --build-tags=integration`      | 通过，0 issues；errcheck / govet / staticcheck / gosec / unused                       |
| golangci-lint `fmt --diff`                                | 通过                                                                                  |
| `pnpm lint`、`pnpm typecheck`                             | 通过，包括 Prettier                                                                   |
| `pnpm test`                                               | 3 / 3 通过，覆盖版本读取、非法响应/失败重试、并发请求合并                             |
| `pnpm build`                                              | 通过，入口 JS gzip 57.18 KB；欢迎页及共用懒加载块合计约 60 KB                         |
| `pnpm test:e2e`                                           | 4 / 4 通过；真实 Go 嵌入服务，桌面及 320px，版本、重试、SPA，无横向溢出               |
| 桌面 / 手机截图检查                                       | 通过，无文字截断、重叠或溢出                                                          |
| `docker compose config --quiet`                           | 开发与生产 + 本地构建覆盖配置均通过，不依赖运行中的引擎                               |
| actionlint v1.7.12                                        | 通过，CI / release 工作流静态检查                                                     |
| `pnpm audit --prod --registry=https://registry.npmjs.org` | 未发现已知漏洞                                                                        |
| PG / Redis 集成测试                                       | 测试已编写且编译通过；实际运行因 Docker 不可用失败，尚未通过                          |

Windows 未安装 Make，本机执行了其等价命令。未把无法运行的项目标记为通过。

## 远程验收与 M0 DoD

代码版本 `1080a1f` 的 [GitHub CI](https://github.com/xinghenWink/Lumi/actions/runs/39653373637) 已全部通过，包含 quality 与 container 两个任务。改动由 [M0 草稿 PR #1](https://github.com/xinghenWink/Lumi/pull/1) 承载。

- [x] 完整 Compose 栈首页、`/readyz` 与版本接口实测（GitHub Ubuntu runner）。
- [x] 真实 PG / Redis 集成测试通过，包括并发启动迁移、重复迁移与 Redis 中断。
- [x] 远程 GitHub Actions 全绿，`make lint test`、代码生成、构建与浏览器冒烟全部通过。
- [ ] 实际发布 `v0.0.1` 并验证 GHCR amd64 / arm64 镜像。

本机 Docker CLI 存在，但 `dockerDesktopLinuxEngine` 管道不可用。启动 Docker Desktop 的操作被自动审批以 `blocked by policy` 拒绝。集成测试返回无法创建 Docker provider；没有跳过测试或用模拟依赖替代。

本机环境限制已通过远程真实容器验证补齐。M0 工程与容器检查通过，剩余版本发布验收尚未完成，因此暂不进入 M1。账号、积分和真实模型能力均未实现，原型的演示入口与本地业务数据没有移植。
