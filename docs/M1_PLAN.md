# M1 账号与后台基础

## 基线与范围

2026-10-22，用户明确要求进入 M1。以已通过代码与真实容器 CI 的 M0 分支为基线建立 `codex/m1-accounts-admin`；M0 的版本发布仍待验收，本轮不补发版本、不自动合并 PR。若 M0 尚未合并，M1 PR 暂以 `codex/m0-foundation` 为 base。

本阶段交付真实认证、用户管理、设置与审计。注册赠送、初始积分、余额筛选、积分详情交由 M2；聊天、生图、图库与模型选择交由 M3～M5。未实现的业务不提供模拟结果。

## 文件与迁移计划

- `migrations/00002_accounts.sql`：users、user_sessions、verification_codes、settings、audit_logs；邮箱 citext 与活动账号唯一索引；审计记录禁止修改；只新增迁移。
- `queries/{accounts,settings,audit}.sql`：参数化 sqlc 查询、行锁、游标分页；管理员变更串行锁保护最后一位可登录管理员。
- `internal/auth`：Argon2id、JWT、refresh token 哈希、轮换及重放吊销、验证码、管理员首次引导。
- `internal/user`、`settings`、`audit`：事务化用户操作、30 秒设置缓存、环境变量覆盖、敏感信息脱敏。
- `platform/{redis,mailer,secrets}`：Redis 滑动窗口和失败锁定，SMTP/开发验证码输出，AES-GCM 保护邮件凭据。
- `http` 与 `cmd/lumi`：认证与双重管理员校验、Origin/Referer + 自定义头 CSRF、请求体限制、启动装配与管理员重置密码命令。
- `frontend`：登录/注册、邮箱验证码、条款/隐私说明、路由守卫、工作区布局、个人资料、独立管理侧栏、用户 CRUD/详情、站点/注册/邮件设置、审计筛选、深浅色与手机适配。
- `docs/openapi.yaml`、生成类型、测试、环境示例与运行文档同步更新。

## 本阶段接口

`/api/v1/public/config`；`/auth/register`、`/auth/send-code`、`/auth/login`、`/auth/refresh`、`/auth/logout`；`GET/PATCH /me`、`POST /me/password`；`GET/POST /admin/users`、`GET/PATCH/DELETE /admin/users/{id}`；`GET/PUT /admin/settings/{group}`；`GET /admin/audit-logs`。

## 页面与状态清单

| 页面            | 必须覆盖的状态                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| 登录/注册       | 加载站点配置、注册关闭、验证码开关与发送冷却、输入校验、账号锁定、服务错误、提交中、成功跳转               |
| 工作区/个人资料 | 登录恢复、未登录跳转、用户菜单、退出、移动侧栏、资料保存、密码变更后重新登录                               |
| 后台用户        | 加载/空/错误/重试、搜索与角色/状态/日期筛选、游标分页、新增/编辑、立即禁用、邮箱确认软删除、最后管理员保护 |
| 用户详情        | 资料、最近登录会话与安全状态；不呈现未实现模块的伪造数据                                                   |
| 系统设置        | 站点/注册/邮件分组、保存校验、邮箱域名名单、环境覆盖只读提示、密码保留/清除与不回传明文                    |
| 审计            | 游标分页、操作/操作者/对象/时间筛选、脱敏前后值、加载/空/错误                                              |

## 验证重点

大小写不敏感邮箱与并发重复注册；密码哈希与凭据脱敏；验证码单次使用及失败次数；登录失败 5 次锁定；JWT 过期/签名/issuer/audience；refresh 单次轮换及重放吊销；CSRF；普通用户越权；禁用/删除/重置密码立即失效；并发管理员变更不移除最后管理员；审计与业务同事务；设置保存失效缓存；真实 PG/Redis 集成与浏览器全流程。
