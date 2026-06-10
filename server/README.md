# 家居收纳 · 后端 AI 代理

把 `api/ai/*` 处理器（原本跑在 Vercel functions）打包成可独立运行的 HTTP 服务。

- 入口：`server/server.js`（Node 原生 http，零依赖）
- 部署目标：腾讯云轻量服（国内地区，已装宝塔面板）
- HTTPS：宝塔自带 nginx + 一键证书反代到 `127.0.0.1:8787`
- 鉴权：共享 Bearer token（`AI_PROXY_TOKEN`）
- 域名：`homeapp.zyb.world`（需已备案）
- CI：`.github/workflows/deploy-server.yml`，打 tag `server-v*` 自动部署

> 不用宝塔的纯 docker 环境？看 `docker-compose.caddy.yml`，Caddy 会全权处理 HTTPS。本 README 默认走宝塔模式。

## 端点

| Method | Path                  | 鉴权    | 说明 |
|--------|-----------------------|---------|------|
| GET    | `/healthz`            | 无      | 健康检查（Caddy/宝塔/probe 用） |
| GET    | `/api/ai/status`      | Bearer  | 各 provider 是否配置好 |
| POST   | `/api/ai/minimax`     | Bearer  | MiniMax M3（OpenAI 兼容协议）转发 |
| POST   | `/api/ai/doubao`      | Bearer  | 火山方舟 / Doubao Seed（OpenAI 兼容协议）转发 |
| POST   | `/api/ai/openrouter`  | Bearer  | OpenRouter（OpenAI 兼容协议）转发 |
| POST   | `/api/ai/deepseek`    | Bearer  | DeepSeek 转发 |
| POST   | `/api/ai/claude`      | Bearer  | Anthropic Messages API 转发 |

请求格式与上游一致；body 里 `stream: true` 时服务端以 SSE 形式直传上游字节流。

## 鉴权说明

设了 `AI_PROXY_TOKEN` 后，所有 `/api/*` 请求需带：

```
Authorization: Bearer <token>
```

> ⚠️ 这个 token 会被前端打进 bundle，对反编译者**不是秘密**。它的作用是**挡住不知道 endpoint 的扫描和爬虫**，防止你帮陌生人付 API 费用。要做防滥用，配合 `ALLOWED_ORIGINS` + IP 限流（未来加）。

---

## 一次性部署到腾讯云轻量服（宝塔环境）

### 1. 三层防火墙都放行

腾讯云国内轻量服有 **三层** 防火墙，缺一不可：

| 层 | 在哪改 | 放行什么 |
|---|---|---|
| ① 腾讯云控制台 | 「轻量应用服务器」→ 你的实例 → 「防火墙」 | TCP 22 / 80 / 443 |
| ② 系统层 | `sudo ufw status`，没启用就不用管 | 同上 |
| ③ 宝塔面板 | 「安全」→ 防火墙 | 同上 |

`80/443` 备案前会被运营商封掉；备案完成后可正常用。`22` 端口建议改成非默认（同步改 GitHub Secret 里的 `SERVER_PORT`）。

### 2. 装 Docker

宝塔有 Docker 管理器插件，但建议用官方脚本，更可控：

```bash
ssh root@<服务器 IP>

# 一行装 docker（Ubuntu/Debian/CentOS 通用）
curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun

# 把日常登录用户加进 docker 组（可选，否则 Action 里要用 sudo docker）
usermod -aG docker $USER  # 加完要重新登录生效
docker compose version    # 验证 v2 子命令存在
```

国内 docker hub 偶尔抽风，给 daemon 加镜像加速：

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
EOF
systemctl daemon-reload
systemctl restart docker
```

### 3. 拉代码 + 配 .env

```bash
cd /www/wwwroot   # 宝塔默认站点目录，也可换成 /opt
git clone https://github.com/<你的用户名>/<你的仓库>.git home-inventory
cd home-inventory/server

