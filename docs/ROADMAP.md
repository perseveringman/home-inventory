# 路线图 / 待办

> 按"立即/短期/中期/远期"分层。每条都标了价值、依赖、估计成本。
> 顺序不是优先级，按你心情挑。
> 最后更新：2026-05-30

---

## 🔴 立即可做（阻塞当前阶段闭环）

这一组都是"刚刚做了一半，还差临门一脚"的事。不做就等于前面工作浪费。

### 1. 把后端真正部署到腾讯云轻量服

- **状态**：`server/` 代码就绪，本地 smoke test 通过；尚未在服务器上跑起来
- **要做**：
  - [ ] DNS：`homeapp.zyb.world` A 记录 → 轻量服公网 IP
  - [ ] 三层防火墙放行 80/443/22（腾讯云控制台、宝塔、系统）
  - [ ] 服务器装 Docker + 镜像加速
  - [ ] `git clone` + 填 `.env`
  - [ ] `docker compose up -d --build`
  - [ ] 宝塔新建反代站点 + 申请 SSL 证书
  - [ ] 公网验证 `curl https://homeapp.zyb.world/healthz`
- **完整步骤**：`server/README.md`
- **价值**：解锁原生 App 的 AI 功能（现在只能用同源 Vercel）
- **风险**：备案状态、运营商封 80/443、宝塔反代 buffer 没关导致 SSE 卡住

### 2. 配 GitHub Actions 部署链路

- **状态**：`.github/workflows/deploy-server.yml` 写好但没跑过
- **要做**：
  - [ ] 服务器生成 `~/.ssh/github_deploy` ed25519 key
  - [ ] 公钥追加 `authorized_keys`
  - [ ] 仓库 Settings 配 5 个 secret（`SERVER_HOST` / `SERVER_PORT` / `SERVER_USER` / `SERVER_SSH_KEY` / `SERVER_DEPLOY_PATH`）
  - [ ] `git tag server-v1.0.0 && git push origin server-v1.0.0` 实测一次
- **价值**：以后改后端代码 = `git tag` 一次自动部署，不用手动 ssh
- **风险**：第一次容易踩 SSH key 格式 / 用户没在 docker 组 / `git pull` 因为本地有未跟踪文件失败

### 3. 切客户端到自托管后端 + iOS 真机实测

- **依赖**：上面两条做完
- **要做**：
  - [ ] 仓库根 `.env.local` 写 `VITE_API_BASE_URL` + `VITE_API_PROXY_TOKEN`
  - [ ] `pnpm ios:sync` 重新打包
  - [ ] iPhone 真机连数据线，Xcode 选 team 签名（免费 Apple ID 即可）
  - [ ] 拍照 → 识别 → 看 AI 是否真的走自托管后端（看后端日志验证）
- **价值**：第一次端到端跑通"原生 App + 独立后端"
- **可能踩的坑**：
  - 真机首次需要在「设置 → 通用 → VPN与设备管理」信任开发者证书
  - `capacitor://localhost` 这个 origin 没加进 `ALLOWED_ORIGINS` 会 CORS 报错
  - 免费 Apple ID 证书 7 天到期要重新装

### 4. 给 iOS App 配图标和启动图

- **状态**：现在用的是 Capacitor 默认蓝色 "C"
- **要做**：
  - [ ] 准备一张 1024×1024 的 PNG（圆角不用自己加）
  - [ ] `pnpm --filter @home-inventory/web add -D @capacitor/assets`
  - [ ] 准备 `assets/icon-only.png`、`assets/splash.png`、`assets/splash-dark.png`
  - [ ] `pnpm exec capacitor-assets generate --ios`
  - [ ] `pnpm ios:sync`
- **价值**：上架前必须做；不然连 TestFlight 都会卡审核
- **成本**：1 小时（找设计师 / 自己 PS 一个）

---

## 🟡 短期（一两周内做完，明显提升体验）

### 5. AI 后端从 Vercel 下线（迁移收尾）

- **依赖**：第 1-3 条做完且稳定运行 ≥ 2 周
- **要做**：
  - [ ] 自托管后端跑两周观察延迟、错误率、费用
  - [ ] 删掉 `api/ai/`（保留 `api/shadow/` 因为 Shadow OAuth 还要 Vercel）
  - [ ] `vercel.json` 移除 functions 配置
  - [ ] 删掉 Vercel 上的 `OPENROUTER_API_KEY` 等环境变量（避免 key 漏出）
  - [ ] Web 部署也走自托管：把 Vercel 上的网页改成静态托管，所有 `/api/ai/*` 调用走 `homeapp.zyb.world`（前提是处理好 CORS）
