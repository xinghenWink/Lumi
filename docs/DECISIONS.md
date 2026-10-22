# 技术决策记录

## M6（2026-10-23）

- ADR-065：M6 独立分支基于 M5，新增 00008；仅实施全部 P1 与 M6 明确列出的后台补全，不执行 M7 压测、部署演练或发布。无新增项目依赖。
- ADR-066：密码重置令牌为 256 位随机值，数据库仅存哈希，有效 30 分钟、单次使用并绑定 token_version；重置与吊销全部登录在同一事务。链接令牌放 URL fragment，页面读取后移除，不进入 HTTP 请求或日志。无 SMTP 时明确返回不可用，不在日志打印重置链接。
- ADR-067：Turnstile 使用固定官方 Siteverify 地址，校验 success、hostname 与 action；secret 经 AES-GCM 入库，响应和审计只暴露 configured。CSP 仅为官方 challenges.cloudflare.com 增加 script / frame / connect 来源。参考：[官方验证说明](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)。
- ADR-068：每 IP 注册上限默认 5，使用 Redis 滑动 24 小时窗口，0 关闭；配额保守地计入通过输入验证后尝试的注册，即便后续邮箱验证码、重复邮箱或事务失败也不返还。Redis 故障拒绝注册，避免绕过配额。沿用独立每分钟限制。
- ADR-069：个人偏好单独存表。自定义指令不复制到审计，与全局 system prompt 拼接并纳入上下文预算；vision 仅在能力明确启用时可用，只接受已有所有者文件 ID，最多 4 张，作为内联图片发送上游，历史保留引用 ID。每张保守预留 1024 估算 token；上游仍负责实际上下文限制。
- ADR-070：M6 将 HTTP 断开与停止生成分开。Redis Stream 缓冲受用户 / 会话 / request_id 隔离，TTL 5 分钟，每个事件续期；请求摘要原子去重，前端携带 Last-Event-ID 续传，刷新后可重新订阅。显式停止、账号失效或服务器退出仍取消生成；Redis 无法恢复则读取数据库检查点，崩溃后租约恢复标记 interrupted，不重新调用上游。最长执行仍为 10 分钟。
- ADR-071：同优先级路由按权重无放回随机排列，依次回退。数据库记录连续故障与熔断时限，默认 5 次 / 60 秒；过期后仅允许一个最多 10 分钟的半开探测。用户取消、内容拒绝与请求校验错误不累计故障。生图只对明确 401 / 403、429 或本地网络策略拒绝回退；超时、5xx、无效结果不重发，避免不确定写入生成重复图片。健康测试可主动检测熔断渠道。
- ADR-072：环境引导仅在渠道与平台模型均为空时生效，不覆盖已有配置。默认远程名与低风险图片参数取自已记录的 M3 实测：gpt-5-3-mini、gpt-image-2、low / 1024x1024 / n=1 / 单参考图；不同实例需要管理员修改路由。不新增付费探测请求。
- ADR-073：批量启用 / 禁用 / 删除和批量发积分每次最多 100 人，全部同事务并复用管理员保护；发积分必须提供幂等键。手动退款仅允许终态任务，退回剩余实扣金额，沿用原桶 / 跨日转永久桶，任务行锁与流水唯一键防止重复，必须备注并审计。
- ADR-074：自助删除需邮箱与当前密码，立即注销，7 天后清除个人数据；管理员删除沿用 30 天。未结算任务阻止物理清理。保留必要账务和审计记录；隐私页已说明内容查看开关与留存规则。
- ADR-075：维护任务用 Redis 60 秒租约与所有者令牌释放，执行 context 最长 45 秒；PG job_runs 限制认证清理每小时、对账每天 UTC 一次。对账单条 SQL 用同一快照比较各桶余额与流水总和，不自动改账，不一致追加审计告警。既有图片、上游调用与管理员删除清理继续使用数据库行锁和幂等恢复。
- ADR-076：看板按 UTC 日聚合，DAU 取登录、用户消息和生图提交的去重并集；发放按来源区分，净消耗下限 0，退款明细保留在流水中。指标端点 /metrics 要求管理员 Bearer，HTTP 请求计数与耗时为进程内指标，其余从数据库读聚合。
- ADR-077：公告支持多条、Markdown、起止时间与乐观版本；横幅 30 秒刷新。维护模式禁止非管理员访问受保护 API 并显示维护页。存储根目录只由 DATA_DIR 配置，缩略图沿用固定 ≤512px WebP；后台展示占用与按既有保留策略清理，避免在线变更根目录导致旧文件失联。
- ADR-078：聊天 JSON / Markdown、用户 CSV 完整导出上限 32 MiB，超限明确拒绝；CSV 转义公式注入。图片 ZIP 每次最多 50 张、100 MiB，批量删除最多 100 张且全部同事务；所有文件先鉴权，路径与压缩内文件名只用服务端 UUID。

