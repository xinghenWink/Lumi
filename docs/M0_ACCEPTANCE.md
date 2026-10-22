# M0 验收记录

日期：2026-10-22；分支：`codex/m0-foundation`。

当前结论：M0 DoD 全部通过。用户于 2026-10-22 要求补齐验收后合并 M0 / M1；以下记录实际发布结果，M1 另见 `M1_ACCEPTANCE.md`。

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

代码版本 `9300a95` 的 [GitHub CI](https://github.com/xinghenWink/Lumi/actions/runs/39705739906) 已全部通过，包含 quality 与 container 两个任务。改动由 [M0 PR #1](https://github.com/xinghenWink/Lumi/pull/1) 承载。

- [x] 完整 Compose 栈首页、`/readyz` 与版本接口实测（GitHub Ubuntu runner）。
- [x] 真实 PG / Redis 集成测试通过，包括并发启动迁移、重复迁移与 Redis 中断。
- [x] 远程 GitHub Actions 全绿，`make lint test`、代码生成、构建与浏览器冒烟全部通过。
- [x] 实际发布 `v0.0.1` 并验证 GHCR amd64 / arm64 镜像。

## 版本发布验收

- [Release v0.0.1](https://github.com/xinghenWink/Lumi/releases/tag/v0.0.1) 已发布；tag 固定在纯 M0 代码 `9300a95f73a4fe40031f2a136fcc4992c82bd1c1`，不包含 M1 业务。
- [完整发布工作流](https://github.com/xinghenWink/Lumi/actions/runs/39705752935) 的质量、集成、浏览器、容器、镜像推送、两种架构运行验证与 Release 创建任务全部成功。
- 镜像：`ghcr.io/xinghenwink/lumi:v0.0.1`；多架构 digest：`sha256:43479c2deec1243b314f610c5c232d60d6013195e0158375fac6f84d1dc51854`。
- amd64（Ubuntu）与 arm64（Ubuntu ARM）原生 runner 分别从 GHCR 按上述 digest 拉取，确认 manifest 平台与容器用户 `10001:10001`，启动生产 Compose 中真实 PostgreSQL 16 / Redis 7 / 应用，检查 `/readyz`、首页、`/api/version` 的版本与完整 commit 均通过。
- 发布门禁已保留在 `release.yml`，后续 main / tag 发布继续执行；两种架构均通过后才创建正式 Release。

本机 Docker CLI 存在，但 `dockerDesktopLinuxEngine` 管道不可用。启动 Docker Desktop 的操作被自动审批以 `blocked by policy` 拒绝。集成测试返回无法创建 Docker provider；没有跳过测试或用模拟依赖替代。

本机环境限制已通过远程真实容器验证补齐。M0 工程、容器与版本发布验收全部通过，已具备合并条件。M0 发布物仅包含基础工程；账号由 M1 提供，积分与真实模型能力由后续阶段实现，原型的演示入口与本地业务数据没有移植。
