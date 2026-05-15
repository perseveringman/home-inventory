# 部署备忘

## Vercel 项目设置

本项目是 monorepo，但 Vercel 项目根目录必须保持为仓库根目录：

- Root Directory: `./` 或留空
- Install Command: `pnpm install --no-frozen-lockfile`
- Build Command: `pnpm --filter @home-inventory/web build`
- Output Directory: `packages/web/dist`

不要把 Root Directory 改成 `packages/web`。根目录的 `vercel.json` 和 `api/` 都需要被 Vercel 读取。

## 已踩坑：SPA 子路由 404

症状：

- `/` 可以正常打开 React 应用
- `/rooms`、`/settings`、`/room/:id` 这类子路由直接访问时返回 Vercel 平台层 `404: NOT_FOUND`
- build 日志正常，产物里也有 `dist/index.html`

原因：

Web 端使用 React Router 的 `BrowserRouter`，Vite SPA 的 deep linking 需要 Vercel 把未知路径回退到入口页。Vercel 的 Vite 文档给出的基础写法是把 `/(.*)` rewrite 到 `/index.html`，但同一段文档也说明：如果 `cleanUrls` 是 `true`，source 和 destination 都不能包含文件扩展名，`/index.html` 应写成 `/`。

本项目开启了：

```json
"cleanUrls": true
```

因此不要写：

```json
"rewrites": [
  { "source": "/(.*)", "destination": "/index.html" }
]
```

应写成：

```json
"rewrites": [
  { "source": "/(.*)", "destination": "/" }
]
```

参考：[Vercel Vite docs - Using Vite to make SPAs](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas)

## 验证步骤

部署完成后至少验证：

```bash
https://<deployment-domain>/
https://<deployment-domain>/rooms
https://<deployment-domain>/settings
```

如果 `/` 正常但子路由仍是 `404: NOT_FOUND`：

1. 先确认最新 Production deployment 的 commit 包含根目录 `vercel.json`。
2. 再确认 Vercel Project Settings 的 Root Directory 是仓库根目录。
3. 最后检查 `cleanUrls: true` 时 rewrite destination 是否仍错误地写成 `/index.html`。