## M5（2026-10-22）

- ADR-056：独立 M5 分支基于已验收的 M4，新增 00007，不改既有迁移；生图使用 image-conversations API 与共用的 image 类型会话表，保持聊天契约稳定。
- ADR-057：复用积分算法，增加 ChargeTx / SettleTx，把扣费与建单、结算与终态分别放入同一事务。账号物理清理跳过未结算扣费，防止启动或并发维护丢失退款依据。
- ADR-058：PG 为任务事实源，Redis 有序队列调度并定期补偿；数据库锁负责跨实例并发，30 秒租约 / 2 秒续期 / 15 秒恢复。图像写请求不自动重试到其他路由，以免生成重复结果。拆分开关按 n 个 n=1 请求并发，上限按任务数配置。
- ADR-059：新增锁定 github.com/HugoSmits86/nativewebp 1.3.0（纯 Go WebP 无损编码，保持 CGO_ENABLED=0 与双架构）和 golang.org/x/image 0.47.0（WebP 解码和缩放）；版本与校验锁定在 go.mod / go.sum。依据：[nativewebp](https://github.com/HugoSmits86/nativewebp)、[Go image](https://pkg.go.dev/golang.org/x/image)。
- ADR-060：文件统一 PNG 重编码并生成 ≤512px WebP，魔数 / 像素 / 字节及并行解码限制共同约束资源。路径随机并经 os.Root 防逃逸；读取同时要求登录、所有权与限时签名，前端授权 fetch 转 Blob，列表只取缩略图。
- ADR-061：后台默认不返回提示词、参考图或图片内容；开启 admin_can_view_content 后每次内容查看写审计。后台删除图片另记审计，普通用户跨所有者返回 404。
- ADR-062：默认 DATA_DIR 开发为 backend/data、生产 /data。CI / 双架构发布验收为宿主挂载目录设置 uid 10001 权限，运行时保留非 root；路径与部署说明同步。
- ADR-063：会话 / 草稿按模式及会话隔离，未知提交结果保留请求键与完整载荷；切换会话或账号后丢弃迟到的订阅与提交界面更新。任务订阅断线降为 3 秒轮询，不因离页取消后端执行。图库按游标加载并按可视行虚拟渲染。
- ADR-064：文件模块同时关闭 M1 预留头像项，使用既有 avatar_file_id 字段；裁剪 / 保存新文件、替换用户引用、软删除旧头像在同一事务完成。启动验证目录可写，维护保留 24 小时缓冲后清理无元数据的孤立文件；多实例必须共享 DATA_DIR。

## M4（2026-10-22）

| 编号    | 决策与理由                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-047 | M4 独立分支 / PR 暂基于已全绿但未合并的 M3，不自动合并前序里程碑。新增 00006 会话、消息、聊天设置和每日计数；查询按用户隔离。                                                                                                        |
| ADR-048 | 每次生成有客户端请求 UUID / 输入摘要，数据库事务先保存用户与助手消息并独占会话，再开始 SSE；重复请求不重复调用 / 计数，编辑和重生成为新请求。                                                                                        |
| ADR-049 | 2 秒检查点 / 权限重验、45 秒租约、15 秒恢复扫描；停止或断线取消上游并以独立 5 秒 context 保存部分。崩溃保留最后检查点，跨实例恢复只处理到期租约。                                                                                    |
| ADR-050 | 上下文按条数 / 保守 token 估算 / 模型上限取交集，保留 system，丢弃最早完整轮次；超大最后一条明确拒绝。每日计数统一 UTC，Redis 每分钟与 PG 每日计数相互独立，0 不限。                                                                 |
| ADR-051 | 新增锁定依赖 markdown-it 15.0.3（块解析）、DOMPurify 3.4.17（最终 HTML 清洗）、Shiki 4.5.0（按需代码高亮）、KaTeX 0.19.0（按需数学）、@tanstack/vue-virtual 3.13.47（可变高度长消息与侧栏）；类型包仅开发依赖，pnpm-lock.yaml 锁定。 |
| ADR-052 | 流文本按 animation frame 合并，消息 shallowRef 不可变更新，Markdown 缓存已完成块；编辑器独立组件，IntersectionObserver 控制跟随滚动。原始 HTML 关闭，图片不自动向外站加载，链接过滤危险协议。                                        |
| ADR-053 | 首次完成后调用标题模型，10 秒失败回退首句 20 字；先保存回答再生成标题，手动重命名不会被覆盖。首文本前按优先级回退路由，流开始后保留内容并报错；加权路由 / 熔断 / 断线续传仍属 P1。                                                   |

ADR-054：新增仅开发依赖 Lighthouse 13.5.0，验收登录后的桌面冷 HTTP 缓存性能；使用隔离的临时 Chromium profile，不保存认证报告。其 Node 下限为 22.19，工作区同步提高下限。工具链 OpenTelemetry API 固定 1.9.0，满足 SDK 声明的 <1.10 peer 范围。以 60 次顺序 SSE 请求的首文本往返减去 fixture 内部耗时，测量包含认证 / 数据库 / 首文本前回退 / 转发的平台额外延迟；另测流式期间交互事件上界与长任务比例，报告注明 CI 环境及测量边界，不代替生产负载或现场 INP。Shiki 使用 core + JavaScript 正则引擎及显式语法按需加载，避免携带 WASM 与无关语言。

ADR-055：KaTeX 的动态尺寸与 Shiki 双主题高亮需要 style 属性。CSP 仅以 style-src-attr 允许样式属性，style-src-elem / script-src 保持 self，script-src-attr 明确 none。原始 Markdown HTML 禁用，最终生成 HTML 仍经 DOMPurify，KaTeX trust=false 并限制展开 / 尺寸。Vite assetsInlineLimit=0 将小字体输出为同源静态文件，维持 font-src self。通过 HTTP 头回归与实际浏览器零 CSP 错误确认；不通过全局 unsafe-inline 放宽脚本或样式标签。依据：[CSP3](https://www.w3.org/TR/CSP3/#directive-style-src-attr)、[MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr)。

Markdown 安全与按需加载依据：[markdown-it](https://markdown-it.github.io/markdown-it/)、[DOMPurify](https://github.com/cure53/DOMPurify)、[Shiki](https://shiki.style/guide/bundles)、[KaTeX](https://katex.org/docs/options)。

## M3（2026-10-22）

| 编号    | 决策与理由                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-041 | M2 PR #3 验收全绿但尚未合并。M3 独立分支 / PR 暂以 M2 为 base，保留里程碑边界，不自动合并 M2。                                                                  |
| ADR-042 | 新增 00005 渠道 / 平台模型 / 路由 / 调用记录迁移。部分唯一索引及配置锁保证默认模型互斥；version 防止覆盖并发编辑，路由与审计同事务。                            |
| ADR-043 | 复用 AES-GCM 并以渠道 UUID 绑定密钥；读取 DTO 和审计只含 key_configured。URL 禁止内嵌凭据，客户端拒绝重定向，默认阻止私有地址；自托管内网或本机代理需显式许可。 |
| ADR-044 | Adapter 使用标准库 HTTP / SSE / multipart，无新增依赖。候选协议与实例观察分开记录；模型导入后先停用，重复导入不新建或覆盖既有模型。                             |
| ADR-045 | 调用日志只含受控错误码、耗时、状态和请求 ID。30 天后按 1000 条 / 批删除，以 SKIP LOCKED 允许实例协作；维护 worker 随应用取消并等待退出。                        |
| ADR-046 | 实例请求 1024×1024，实际返回 1254×1254 PNG；M5 按实际元数据记录结果尺寸。仅验证 low / 1024×1024 / n=1，不把公开 schema 或 mock 当作其他参数通过的证据。         |

## M2（2026-10-22）

| 编号    | 决策与理由                                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-033 | 新增迁移 00004，既有账号仅初始化零永久余额，不补发历史注册赠送；账号插入触发器只创建空账户，赠送由 credits.Service 在注册事务内执行。                       |
| ADR-034 | 积分账户行锁、账务流水、幂等操作响应与业务变更同事务。幂等键按操作者绑定请求摘要，重复请求返回原结果，载荷或业务不匹配返回冲突；管理员调整也必须提供键。    |
| ADR-035 | 每日按配置 IANA 时区懒重置，过期与赠送分别追加流水；时区或时钟回退时不重复领取已处理日期。余额上限每桶 10^12，API 整数保持在 JavaScript 安全范围。          |
| ADR-036 | 价格与赠送配置从数据库读取，不引入跨实例过期缓存；共享/独占事务锁保证报价与配置变更一致。使用标准库 math/big 精确十进制倍率计算，禁止浮点扣费，无新增依赖。 |
| ADR-037 | 扣费快照原价、数量与分桶金额；最终结算只执行一次，部分失败按原价退款，每日原桶跨日部分转入永久桶。未结算任务不计入成功图片数；M2 不建立模拟任务。           |
| ADR-038 | 兑换码为 80 bit Crockford Base32，SHA-256 检索、AES-GCM 加密保存并绑定码 ID；普通用户仅返回尾号。导出逐页处理、转义公式注入，并记录不含完整兑换码的审计。   |
| ADR-039 | 流水、兑换历史与幂等结果保留不含个人资料副本的用户 UUID，账号清理只级联删除账户；账务记录和兑换记录由触发器禁止修改/删除。                                  |
| ADR-040 | 用户余额筛选按当前日的有效每日余额计算；只对返回页逐个落实懒重置，避免每次列表扫描更新全站账户。金额游标独立于时间游标，并绑定筛选、日期与赠送配置。        |

## M1（2026-10-22）

| 编号    | 决策与理由                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-017 | 用户明确要求进入 M1，覆盖先前等待 M0 发布的推进限制；M0 发布仍未验收。M1 独立分支暂以 M0 分支为 base，不自动合并或发 tag。                                                                                                                 |
| ADR-018 | 新增 golang-jwt/jwt/v5 5.3.1 实现 JWT，固定 HS256、issuer、audience 与到期检查。google/uuid 1.6.0、x/crypto 0.58.0 从已有间接依赖转为直接依赖，分别生成 UUID v7 与 Argon2id。                                                              |
| ADR-019 | Argon2id 使用 19 MiB、2 次迭代、1 路并行、16 字节随机盐与 32 字节结果，符合 OWASP 最低建议；限制 4 个并行哈希，拒绝异常 PHC 参数以控制内存。密码 8–128 个字符且包含字母与数字。                                                            |
| ADR-020 | Access JWT 15 分钟，仅保存在前端内存。Refresh 为 256 位随机值，30 天、HttpOnly / Lax cookie，数据库仅存 SHA-256；每次轮换新增记录，旧值重放吊销整个登录 family。JWT 绑定稳定 family ID，正常轮换不使同一设备已有 access token 提前失效。   |
| ADR-021 | 每次受保护请求用数据库同时检查账号状态、token_version 与有效 family。退出只注销当前 family；禁用、删除、角色/邮箱/密码变更注销该用户全部登录并递增 token_version。后端不使用角色缓存。                                                     |
| ADR-022 | 邮箱验证码 HMAC-SHA-256 存储，10 分钟有效，最多 5 次失败，验证与注册同事务；错误尝试仍提交计数。Redis 原子滑动窗口分别保护登录、注册和验证码，并提供账号+IP 的 5 次失败/15 分钟锁定及邮箱 60 秒发送冷却。Redis 不可用时拒绝认证写操作。    |
| ADR-023 | 邮件采用 Go 标准 SMTP 客户端，附 context 取消、20 秒截止、TLS/STARTTLS 及证书校验，不新增邮件库。只有 development 且没有 SMTP 主机时允许将验证码写入开发日志，邮箱遮蔽；test / production 不输出验证码。邮件正文来自 zh-CN / en 翻译文件。 |
| ADR-024 | SMTP 密码使用 ENCRYPTION_KEY 的 AES-256-GCM 加密，带用途关联数据；API 仅返回 password_configured，省略密码保留原值，空字符串清除。生产拒绝未加密 SMTP，开发明文仅限 loopback。日志及审计不记录密码、令牌、验证码或密文。                   |
| ADR-025 | 设置缓存 30 秒，保存后立即失效；generation 防止并发旧读取覆盖新缓存。环境变量优先于数据库，后台标出覆盖字段并禁止在表单编辑。M1 支持站点、注册、安全参数与邮件设置，其余设置在后续里程碑追加。                                             |
| ADR-026 | 管理员写操作在事务内使用 advisory lock 串行化，再次核对操作者角色/版本并锁定目标行。禁止修改自己的角色/停用/删除自己，保留至少一位可登录管理员。业务与脱敏审计同事务；数据库触发器禁止修改/删除审计记录。                                  |
| ADR-027 | 首位管理员仅首次通过 ADMIN_EMAIL / ADMIN_PASSWORD 创建；后续环境变化不重置账号。生产空库未提供引导凭据时拒绝启动。救援重置密码通过 ADMIN_RESET_PASSWORD 环境输入，避免密码进入命令行参数，重置后注销全部登录并留审计。                     |
| ADR-028 | Cookie 写接口核验 Origin/Referer 及 X-Lumi-CSRF。COOKIE_SECURE 默认生产开启；本地 HTTP 需显式关闭。PUBLIC_BASE_URL 为可信来源，development 另允许 DEV_ORIGIN。代理 IP 仅信任显式 TRUSTED_PROXIES。                                         |
| ADR-029 | 前端用单次初始化、refresh 请求合并和浏览器 Web Locks 协调标签页；401/403 清理认证状态，临时网络/503 不主动注销；localStorage 只保存外观偏好。采用 Reka Dialog / DropdownMenu 管理焦点及弹层，账户菜单限制在侧栏宽度。                      |
| ADR-030 | 列表按时间+UUID 游标分页并绑定筛选条件，无 offset；日期筛选在界面明确使用 UTC，显示按账号时区。用户列表在 M1 只展示已有账号字段，积分、生图统计与相关筛选在 M2/M5 增补，不返回伪造余额。                                                   |
| ADR-031 | M1 的注册事务保留 M2 接入 credits.Service 的边界，本阶段不宣称 F-AUTH-03 已完成。个人资料支持昵称/语言/时区和修改密码；头像在文件模块完成后接入。协议说明页与同意时间先落地，完整上线合规检查仍属 M7。                                     |
| ADR-032 | 完整集成测试使用真实临时 PG16/Redis7，浏览器全流程使用 CI 的独立 PG/Redis 服务；本地无 Docker 时只执行明确选择的 guest 浏览器检查，不把完整联调标为通过。CI 容器凭据运行时随机生成。                                                       |

认证参考：[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[JWT 校验选项](https://golang-jwt.github.io/jwt/usage/parse/)、[Reka Dialog](https://reka-ui.com/docs/components/dialog)。

补充：迁移使用独立连接与 PostgreSQL session lock；迁移版本表固定为 `public.goose_db_version`，业务连接固定 `search_path=lumi,public`。M0 首次创建的同名 schema 会改变 PostgreSQL 默认 `$user,public` 查找结果；显式限定可避免并发启动创建第二张版本表，并使业务表位置不受数据库用户名影响。保留并发迁移、重复执行和每条迁移版本仅记录一次的集成检查。

M1 账号删除保留策略：启动后及每小时分批处理已软删除满 30 天的账号。每批至多 100 条，使用行锁与 SKIP LOCKED 允许多实例协作，每轮最多 30 秒；永久删除、会话级联及 user.purge 审计同事务。保留最近删除和历史审计，新增索引迁移 00003。后续积分等业务表必须保留必要账务历史并设计其删除/匿名化策略，再与该维护任务联调。

## M0（2026-10-22）

以下为 M0（2026-10-22）决策。依赖版本锁定在 `backend/go.mod` / `backend/go.sum` 与根目录 `pnpm-lock.yaml`。

M0 发布验收补充：GHCR 推送成功后，以构建返回的 digest 锁定镜像，在 amd64 与 arm64 原生 runner 分别运行完整生产 Compose 栈，检查平台、非 root 用户与版本 commit；全部通过才创建 Release。验证复用现有 Docker actions 与 runner 工具，无新增项目依赖。

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
