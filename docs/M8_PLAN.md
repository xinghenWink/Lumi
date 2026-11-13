# M8 无限画布计划

基于 `codex/ui-warm-redesign`，分支 `codex/m8-canvas`。在 Lumi 现有技术栈内原生实现无限画布，交互与数据模型参照开源项目 basketikun/infinite-canvas（MIT），不拷贝其代码、不新增依赖。决策记录见 [ADR-131](DECISIONS.md)。

## 范围

| 包含                                                                             | 不包含                      |
| -------------------------------------------------------------------------------- | --------------------------- |
| 无限平移缩放；图片 / 文本 / 生成 / 分组节点                                      | 导入上游项目文件（zip）     |
| 上传、拖放、粘贴、从图库插入；选择、移动、缩放、删除；撤销重做                   | 画布助手、浏览器直连供应商  |
| 用选中图片 / 文本作为输入生成；连线工作流（生成节点 + 连线）                     | 视频 / 音频节点             |
| 分组、小地图、复制粘贴（跨画布）；服务端自动保存与冲突处理；多画布列表与最近画布 | 蒙版重绘、裁剪 / 放大等编辑 |

## 设计要点

| 方面     | 做法                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生成     | 每个画布持有一个隐藏 `canvas` 会话。生成节点按入边收集参考图和文本，经现有生图任务提交，复用报价、扣费、幂等、SSE 与退款。                          |
| 持久化   | 整份 JSON 文档加乐观 `version`；文档只存文件 / 任务 ID，读取时服务端签发可见文件；`canvas_files` 防止被引用的上传被过期清理。                       |
| 连线规则 | 只允许两种方向：图片 / 文本 / 分组 → 生成节点（输入），生成节点 → 图片（结果）。不允许自连、重复连线和嵌套分组。                                    |
| 撤销     | 快照历史 50 步，连续拖动 / 输入按键合并；生成结果补丁写入全部快照，撤销不会恢复已付费图片的占位。                                                   |
| 剪贴板   | 选中节点及其内部连线编码为 `lumi-canvas/v1:` 文本，经系统复制粘贴事件传递；粘贴时重新映射 ID，并校验文件对当前用户可读。                            |
| 约束     | 懒加载路由与语言包，首屏 gzip 预算 ≤250000 B 不变；CSP 不变；限制与服务端一致（500 节点、1000 连线、文档 1 MiB、请求 1.5 MiB、每用户 200 个画布）。 |

## 文件

| 层     | 文件                                                                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 迁移   | `backend/migrations/00010_canvases.sql`                                                                                                                                          |
| 查询   | `backend/queries/canvases.sql`；`images.sql` 新增任务会话查询，上传清理排除画布引用                                                                                              |
| 服务   | `backend/internal/canvas/`（文档校验、服务）、`internal/http/account/canvas.go`、`internal/images/{tasks,worker}.go` 切换任务会话查询                                            |
| 契约   | `docs/openapi.yaml` 0.7.0、`frontend/src/api/{schema.d.ts,canvases.ts}`                                                                                                          |
| 纯逻辑 | `frontend/src/features/canvas/`：document、geometry、commands、history、workflow、tasks、clipboard                                                                               |
| 控制器 | `frontend/src/react/features/canvas/`：editor、autosave、generation、uploads、blob-cache、actions、queries、i18n                                                                 |
| 界面   | `frontend/src/react/components/canvas/`、`pages/Canvas{List,}Page.tsx`；侧栏、路由、标题与最近画布；`src/i18n/canvas.{zh-CN,en}.ts`                                              |
| 测试   | `internal/canvas/document_test.go`、`internal/platform/integration/canvas_test.go`、`features/canvas/*.test.ts`、`react/features/canvas/*.test.ts`、`tests/react/canvas.spec.ts` |

## 提交顺序

1. `feat(canvas): add canvases schema, queries and service`
2. `feat(canvas): expose canvas API and OpenAPI contract`
3. `feat(canvas): add canvas document model, geometry and history`
4. `feat(canvas): build canvas editor, list page and navigation`（编辑器、生成节点、分组 / 小地图 / 剪贴板相互依赖，合并为一个可独立编译的提交）
5. `test(canvas): cover canvas journeys in Playwright`
6. `docs(canvas): record M8 decisions and acceptance`

验收顺序：Go lint / 单元 → sqlc 与 OpenAPI 生成一致 → 真实 PG / Redis 集成 → 前端 lint / 类型 / 单元 / 构建 → Playwright 全量（含首屏预算与既有生图、聊天旅程）。push 与 PR 需用户确认后进行。
