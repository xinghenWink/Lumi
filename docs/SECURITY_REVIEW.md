# M7 安全检查

2026-10-23。检查范围是本仓库、锁定依赖与部署示例；运行结果见 M7_ACCEPTANCE.md，不宣称完成外部渗透测试。

| 要求            | 检查与证据                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 密码 / 令牌 | Argon2id 固定有界参数和并发槽；JWT HS256、issuer / audience / expiry / session family / token_version；refresh 仅存哈希并轮换。Cookie 回归确认 HttpOnly / Lax / Secure / 路径。前端 access 仅内存。M7 拒绝公网生产环境关闭 Secure；HTTP 只限回环演练。          |
| S02 CSRF        | 写入验证配置 Origin 或 Referer 和 X-Lumi-CSRF；拒绝 null、缺失、自定义恶意 Origin，已有单测及真实浏览器回归。                                                                                                                                                   |
| S03 输入 / SQL  | 严格 JSON、64 KiB 上限、未知字段拒绝、分页 / UUID / 范围校验；生产查询由 sqlc 生成，事务 SQL 参数化。测试 fixture 仅 integration 构建、test 环境、回环测试 DB。                                                                                                 |
| S04 XSS / CSP   | Markdown 原始 HTML 禁用、DOMPurify、危险链接过滤、KaTeX trust=false；脚本属性 none，字体 / 资源同源；Turnstile 只允许官方域。Shiki / KaTeX 样式属性是已记录的例外。浏览器错误观察器与 Markdown 单测覆盖。                                                       |
| S05 上传 / 文件 | 魔数 / 解码 / 像素 / 字节限制、并发解码槽、PNG 重编码移除元数据；随机路径和 os.Root；缩略图 ≤512 WebP；所有者 + 绑定查看者的过期签名。媒体单测覆盖伪图片、炸弹、元数据与路径；集成覆盖越权和签名。                                                              |
| S06 SSRF        | 仅管理员配置上游；HTTP(S)、禁 URL 凭据 / query / fragment；DNS 和实际 dial 都检查私有地址，重定向不跟随；结果 URL 限同源，大小 / 超时有界。私有网开关显式且默认 false，代理也检查目标。单测涵盖内网、IPv4 映射和重定向凭据泄漏。                                |
| S07 权限        | admin 中间件 + 管理 handler 校验；服务事务中重验活动状态 / 管理员版本；跨所有者会话 / 任务 / 图片 404，禁用立即失效，最后管理员受保护。真实集成与 E2E 覆盖。                                                                                                    |
| S08 日志 / 响应 | AccessLog 仅路由模板；query、Header、正文、panic 值不记；异常仅错误类型。上游仅受控错误码，渠道 DTO / 审计不带密钥。nosniff、Referrer、CSP frame-ancestors、DENY，M7 额外关闭不使用的浏览器权限；HSTS 由代理设置。开发验证码日志仅 development，生产依赖 SMTP。 |
| S09 备份        | 协调停止 app、pg_dump + 图片 + 解密密钥，校验、轮换、空目录恢复；脚本与部署演练均在本轮加入，外部数据库 / 多实例拒绝自动处理。                                                                                                                                  |

依赖审计使用生产 npm 依赖与 Go 调用图。M7 将 Gin 间接引用的 quic-go 从 0.59.0 升级至 0.59.1，修复 [GO-2026-5676](https://pkg.go.dev/vuln/GO-2026-5676)。部署与 CI 固定 Go 1.26.10，包含 [GO-2026-6809](https://pkg.go.dev/vuln/GO-2026-6809) 修复；本机默认 Go 1.27.0 不是发布工具链，扫描须显式 `GOTOOLCHAIN=go1.26.10`，不能用较新但未打补丁的宿主版本替代。

剩余部署检查：真实 HTTPS 证书 / Cookie、可信代理来源、生产密钥保存、SMTP / Turnstile、目标服务器备份加密与异地恢复；这些需要在实际部署环境核验。