cp .env.example .env

# 生成 token
openssl rand -hex 32   # 把输出粘到 .env 的 AI_PROXY_TOKEN
nano .env              # 填好 MINIMAX_API_KEY、OPENROUTER_API_KEY 等

# 上线后 CORS 收紧
# ALLOWED_ORIGINS=https://homeapp.zyb.world,capacitor://localhost
```

### 4. 起容器

```bash
cd /www/wwwroot/home-inventory/server
docker compose up -d --build
docker compose logs -f      # 看到 "listening on http://0.0.0.0:8787" 就 OK
```

容器只绑 `127.0.0.1:8787`（不是 `0.0.0.0`），从公网 IP 直接访问端口 **不会通**——这是预期行为，让宝塔 nginx 做反代。

```bash
# 服务器本机内验证
curl http://127.0.0.1:8787/healthz
# {"ok":true,"ts":...}
```

### 5. 宝塔反代 + 证书

宝塔面板「网站」→「添加站点」：

| 字段 | 填什么 |
|---|---|
| 域名 | `homeapp.zyb.world` |
| 备注 | `home-inventory api` |
| 数据库 / FTP / PHP | 都选「不创建/纯静态」 |

建好后点站点名进入设置：

1. **DNS 解析（提前做好）**：在你的 DNS 控制台把 `homeapp.zyb.world` 的 A 记录指向轻量服公网 IP，等几分钟生效（`dig +short homeapp.zyb.world`）。
2. **反向代理**：左边「反向代理」→ 「添加反向代理」
   - 名称：`api`
   - 目标 URL：`http://127.0.0.1:8787`
   - 发送域名：`$host`
   - 高级 → 配置文件，确认有这几行（默认就有，没有就加）：
     ```
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header X-Real-IP $remote_addr;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto $scheme;
     proxy_buffering off;        # 关键：流式响应不能缓冲
     proxy_read_timeout 600s;    # SSE 长连接
     ```
3. **SSL**：左边「SSL」→「Let's Encrypt」→ 勾上域名 → 申请。开启「强制 HTTPS」。

完成后从外面验证：

```bash
curl https://homeapp.zyb.world/healthz
# {"ok":true,"ts":...}

curl https://homeapp.zyb.world/api/ai/status
# {"error":"unauthorized"}            <- 没带 token 应当 401

curl -H "Authorization: Bearer <你的 token>" \
     https://homeapp.zyb.world/api/ai/status
# {"minimax":true,"openrouter":true,...}
```

### 6. 切客户端

仓库根 `.env.local`（**不要提交**，已在 `.gitignore`）：

```
VITE_API_BASE_URL=https://homeapp.zyb.world
VITE_API_PROXY_TOKEN=<同 server/.env 里的 AI_PROXY_TOKEN>
```

```bash
pnpm ios:sync     # 重新 build，把 base URL + token 打进 bundle
pnpm ios:open     # iPhone 上验证 AI 功能
```

---

## GitHub Actions 自动部署

### 1. 在服务器上生成专用部署 key

```bash
ssh root@<服务器 IP>

ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "github-actions-deploy"

# 把公钥追加到 authorized_keys（这样 Action 才能登进来）
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 把私钥内容复制下来，待会粘到 GitHub Secret
cat ~/.ssh/github_deploy
# 注意要包含 -----BEGIN OPENSSH PRIVATE KEY----- 和 -----END ... ----- 两行
```

### 2. 配 GitHub Secrets

仓库 → Settings → Secrets and variables → Actions → 「New repository secret」

| Secret 名 | 值 |
|---|---|
| `SERVER_HOST` | 轻量服公网 IP（或绑了的 ssh 域名） |
| `SERVER_PORT` | SSH 端口，默认 22 |
| `SERVER_USER` | 登录用户名（root / ubuntu / lighthouse） |
| `SERVER_SSH_KEY` | 上一步 `cat` 出的私钥**全文**（含 BEGIN/END 行） |
| `SERVER_DEPLOY_PATH` | 仓库路径，如 `/www/wwwroot/home-inventory` |

