# M7 加固与发布计划

基于 M6，分支 `codex/m7-release`；仅处理需求第 15～18 章的加固与发布。

| 范围   | 文件                                                                                             | 迁移 / 接口                      |
| ------ | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| 安全   | `backend/internal/config/`、`http/` 回归；`docs/SECURITY_REVIEW.md`                              | 无数据库迁移；无新增业务接口     |
| 容量   | `scripts/performance/`，100 VU + 20 聊天流 + 5 生图提交者，可控上游与独立账号                    | 复用既有 API，不调用真实付费上游 |
| 浏览器 | `frontend/tests/`，完整用户旅程、500 消息、1000 图、Lighthouse                                   | 保留所有既有 E2E                 |
| 部署   | `deploy/docker-deploy.sh`、`backup.sh`、`restore.sh`、代理示例，`scripts/deploy-smoke.sh`        | forward-only 迁移保持不变        |
| 发布   | `.github/workflows/`、Makefile、README、`docs/DEPLOYMENT.md`、`M7_ACCEPTANCE.md`、`DECISIONS.md` | OpenAPI 版本与生成类型保持一致   |

验收顺序：`make lint test` → sqlc / OpenAPI 一致性 → 集成 → 生产构建 → 全量 Playwright / Lighthouse → k6 → 空目录 Compose 部署 / 重启 / 升级回滚 / 备份恢复 → CI → v1.0.0 双架构发布。

每项记录实测来源和限制。未通过的验收不勾选；本地 Compose 演练不冒充远程干净服务器，fixture 不冒充真实上游参数遵守证明。前序里程碑 PR 不由本轮自动合并。
