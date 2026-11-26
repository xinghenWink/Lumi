# 部署、备份与发布

适用 Linux / Docker Engine + Compose v2；建议初始 2 vCPU / 2 GB 用于应用，PostgreSQL / Redis 另计资源。镜像用固定版本或 digest。部署包不包含密钥。

## 视频生成

迁移 00027 和 00028 增加视频模型、视频积分、任务和媒体字段。更新前备份数据库和 `/data` 媒体目录。发布新镜像时同步升级 Web 与 worker。独立视频余额默认从零开始，管理员在「视频定价与积分」选择扣费来源，再通过调账、批量发放或视频兑换码发放积分。

生产镜像提供 FFmpeg 和 ffprobe。直接运行 Go 二进制时，将这两个程序加入服务进程的 PATH。参考素材需要上游能访问配置的 `PUBLIC_BASE_URL` HTTPS 地址。更新反代配置，使 `/api/v1/video-assets` 允许 100 MiB 上传，并避免记录 `/api/v1/video-media` 的签名查询参数。运行时继续使用现有 `/data/images`，备份及恢复要包含该目录。真实渠道验收见 [视频契约](UPSTREAM_CONTRACT.md#视频直连与-new-api)。

## 首次部署

从 GitHub Release 下载 `lumi-deploy.tar.gz`（私有仓库需先完成认证），安全传输至服务器。全新 Ubuntu 上确认 Docker / Compose 可用；Bash、OpenSSL、curl、tar、coreutils、flock 为脚本前提。

```sh
sudo mkdir -p /opt/lumi
sudo tar -xzf lumi-deploy.tar.gz -C /opt/lumi
sudo bash /opt/lumi/docker-deploy.sh /opt/lumi
sudoedit /opt/lumi/.env
cd /opt/lumi
# 私有 GHCR 镜像：用只有 read:packages 的 PAT，通过标准输入登录。
printf '%s' "$GHCR_READ_TOKEN" | sudo docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
sudo docker compose pull
sudo docker compose up -d --wait --wait-timeout 180
curl --fail http://127.0.0.1:8080/readyz
curl --fail http://127.0.0.1:8080/api/version
```

`.env` 必填管理员邮箱；脚本自动生成管理员密码、JWT / 加密密钥、PG / Redis 密码，权限 0600，绝不打印秘密。再次运行保留所有既有文件和密钥。应用目录属 uid 10001，数据库和 Redis 仅在内部网络提供服务，应用只绑定宿主 127.0.0.1。首位管理员只在无管理员时创建；环境密码改变不重置已有管理员。

不能向服务器提供最小权限 GHCR 凭据时，可在已授权的工作站从该 Release 下载 `lumi-linux-amd64.tar.gz` 和同名 JSON，安全传到 amd64 服务器后执行 `docker load -i lumi-linux-amd64.tar.gz`。传统存储可直接对照 `docker image inspect` 的 ID 与 JSON `image_id`；Docker 29 / containerd 的 ID 表示可能不同，须按 [离线镜像身份核验](OFFLINE_IMAGE_VERIFICATION.md) 校验配置、所有层与归档 manifest 的 SHA256 关系，不能只忽略 ID 不同。核验通过后按相同 `.env` 执行 `docker compose up -d --wait`，再核对 `/api/version` 的版本与提交；不执行需要远端鉴权的 pull。该归档来自已按 GHCR digest 拉取、原生启动验收的正式镜像，不是另行构建版本。多架构 index、归档 manifest、配置 digest 含义不同，JSON 同时记录版本、提交和来源 digest。避免把工作站的广泛仓库凭据传给服务器。arm64 仍使用 GHCR 最小权限拉取路径。

公开部署先安装本目录的 Caddy 或 Nginx 示例、替换域名并提供证书，再设 `PUBLIC_BASE_URL=https://实际域名`、`COOKIE_SECURE=true`。仅本机 HTTP 演练可用 `http://127.0.0.1:8080` / false。配置更改后 `docker compose up -d`。反代不压缩、缓存或缓冲 SSE；HSTS 在反代设置。Caddy 不额外开启全站压缩。代理示例覆盖客户端传入的 X-Forwarded-For，避免伪造来源。

`TRUSTED_PROXIES` 仅填写应用实际看到的代理地址 /32（或 IPv6 /128）。Docker 转发时通常是网桥 gateway，先用 `docker network inspect lumi_default` 确认，再在测试环境验证不同客户端 IP 的注册 / 登录限流；不要填写 `0.0.0.0/0` 或整个私网。多层代理需逐层建立可信边界。默认不信任转发头，因此不配置会把经同一代理的用户视为同一 IP。

管理员登录后配置 SMTP、上游、平台模型和价格。可选环境引导必须同时提供 UPSTREAM_BASE_URL / UPSTREAM_API_KEY，仅空目录首次生效。内网上游 / 代理只有在明确可信时设置 UPSTREAM_ALLOW_PRIVATE_NETWORKS=true。真实实例参数能力以 [契约](UPSTREAM_CONTRACT.md) 为准，未实测的质量 / 尺寸不要开放。

## IP 地址 HTTPS

没有域名而有固定公网 IP 时，可以使用 Let's Encrypt 的 `shortlived` IP 证书。正式部署已用 Caddy 2.11.7 验证签发、受信任的公网访问和反代重启；选择固定版本的官方二进制，并按同一 Release 的 checksums 文件校验（2.11.7 使用 SHA512）。应用镜像不需要修改。

以下为宿主机 Caddy 配置，**先将两处 `203.0.113.10` 替换为实际公网 IP**：

```caddyfile
{
    admin 127.0.0.1:2019
    default_sni 203.0.113.10
}

https://203.0.113.10 {
    tls {
        issuer acme https://acme-v02.api.letsencrypt.org/directory {
            profile shortlived
        }
    }
    request_body {
        max_size 30MB
    }
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
        header_up X-Forwarded-For {remote_host}
    }
}
```

云主机可能通过 NAT 使用不同的内网地址；`default_sni` 为未发送 SNI 的 IP 地址客户端选择正确的公网证书。将 `.env` 设为 `PUBLIC_BASE_URL=https://实际公网IP`、`COOKIE_SECURE=true`，并按前文配置实际代理来源。Caddy 需常驻、开机自启并持久保存证书 / ACME 账号状态；80/443 须可供公网验证与续期。短期证书由 Caddy 自动续期，不需要手工每周签发。验收时从另一台机器直接访问 HTTPS，检查系统证书信任与 `/readyz`，不能用 `curl -k` 作为通过依据。

参考：[Let's Encrypt IP 证书](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)、[Caddy ACME 配置](https://caddyserver.com/docs/caddyfile/directives/tls)、[default_sni](https://caddyserver.com/docs/caddyfile/options#default-sni)。

## 日常运行与磁盘

检查 `/readyz`、容器健康、脱敏 JSON 日志；`/metrics` 需管理员 Bearer，可接 Prometheus。应用不自动加载宿主 `.env`，Compose 会加载。不要输出 `docker compose config` 到公共日志，其中可能包含密钥。

```sh
docker compose logs --tail 100 app
docker compose restart app
docker compose run --rm app migrate
# 新密码仅经临时环境输入，完成后清除。
read -rs ADMIN_RESET_PASSWORD; export ADMIN_RESET_PASSWORD
docker compose run --rm -e ADMIN_RESET_PASSWORD app admin reset-password --email admin@example.com
unset ADMIN_RESET_PASSWORD
```

图片默认永久保存，每张按 1～3 MB 加 WebP 缩略图估算：每日 1000 张约 1～3 GB / 日，另给数据库和至少两份完整备份预留空间。后台设置保留天数，并监控磁盘；删除为先隐藏后维护清理。Redis AOF 用于恢复缓存 / 队列，任务和积分事实在 PG，不把 Redis 数据当作账务备份。清理应用目录、轮换 ENCRYPTION_KEY 或 JWT_SECRET 前必须有可恢复备份。

## 升级、回滚

```sh
# 先按下一节生成完整备份，再记录当前 image digest 与 /api/version。
sudo bash backup.sh
sudoedit .env                 # 固定到已验收的新版本，不使用 edge 作为生产版本
docker compose pull
docker compose up -d --wait --wait-timeout 180
curl --fail http://127.0.0.1:8080/readyz
```

核验登录、双桶余额、历史、原图下载与新任务。应用自动迁移且有 advisory lock。迁移只增不改；只有旧二进制兼容新 schema 时才能改回旧版本 / digest 后 `up -d --wait`。不兼容迁移须把备份恢复到另一台隔离实例，再切流量；不要执行 down 迁移或覆盖生产目录。CI 使用正式 `v0.3.3` 镜像演练升级，并在独立目录分别恢复升级前和升级后的备份。

迁移 00020 将图片倍率改为按 1K、2K、4K 设置，三档初始值均为 1.00。升级前可记录需要沿用的定价，升级后在「价格与赠送」重新设置三档倍率。「自动」按 1K 倍率计费。多实例升级时先停止全部旧应用实例，再启动新版本。旧版本读取不了新倍率配置，回滚时使用升级前的备份和旧版本。

## 后台版本管理

「管理端 → 系统信息 → 版本管理」显示当前版本、GitHub 最新正式版、历史版本和上次查询时间。默认开启发布查询。启用宿主机执行器后，系统会根据当前镜像和数据库迁移状态显示可用的更新或回滚操作。

托管部署仅支持可连接 GitHub/GHCR 的 Linux 单机 Docker Engine、Compose v2 和 systemd，使用项目自带的 PostgreSQL、Redis、`data/app` 和宿主机 `127.0.0.1:8080`。执行器按官方镜像 digest 操作，无需给应用挂载 Docker socket。私有 GHCR 凭据通过宿主机 root 的 Docker 登录配置提供。执行器按 Compose 项目标签核对目录和服务，要求部署目录、父目录、Compose、`.env` 和备份脚本由 root 持有，且其他用户没有写权限。

已有实例先按手动升级流程备份并安装带版本管理的首个正式版本。下载同一版本的 `lumi-deploy.tar.gz` 和 `lumi-deploy.sha256`，核对文件后解包。把包内的新 `docker-compose.yml`、`backup.sh` 和 `restore.sh` 安装到现有目录，保留实例的 `.env` 和数据目录。使用标准 Compose 项目和基础配置启动服务后，从解包目录运行：

```sh
sha256sum -c lumi-deploy.sha256
sudo bash install-updater.sh /opt/lumi lumi
sudo lumi-updater status -dir /opt/lumi -project lumi
```

应用第一次执行托管切换时会将当前镜像 digest 固定到 `.env` 的 `LUMI_IMAGE_REF`。后续 Compose 启动以此值为准。需要做人工维护时，先停止执行器，再按部署手册调整该引用。操作会短暂停止应用，持续时间主要由 PostgreSQL 和图片备份所需时间决定。备份位于部署目录下的 `backups/lumi-deployment-<任务 ID>.tar.gz`，包含实例密钥。执行器会把任务、失败原因和终态保存在 PostgreSQL，并在新容器通过检查后恢复流量。

更新失败且当前数据库仍满足已验证的回退条件时，执行器自动恢复原镜像。需要人工恢复时，在宿主机查询状态和日志：

```sh
sudo lumi-updater status -dir /opt/lumi -project lumi
sudo journalctl -u lumi-updater -n 100
```

如果运维已让目标镜像或验证过的原镜像在兼容数据库上通过健康检查，可执行 `sudo lumi-updater resolve -dir /opt/lumi -project lumi` 解除任务锁。需要恢复快照时，按下节恢复到独立实例，再验证并切流量。源实例上当前没有发布清单的历史版本仍可从管理端查看发布说明，安装和切换走手动流程。

正式 Release 的 `lumi-release.json` 由发布工作流在 amd64 与 arm64 镜像验收后生成。发布前在 `deploy/release-compatibility.json` 按目标标签声明允许验证的旧版本，例如 `{"v0.5.0":[{"version":"v0.4.0","rollback":true}]}`。两种架构都验证升级及声明的回滚路径，清单记录测试使用的 digest 和数据库迁移版本。发布清单为空路径时，该版本可作为后续版本的起点。已发布附件保持固定。

## 一致备份与恢复

自动脚本只支持 Compose 内置 PostgreSQL / Redis、单应用实例和 `data/app`；外置数据库 / 多实例须由运营者协调暂停全部写入后备份，脚本会拒绝外置 URL。后台维护模式仍允许管理员和 worker 写入，不能代替停止应用。

```sh
sudo BACKUP_KEEP=7 bash /opt/lumi/backup.sh
# 每日 03:15，按服务器时区；恢复前检查最近一次成功时间和磁盘。
# 15 3 * * * root BACKUP_KEEP=7 /bin/bash /opt/lumi/backup.sh >> /var/log/lumi-backup.log 2>&1
sudo bash /opt/lumi/restore.sh /secure/lumi-TIMESTAMP-RANDOM.tar.gz /opt/lumi-restored
```

备份先停止 app（最长 65 秒），用 `pg_dump -Fc` 保存数据库，再复制图片、`.env`（解密密钥）、Compose 和镜像清单，写 SHA256 校验，原子发布归档；失败不轮换旧备份，退出时尝试恢复原先运行的应用。保留最近 N 份。备份包含密码、邮件 / 上游密文和用户内容，需在受限目录保存，用组织的加密工具加密后异地存储；校验和用于检测损坏，不能证明来源可信。参考 [PG16 备份格式](https://www.postgresql.org/docs/16/app-pgdump.html)。

恢复只接受可信且校验通过的归档及**空目标目录**；拒绝绝对路径、父目录穿越、链接和设备文件。在启动应用前向全新数据库执行 `pg_restore --exit-on-error`；镜像 / 密钥必须与备份匹配。新服务器上的原数据库 / 缓存没有对外端口。恢复完成后验证用户、余额、流水、图片原文件及任务状态；重建的 Redis 不包含旧登录限流缓存。若同机验证，先停止旧栈并设置独立 COMPOSE_PROJECT_NAME，防止同名项目 / 8080 冲突。失败恢复保留现场，重新尝试时使用另一个空目录。

## 可重复验收

```sh
make lint test
make sqlc api test-integration build
pnpm test:e2e
# 单独创建空数据库 lumi_m7_load 和 Redis DB 1，然后设置两条测试连接 URL。
# 每轮须全新数据库；runner 不删除已有数据库，也不导出令牌。
GOMAXPROCS=2 E2E_DATABASE_URL=postgres://.../lumi_m7_load E2E_REDIS_URL=redis://.../1 make load-test
sudo env LUMI_CURRENT_IMAGE=lumi:m7 LUMI_PREVIOUS_IMAGE=lumi:m6 make deploy-smoke
```

负载使用锁定的 k6 1.3.0，100 个独立用户：75 个读请求用户、20 个 SSE 用户、5 个生图提交用户，持续 60 秒；不调用真实付费上游。每个 SSE fixture 持续约 2 秒；由请求总耗时减去上游实际耗时估算平台开销，阈值 p95 <100ms。读请求 p95 <100ms、错误率 <1%、所有业务断言通过，至少 100 次完整流和 25 次成功生图。报告 `.tools/m7-load/{summary,environment}.json`；私有 actors.json 不上传。该负载用于回归，不能代替目标服务器资源限制、代理网络和真实上游容量测试。

Playwright 包含单用户注册 → 聊天 → 兑换 → 生图 → 管理员调整余额，以及全部既有回归、500 消息、1000 图和登录后的桌面 Lighthouse。Lighthouse 使用本机 / CI 提供的 CPU 和网络，交互事件上界不冒充现场 INP。报告在 `frontend/test-results/`。

邀请奖励随应用启动迁移。升级测试环境后，检查 `PUBLIC_BASE_URL` 是否为好友可访问的域名，在后台为双方设置不同的非零奖励，用已有账号生成链接，并在独立浏览器会话中打开该链接注册。核对双方的永久积分与两类流水，再检查邀请码清空后的普通注册。

## 正式发布门槛

核对 [M7 验收基线](M7_ACCEPTANCE.md)、[React 迁移验收](REACT_UI_PR7.md#completed-acceptance) 和 [v0.2.0 发布计划](RELEASE_V0.2.0.md)。CI 完整通过，真实上游能力核定、干净目标服务器 HTTPS 部署 / 重启 / 升级回滚 / 恢复验收完成后，为**已验收的同一提交**打 `v0.2.0` 并推送。release workflow 再运行全部 CI，发布 amd64 / arm64 GHCR manifest；两种原生架构按 digest 启动验证通过后创建带完整附件的 GitHub Release **草稿**。等待整个工作流全绿，再将官方镜像固定到目标服务器复验；可按上文使用只读 Packages PAT 或官方离线归档。SSH 凭据不上传 Actions。

```sh
git tag -a v0.2.0 VERIFIED_COMMIT -m 'release: v0.2.0'
git push origin v0.2.0
```

授权发布者完成正式镜像部署验收后执行 `gh release edit v0.2.0 --draft=false`，才视为正式发布。若任何验收失败，保留草稿、修复后重新验证；不把已有 tag、GHCR manifest 或草稿当作发布完成。

缺少真实服务器或上游证据时保持未发布状态，在验收记录明确列出未通过项。自动更新仅为运营可选策略，本项目不默认启用 Watchtower。