可选 Variable（不是 Secret）：

| Variable 名 | 值 |
|---|---|
| `SERVER_DOCKER_SUDO` | `true`（如果登录用户不在 docker 组、必须用 sudo docker） |

### 3. 触发部署

```bash
git tag server-v1.0.0
git push origin server-v1.0.0
```

或在 Actions 页面点 「Run workflow」手动触发。

成功标准：Action 最后一步 health check 拿到 `/healthz` 200。

### 4. 工作流做了什么

`.github/workflows/deploy-server.yml`：

1. SSH 到服务器
2. `cd $SERVER_DEPLOY_PATH && git fetch && git checkout <tag>`
3. `cd server && docker compose up -d --build --remove-orphans`
4. `docker image prune -f`（删悬空镜像）
5. 循环 20s 内 `curl /healthz`，失败则打日志退非零

整个过程不会动 `.env`，所以 token / API key 留在服务器上，重启不会丢。

---

## 日常运维

### 查日志 / 重启 / 升级

```bash
cd /www/wwwroot/home-inventory/server

docker compose logs -f api          # 实时
docker compose logs --tail=200 api  # 最近 200 行

docker compose restart api          # 改 .env 后用这个
docker compose down && docker compose up -d --build  # 完全重启
```

### 改 token / API key

直接编辑 `.env` 后 `docker compose restart`，无需 rebuild（env_file 是运行时挂的）。

改了 `AI_PROXY_TOKEN`：客户端 `.env.local` 也要同步，再 `pnpm ios:sync`。

### 回滚

```bash
git tag --list 'server-v*' --sort=-creatordate | head
git checkout server-v0.9.0
docker compose up -d --build
```

或直接用 Action `workflow_dispatch`，输入 `ref` 为旧 tag 名。

### 看证书过期

宝塔面板「SSL」页面有到期日；或：

```bash
echo | openssl s_client -servername homeapp.zyb.world -connect homeapp.zyb.world:443 2>/dev/null \
  | openssl x509 -noout -dates
```

宝塔会自动续，过期前 30 天会自动更新。

---

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| `curl https://homeapp.zyb.world/healthz` 超时 | 备案没下来；DNS 没生效；腾讯云控制台防火墙没放行 80/443 |
| 502 Bad Gateway | 容器没起来。`docker compose logs api`；多半是 `.env` 缺字段 |
| 通了但所有 API 401 | `Authorization: Bearer` 拼写、token 一字之差 |
| iOS App 报 401 | `VITE_API_PROXY_TOKEN` 改了但没重新 `pnpm ios:sync` |
| iOS App 报 CORS | 上线收紧后忘了加 `capacitor://localhost`，改 `ALLOWED_ORIGINS` |
| Action 报 `Permission denied` | SSH key 配错；私钥没含 BEGIN/END 行；用户不对 |
| Action SSH 连上但 docker 报权限 | 设 Variable `SERVER_DOCKER_SUDO=true` |
| 流式响应卡 / 不分块 | 宝塔反代里 `proxy_buffering off` 没设 |
| 备案中、80/443 不能用 | 在 `.env` 改 `PORT=8788`，docker-compose 里改成 `127.0.0.1:18787:8788`，宝塔反代换成 `http://127.0.0.1:18787`；备完案再改回来 |

---

## 本地调试（不动服务器）

```bash
cd server
cp .env.example .env  # 填 token + provider keys

# 方案 A：纯 node 跑（最快）
AI_PROXY_TOKEN=test-token PORT=8788 node server.js

# 方案 B：docker 起
docker compose up --build

# 验证
curl http://127.0.0.1:8787/healthz
curl -H "Authorization: Bearer test-token" http://127.0.0.1:8787/api/ai/status
```
