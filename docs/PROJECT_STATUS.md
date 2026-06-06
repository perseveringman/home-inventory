# 项目当前状态

> 给"过几周后回来不知道项目长啥样了"的自己看。
> 最后更新：2026-05-30

## 一句话

家居收纳应用的 monorepo：核心业务逻辑沉在 `packages/core`，Web 前端在 `packages/web`，iOS 原生壳通过 Capacitor 打包，AI 后端从 Vercel functions 复制了一份到 `server/` 准备自托管。

## 三种部署形态（同一份代码）

```
                 packages/core (业务逻辑 + 存储抽象)
                          │
                  packages/web (UI / Vite)
                          │
        ┌─────────────────┼─────────────────┐
        ↓                 ↓                 ↓
   Vercel              Capacitor         浏览器直访
   (现在用)             iOS App           (开发用)
   api/ai/* 同源        无后端，需         同 Vercel
                       VITE_API_BASE_URL
                       指向自托管后端
```

| 形态 | 现状 | 入口 / 命令 |
|---|---|---|
| **Web on Vercel** | 已上线（现役） | https://home-inventory-seven-ashy.vercel.app |
| **Web 本地开发** | ✅ 可跑 | `pnpm dev` 或 `vercel dev`（后者带 functions） |
| **iOS App（Capacitor）** | ✅ 模拟器跑通 | `pnpm ios:run` |
| **Android App** | ❌ 未做 | 见 ROADMAP |
| **自托管 AI 后端** | 🟡 代码就绪，未实际部署 | `server/` 目录，Docker + 宝塔反代 |

## 目录结构（关键路径）

```
home-inventory/
├── packages/
│   ├── core/                              # 三端共享业务逻辑
│   │   └── src/services/
│   │       ├── apiBase.ts                 # ★ API host + Bearer token 抽象
│   │       ├── ai.ts                      # 视觉识别（OpenRouter / Claude）
│   │       ├── chat.ts                    # 文本对话流式
│   │       ├── itemSuggestion.ts          # 物品建议
│   │       └── subscriptionImport.ts      # 订阅导入
│   └── web/
│       ├── src/
│       │   ├── main.tsx                   # 启动注入 VITE_API_BASE_URL + token
│       │   ├── lib/nativeImage.ts         # ★ pickImage 跨平台拍照/相册
│       │   └── ...
│       ├── capacitor.config.ts            # Capacitor 配置
│       └── ios/                           # 原生工程（git 已跟踪 source，忽略 build）
│
├── api/ai/                                # Vercel functions（仍在用）
│   ├── _shared.js
│   ├── status.js  openrouter.js  claude.js  deepseek.js
│
├── server/                                # 自托管版本（基于上面 api/ 复刻）
│   ├── server.js                          # Node 原生 http
│   ├── Dockerfile
│   ├── docker-compose.yml                 # ★ 宝塔模式（推荐）
│   ├── docker-compose.caddy.yml           # 备用：纯 docker + Caddy
│   ├── Caddyfile                          # 备用模式用
│   ├── .env.example
│   └── README.md                          # 部署细节
│
├── .github/workflows/
│   └── deploy-server.yml                  # tag server-v* 触发部署
│
└── docs/
    ├── PROJECT_STATUS.md                  # 你正在看
    ├── ROADMAP.md                         # 待办
    ├── DEPLOYMENT.md                      # Vercel 部署历史踩坑
    └── MIGRATION_AUDIT.md
```

## 关键决策与原则

### 1. 业务逻辑必须放 `packages/core`，不能写到 `packages/web/src` 里

`core` 是纯 TS，没有 React/DOM 依赖，将来 RN/桌面端都要复用。pages/components 只做"调用 + 展示"，业务计算往 services 里塞。

### 2. AI 调用必须走 `apiUrl()` + `apiAuthHeaders()`

不要再写 `fetch('/api/ai/...')` 硬编码相对路径。原因：原生 App 的 WebView 没有同源后端，必须走环境变量注入的远程 host。具体见 `packages/core/src/services/apiBase.ts`。

```ts
// 正确写法
fetch(apiKey ? UPSTREAM_DIRECT : apiUrl(`/api/ai/${provider}`), {
  headers: {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : apiAuthHeaders()),
  },
})
```

### 3. 拍照/相册必须走 `pickImage()`，不要写 `<input type="file">`

`packages/web/src/lib/nativeImage.ts` 抽象掉了 Web/原生差异。原生用 Capacitor Camera 弹系统级 sheet，Web 走 file input。

例外：非图片的文件选择（CSV/JSON）保留 file input（`LabelsPage`、`SubscribePage`）。

### 4. iOS 原生工程（`packages/web/ios/`）整个目录都跟踪 git

