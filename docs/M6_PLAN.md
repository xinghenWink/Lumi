# M6 实现计划

仅实施 M6：全部 P1 及明确列入 M6 的看板、设置补全；不执行 M7 压测、发布与部署演练。以 M5 分支为基础建立 codex/m6-operations，不合并前序 PR。

- 迁移：00008_m6_operations.sql，新增密码重置、偏好、公告、熔断与任务记录；账号自助删除保留 7 天，管理员删除沿用 30 天；消息保存参考图 ID。
- 后端：auth/password_reset.go、auth/turnstile.go、user/preferences.go、catalog/health.go、chat/resume.go、operations/、jobs/，及既有模块接入；查询只经 sqlc。
- HTTP：忘记/重置密码、设备、偏好、删除账号；聊天续传/全文搜索/导出/图片理解；后台 dashboard、users/batch、CSV、会话、公告、system、清理、测试邮件、手动退款、metrics。
- 前端：沿用现有页面与组件，新增安全/偏好、密码重置、后台运营页面；公告、维护、Turnstile、续传、导出与图像批量操作。
- 交付：OpenAPI 与类型、DECISIONS、关键单元/集成测试、M6_ACCEPTANCE；执行 make lint test、生成一致性及构建。