- **价值**：降低 Vercel functions 流量费、统一鉴权口径
- **风险**：Shadow OAuth 还在 Vercel，要分开评估
- **要不要做的开放问题**：你可能想保留 Vercel 作为 web 主站，自托管只服务 iOS——这种场景下两套都留是合理的

### 6. 用 `@capacitor/preferences` 替换 localStorage 关键项

- **背景**：localStorage 在 iOS WebView 里**会被系统在低存储时清理**；IndexedDB 也偶发清理
- **范围**：**不是**全替换。只替换"丢了就坏了"的关键配置：
  - 用户填的第三方 API key（`openrouterApiKey` / `claudeApiKey` / `deepseekApiKey`）
  - 同步设置（如果做云同步）
- **不替换**：缓存类、临时状态、UI 偏好（这些丢了无所谓）
- **要做**：
  - [ ] 在 `packages/core/src/storage/` 加 `preferences.ts` 抽象
  - [ ] 原生用 `@capacitor/preferences`，Web fallback `localStorage`
  - [ ] 把 `getConfig` / `setConfig` 关键 key 切过去
- **价值**：iOS 上不会因为系统清理把用户填的 key 弄丢
- **成本**：3-4 小时

### 7. 实测 + 修复 iOS 上可能存在的小问题

iOS 模拟器跑通≠真机体验好。逐项验证：

- [ ] 安全区：刘海/Dynamic Island 区域没遮挡内容（已设 `viewport-fit=cover`，但实测每个页面）
- [ ] 键盘弹起：输入框被键盘挡住时是否自动滚到可视
- [ ] 横屏：要不要锁竖屏？（现在 `Info.plist` 是允许横屏的）
- [ ] 返回手势：iOS 边缘左划返回会不会和应用内逻辑冲突
- [ ] 状态栏配色：浅色背景 + 浅色状态栏会糊（用 `@capacitor/status-bar` 在启动时设 `Style.Dark`）
- [ ] 拍照后页面崩 / 卡：图片体积大时
- [ ] 长按文本会弹"分享/复制"系统菜单，要不要禁

### 8. 添加 Android 平台

- **状态**：未开始
- **要做**：
  - [ ] 装 Android Studio（macOS 上 ~5GB 下载）
  - [ ] `pnpm --filter @home-inventory/web add -D @capacitor/android`
  - [ ] `pnpm exec cap add android`
  - [ ] 生成签名 keystore
  - [ ] 模拟器跑通
- **价值**：覆盖另一半用户
- **延后理由**：你目前主用 iPhone，Android 端用户少；上 Google Play 还要 $25 一次性 + Play Console 配置
- **成本**：第一次 1-2 天

---

## 🟢 中期（一两个月，体验/工程化升级）

### 9. iOS App Store 上架

- **依赖**：第 4 条（图标）、第 7 条（小问题修复）
- **流程**：
  - [ ] 注册 Apple Developer Program（$99/年）
  - [ ] App Store Connect 建条目
  - [ ] 准备截图（6.7" iPhone 必须，三张以上）
  - [ ] 隐私政策（必填，可托管在主站某个 `/privacy` 页）
  - [ ] App 描述、关键词、分类
  - [ ] TestFlight 内部测试
  - [ ] 提交审核
- **审核风险点**：
  - "Web view 套壳"被 4.2 拒——重点写"工具类应用，配合家庭物品管理"，**不要**写"我们的网页 App"
  - 要求列出独立后端的隐私边界（用户图片是否上传、上传到哪、保留多久）
  - 拍照权限文案要具体（已写好）
- **成本**：$99 + 几个晚上

### 10. 后端监控 + 告警

- **现状**：只有 docker logs，没人主动看
- **建议方案**：
  - 简单：Uptime Robot 免费版每 5 分钟 ping `/healthz`，挂了发邮件/微信
  - 中级：服务器装 Netdata 看 CPU/内存，宝塔自带的也行
  - 高级：Grafana + Prometheus + Loki 全套（杀鸡用牛刀）
- **告警**：
  - [ ] 进程挂了
  - [ ] 4xx/5xx 比例突增
  - [ ] AI provider 账户余额低（OpenRouter 有 webhook）