只忽略构建产物（`Pods/`、`build/`、`DerivedData/`、`App/public/`），其余 source 文件（`App.xcodeproj`、`Info.plist`、`Package.swift`）全部 commit。

理由：CI 直接 checkout 就能 build；不存 source 等于把"重新创建 Capacitor 工程"的步骤丢了。

### 5. Bearer token 不算秘密

`AI_PROXY_TOKEN` 进了前端 bundle，反编译就能拿。它是"挡爬虫和扫描器"的最小屏障，不是真凭证。要做防滥用还得配合 `ALLOWED_ORIGINS` + IP 限流。

### 6. 备份策略：现存 `api/ai/*` 与 `server/server.js` 平行

迁到自托管后**不要立刻删 Vercel 的 `api/ai/*`**——先让自托管跑稳两周，再决定要不要下线 Vercel 的版本。`server/server.js` 直接 `require('../api/ai/*.js')`，两边逻辑一致，不会漂移。

## 关键环境变量速查

### 服务端（`server/.env`）

| 变量 | 必需 | 说明 |
|---|---|---|
| `AI_PROXY_TOKEN` | ✅ | Bearer 鉴权 token，`openssl rand -hex 32` 生成 |
| `MINIMAX_API_KEY` | 至少一个 | MiniMax 国内 Token Plan（M3 多模态主力） |
| `MINIMAX_MODEL` | | 默认 `MiniMax-M3` |
| `OPENROUTER_API_KEY` | 可选 | OpenRouter（历史兼容 / 备选） |
| `OPENROUTER_MODEL` | | 默认 `google/gemini-2.5-flash` |
| `ANTHROPIC_API_KEY` | 至少一个 | Claude（视觉备选） |
| `DEEPSEEK_API_KEY` | 可选 | DeepSeek（仅文本） |
| `ALLOWED_ORIGINS` | 上线后 | 收紧到 `https://homeapp.zyb.world,capacitor://localhost` |

### 客户端（仓库根 `.env.local`，**不提交**）

| 变量 | 何时填 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | 走自托管或原生 App | `https://homeapp.zyb.world` |
| `VITE_API_PROXY_TOKEN` | 服务端启用了鉴权 | 同 `AI_PROXY_TOKEN` |

留空时走相对路径（Vercel 同源 functions），适合纯 web 部署。

### Vercel（已配好，无需改）

`MINIMAX_API_KEY` / `ANTHROPIC_API_KEY` 等同上一致；Shadow OAuth 那几个见 README。

## 三端共享原则

| 端 | 状态 | 实现路径 |
|---|---|---|
| **Web** | ✅ 现役 | Vercel 直接吃 `packages/web/dist` |
| **iOS** | ✅ 模拟器跑通 | Capacitor 8（SPM） + 宝塔 nginx 反代后端 |
| **Android** | ❌ | `pnpm exec cap add android`，需先装 Android Studio |
| **桌面** | ❌ 规划 | Electron / Tauri 二选一，未启动 |

复用比例：`packages/core` 100%，UI 0%（每端各写一份；目前 iOS 复用 web UI 是 Capacitor WebView 的产物，不是真复用）。

## 已知约束 / 不能轻动的地方

1. **Vite + Vercel functions 的协作**：`vercel.json`、`packages/web/dist` 输出路径、`api/` 的位置——历史踩过坑，见 `docs/DEPLOYMENT.md`。**不要把 Vercel Root 改成 `packages/web`**。

2. **macOS Box 环境的 Node binding 问题**：用系统/Homebrew 装的 Node，不要用 boxenv-node，否则 Rollup native binding 报签名错误。

3. **国内 Docker 镜像源**：`server/Dockerfile` 已加阿里 apk 源 + 腾讯 npm 源；服务器 daemon 加镜像加速器（README 里有）。海外用户构建会慢，按需调整。

4. **bundle id 一旦确定不要改**：`com.zhouyanbo.homeinventory`。改了 iOS 的 keychain、IndexedDB、推送证书全部要重发。

## 出问题先看哪

| 现象 | 看哪 |
|---|---|
| Vercel 上 SPA 子路由 404 | `docs/DEPLOYMENT.md`（cleanUrls + rewrite） |
| iOS build 失败 / SPM 缓存冲突 | `~/.codebuddy/projects/.../memory/ios-capacitor-setup.md`（已记） |
| iOS App 拍照不弹原生 sheet | 检查 `Info.plist` 是否有 `NSCameraUsageDescription` |
| iOS App AI 报 401 | `VITE_API_PROXY_TOKEN` 改了但没重新 `pnpm ios:sync` |
| 自托管后端起不来 | `server/README.md` 故障排查表 |
| Action 部署失败 | `.github/workflows/deploy-server.yml`，最常见是 SSH key 没配对 |
