# 家居收纳 · 物品档案

> React + TypeScript + Tailwind CSS 的家庭物品、账单管理应用，monorepo 结构，未来可扩展到 Expo（iOS/Android）与 Electron（桌面）。

## 目录结构

```
home-inventory/
├── packages/
│   ├── core/              # 纯 TS 业务逻辑（三端共享）
│   │   ├── models/        # 数据类型
│   │   ├── storage/       # 存储抽象 + IndexedDB 实现
│   │   ├── services/      # 提醒引擎 / AI / 订阅计算
│   │   └── utils/
│   └── web/               # React + Vite + Tailwind（本期目标）
│       ├── src/
│       │   ├── components/
│       │   ├── pages/
│       │   ├── stores/
│       │   ├── hooks/
│       │   └── App.tsx
│       └── index.html
└── legacy/                # 旧版 vanilla JS（已归档，仅作参考）
```

## 开发

```bash
pnpm install
pnpm dev          # 启动 web（默认端口 5173）
pnpm build        # 构建 web 生产包
pnpm typecheck    # 全包类型检查
```

> **macOS Box 环境注意**：Box 自带的 `boxenv-node` 由于 codesigning 限制，无法加载 Rollup 的 native binding，会报
> `@rollup/rollup-darwin-arm64` 签名错误。请确保使用 Homebrew 装的 Node（`/opt/homebrew/bin/node`）：
>
> ```bash
> export PATH="/opt/homebrew/bin:$PATH"
> pnpm dev
> ```
>
> `typecheck` 不受影响，两种 Node 都可用。

## 部署

Vercel 部署配置与已踩坑记录见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

特别注意：本项目开启了 `cleanUrls: true`，Vite SPA 子路由 fallback 的 rewrite destination 必须写成 `/`，不要写成 `/index.html`，否则 `/rooms`、`/settings` 等子路由会在生产环境直开时返回 Vercel `404: NOT_FOUND`。

## Shadow OAuth / Card 接入

本项目已内置 Shadow 外部应用接入点：

- `/.well-known/shadow-card.json`：Shadow card manifest，入口指向根路径 `/`
- `/api/shadow/oauth/login`：从 Home Inventory 主动发起 Shadow OAuth
- `/api/shadow/oauth/callback`：Shadow 授权完成后的回调地址

Vercel 环境变量参考 `.env.example`：

```bash
SHADOW_BASE_URL=https://shadowob.com
SHADOW_APP_BASE_URL=https://home-inventory-seven-ashy.vercel.app
SHADOW_CLIENT_ID=shadow_xxx
SHADOW_CLIENT_SECRET=shsec_xxx
SHADOW_REDIRECT_URI=https://home-inventory-seven-ashy.vercel.app/api/shadow/oauth/callback
SHADOW_OAUTH_SCOPES=user:read
SHADOW_SESSION_SECRET=replace-with-a-long-random-string
```

## AI 后端代理

AI 请求统一走同源 Vercel Functions，浏览器不再保存或携带供应商 API Key：

- `/api/ai/openrouter`：OpenRouter / Gemini Vision，用于图片识别、图片物品建议和文本备选
- `/api/ai/deepseek`：DeepSeek 文本对话和文本物品建议
- `/api/ai/claude`：Claude Vision 备选
- `/api/ai/status`：只返回哪些后端密钥已配置，不返回密钥本身

在 Vercel Project Settings → Environment Variables 配置：

```bash
OPENROUTER_API_KEY=sk-or-v1-xxx
OPENROUTER_MODEL=google/gemini-2.5-flash
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-v4-flash
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_MODEL=claude-sonnet-4-20250514
AI_HTTP_REFERER=https://your-app.vercel.app
AI_APP_TITLE=Home Inventory
```

本地如果要验证后端函数，请使用 Vercel CLI 的 `vercel dev`，单独运行 `pnpm dev` 只会启动 Vite 前端。

`SHADOW_BASE_URL` 填 Shadow 站点根域名即可，不要带 `/app`；授权页会自动跳到 `/app/oauth/authorize`，token/userinfo 仍走 `/api/oauth/*`。

在 Shadow 开发者设置里创建 OAuth App 时使用：

- Homepage URL: `https://home-inventory-seven-ashy.vercel.app`
- Redirect URI: `https://home-inventory-seven-ashy.vercel.app/api/shadow/oauth/callback`
- Scopes: `user:read`

如果要从 Shadow 首页玩法启动，`homepage-plays-v2` 的 `action` 配置为：

```json
{
  "kind": "external_oauth_app",
  "clientId": "shadow_xxx",
  "redirectUri": "https://home-inventory-seven-ashy.vercel.app/api/shadow/oauth/callback",
  "scopes": ["user:read"]
}
```

## 三端路线

| 端     | 状态   | 说明                                                       |
|--------|--------|------------------------------------------------------------|
| Web    | ✅ 本期 | Vite + React 18 + Tailwind + Zustand + React Router v6    |
| iOS/RN | 规划中 | 新增 `packages/mobile`（Expo），复用 core，UI 用 NativeWind |
| 桌面   | 规划中 | 新增 `packages/desktop`（Electron），壳子复用 web 构建产物 |

## 核心功能

- 🏠 房间 / 柜子 / 物品三层收纳
- ✨ AI 拍照自动识别柜子与物品位置
- ⏰ 提醒引擎：保质期、开封后、保修、库存低、换季、久未动、订阅扣款
- 💳 订阅管理：软件、贷款、水电、会员、保险等定期账单
- 📊 总览：标签分布、房间分布、最近新增
- 🔍 搜索：按名称/备注秒定位
