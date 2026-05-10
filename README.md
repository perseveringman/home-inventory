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