- **价值**：上线后晚上能睡好觉
- **成本**：Uptime Robot 0 元 + 30 分钟配置

### 11. 限流 + 滥用防护

- **背景**：Bearer token 不防反编译；万一 token 泄露，恶意用户能把你 OpenRouter 余额薅光
- **方案**：
  - 在 `server/server.js` 加 IP 滑动窗口限流（每 IP 每分钟 N 次）
  - 或在 Caddyfile / 宝塔 nginx 层加（更好，不占 Node）
  - OpenRouter / Claude 后台设月度上限
  - `ALLOWED_ORIGINS` 收紧到 `https://homeapp.zyb.world,capacitor://localhost`
- **价值**：把"被薅"的最大损失封顶
- **成本**：限流 1 小时；上限设置 5 分钟

### 12. 给 server 加 CI（lint / test / build 镜像）

- **现状**：只有 deploy workflow，没有 CI 校验
- **要做**：
  - [ ] 加 `.github/workflows/ci.yml`：lint + typecheck + 跑现有 vitest
  - [ ] 加 docker build dry run，验证 Dockerfile 改动不会导致部署失败
  - [ ] PR 必须过 CI 才能 merge
- **价值**：避免改坏一些没人测的角落
- **成本**：1 小时

### 13. 数据备份 / 导出

- **背景**：用户在 iOS 上的 IndexedDB 数据完全本地，手机丢了就没了
- **方案**：
  - 简单：设置页加"导出 JSON / ZIP"按钮（现在已有部分功能在 `legacy`）
  - 进阶：基于 `server/` 加云同步（每个设备一个用户 ID，server 存全量数据）
- **风险**：开了云同步就要面对账号体系、用户隐私协议
- **建议先做"导出"**，云同步等用户多了再说
- **成本**：导出 半天；云同步 1-2 周

---

## 🔵 远期 / 想法（暂不计划）

### 14. 桌面端（Electron / Tauri）

`README.md` 里写了规划，但没启动。如果做：
- Tauri 比 Electron 包小一个数量级（Rust 后端）
- 直接复用 web 构建产物
- 想做的契机：你想在 Mac 上也能整理收纳

### 15. 多用户 + 协作

家庭成员共用一份收纳档案。需要：
- 账号体系（直接接 Shadow OAuth 已经接了一半）
- 服务端数据库（PostgreSQL）
- 实时同步（看是 polling 还是 WebSocket）

### 16. 离线 AI / 本地视觉模型

WebGPU 跑小模型识图，无需联网。优势：免费 + 隐私。劣势：iOS WebView 不一定支持 WebGPU；模型体积大。

### 17. NFC / 二维码标签管理

物品贴码、扫码立刻定位"在哪个柜子"。`packages/core/src/services/labels.ts` 已有雏形，扩展到原生扫码很快。

---

## 历史决策（避免重复讨论）

记录已经讨论过的、不打算做的事，省得过几个月又想起来：

- **❌ 用 Expo / RN 重做移动端**：项目已是 Vite + React Web，Capacitor 套壳代价 1/10。决策于 2026-05-30，见 `~/.codebuddy/.../memory/ios-capacitor-setup.md`。
- **❌ 自己做 nginx + certbot**：宝塔自带；Caddy 自动续证；除非有特殊需求别折腾。
- **❌ 把 Bearer token 当强凭证**：会进 bundle，反编译就拿到。它是"挡爬虫"的最小屏障。详见 `server/README.md`。
- **❌ 把 Vercel 的 `api/ai/*` 立刻删了搬到自托管**：保留两份共存 ≥ 2 周观察；自托管挂了能秒切回 Vercel。

## 待你决策的开放问题

1. **Vercel 还要不要保留？** 三种选项：
   - A. Web + 后端都搬走（运维成本最低）
   - B. Web 留 Vercel，后端搬走（CDN 加速 + 自托管 AI）← 我倾向这个
   - C. 两边都留（最灵活但要维护两套）

2. **Apple Developer 账号现在交还是上架前再交？** $99/年 续费制；如果半年内不上架，可以推迟。

3. **要不要现在就做 Android？** 你主用 iPhone，可以先把 iOS 做扎实再说。

4. **数据备份的紧迫程度？** iOS 用户 IndexedDB 数据 100% 本地，丢了无法恢复。先做"导出 JSON" 防灾足够。
