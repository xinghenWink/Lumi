- 代码与注释用英文；用户可见文案全部走 i18n（zh-CN 为主）。
- Go：`gofmt`、`golangci-lint`（启用 errcheck、govet、staticcheck、gosec）；错误用 `fmt.Errorf("...: %w", err)` 包装；`context` 贯穿调用链；不使用全局可变状态。
- TypeScript：`strict`；ESLint + Prettier；禁止 `any`（例外需注释说明）。
- 提交遵循 Conventional Commits；每个里程碑一个分支/PR，PR 描述附验收清单勾选情况。
- 不得拷贝参考项目代码；不得提交任何密钥；`.env` 加入 `.gitignore`。
- 新增依赖要在 `docs/DECISIONS.md` 记理由；依赖版本锁定（`go.sum`、`pnpm-lock.yaml`）。
- 每个功能随 PR 附：迁移文件、测试、OpenAPI 更新、必要文档。
- SQL 迁移只增不改（forward-only）。


## 前端 UI 开发规范

- React 项目优先使用 shadcn/ui 作为基础 UI 组件体系。
- 开发组件前先查看项目已安装组件，优先复用。
- 缺少组件时优先搜索 shadcn 官方 Registry，并使用 CLI 或 MCP 安装，不要从零造轮子。
- 登录、表格、侧边栏、Dashboard 等优先使用现有 Blocks。
- 动效优先参考 Magic UI；复杂文字和背景特效可参考 React Bits，检查许可证。
- 不要直接使用未经设计的原生 HTML button、input、select 等作为最终业务 UI。
- 统一使用设计 Token，包括颜色、字体、圆角、间距和阴影。
- 支持响应式布局、暗色模式、加载态、空状态、错误态和键盘访问。
- 避免在一个项目中混用多个完整的主题组件库。
- 保持现有技术栈、功能和 API 行为不变。
- 最终检查页面视觉一致性、功能完整性和移动端布局。