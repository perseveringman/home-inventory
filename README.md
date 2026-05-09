# 家居收纳 · 物品档案

> 拍照记录家里每个角落有啥；数据以 Markdown+JSON 写到磁盘，随时交给 AI 分析。

## 快速开始

双击 `index.html` 即可在浏览器里打开，**无需任何构建或后端**。

推荐使用 Chrome / Edge / Arc（可实时同步到本地文件夹）。Safari 和手机浏览器可用 ZIP 导出/导入。

## 核心交互

1. **新建房间** → 给家里每个房间建档案（客厅 / 书房 / 衣帽间…）
2. **拍一张平面照** → 建议把房间的某一面墙完整拍下
3. **标注柜子**：AI 识别自动生成候选框 or 手动框选
4. **点柜子加物品** → 记录名称、数量、备注、标签

找东西时进 **🔍 搜索** 页，输入物品名即可看到"在哪个房间 → 哪个柜子"。

## 数据存储：文件夹优先

数据默认存在浏览器 IndexedDB，但**推荐在"设置页"绑定一个本地文件夹**，应用会实时把数据写成下面这个结构：

```
home-inventory/
├── inventory.json             总索引（AI 先读这个）
├── README.md                  给人看的说明
├── .meta/
│   ├── schema.json            数据 schema
│   └── ai-prompt.md           给 AI 的分析提示词
├── rooms/<房间 slug>/
│   ├── room.md                房间元数据（frontmatter）
│   ├── photos/
│   │   ├── <slug>.jpg         原图
│   │   └── <slug>.json        柜子归一化坐标（rect: [x,y,w,h]）
│   └── cabinets/
│       └── <slug>.md          ⭐ 每个柜子一个 Markdown 文件（核心内容）
└── items/
    └── index.json             反向索引：物品名 → [所在位置]
```

### 柜子 Markdown 示例

```markdown
---
id: c1
slug: 左侧书柜
name: 左侧书柜
room: 书房
photo: ../photos/2026-05-08-photo-1.jpg
rect: [0.04, 0.18, 0.28, 0.70]
updated_at: "2026-05-08T14:30:00Z"
item_count: 2
---

# 🗄️ 左侧书柜

位于 **📚 书房**，共 **2 件物品**。

## 物品清单

- 吸尘器 — 第二层抽屉 `电器`
- 设计模式 × 2 `书籍`
```

**人能直接读写**（Obsidian / VS Code 都行），**AI 能直接理解**（标准 Markdown + frontmatter）。

## 数据同步方案

| 方案 | 适用场景 | 特点 |
|---|---|---|
| 🔗 **绑定文件夹**（默认） | Chrome / Edge / Arc | 实时同步，改完立刻是磁盘真文件，可直接拖给 AI |
| 📦 **ZIP 导出/导入** | Safari / 手机 / 迁移 | 一键打包整个文件夹结构 |
| 📁 **从文件夹导入** | 从另一台 Chrome 迁入 | 选之前同步过的文件夹，自动读回 |

## 交给 AI 分析（关键特性）

导出的文件夹里自带 **`.meta/ai-prompt.md`** —— 把整个文件夹拖给 Claude / ChatGPT / Gemini，附上这个提示词作为系统指令，就能直接问：

- "吸尘器在哪？"
- "耶诞灯还有几个？"
- "书房都有什么？"
- "帮我盘点重复的物品"
- "哪些物品的备注里提到了'坏了'或'闲置'？"

AI 的应答思路已在 `ai-prompt.md` 里写好：
- 查 `items/index.json` 做反向定位
- 读 `cabinets/*.md` 拿上下文
- 按 `🏠 房间 → 🗄️ 柜子 → 位置说明` 给出完整链路

## 接入真实 AI 识别

柜子/物品识别已支持下列 Vision 模型（在「设置」→「配置 API」里填 Key 即可）：

- **OpenRouter（Gemini 2.5 Flash 等）** — 推荐，便宜快
- **Claude Vision（Sonnet 4）** — 备选
- **DeepSeek** — 用于 AI 对话（收纳建议 / 重命名）

API Key 仅保存在你本地浏览器的 IndexedDB，从不经过任何服务器。识别请求由前端直接发往各厂商官方接口。

## 部署到 Vercel

项目是纯静态站点，无构建步骤，可直接部署到 Vercel。

### 方式 1：GitHub 集成（推荐，自动部署）

1. Fork 或 Push 本仓库到你自己的 GitHub
2. 打开 [vercel.com/new](https://vercel.com/new) → Import 选中这个仓库
3. Framework Preset 选 **Other**（或留空自动识别），Build Command 留空，Output Directory 留空
4. 点 **Deploy**。首次部署完成后，之后每次 `git push` 都会自动触发新部署

项目根目录的 `vercel.json` 已经配好了缓存策略（HTML/JS 禁用长缓存确保用户能看到最新版）。

### 方式 2：Vercel CLI 直推

```bash
npm i -g vercel
vercel login       # 首次需要登录
vercel             # 预览部署
vercel --prod      # 正式部署
```

### 注意

- 部署后访问站点的任何人需要**自己在"设置"页填入自己的 API Key**才能使用 AI 功能
- 所有数据（房间/物品/Key）都存在访客自己的浏览器 IndexedDB，不会被他人看到
- 要导出/备份数据，用「设置」→「绑定文件夹」或「导出 ZIP」

## 文件清单

| 文件 | 职责 |
|---|---|
| `index.html` | HTML 骨架 + Tailwind CDN + 底部 tab + 全局悬浮按钮 |
| `app.js` | 页面渲染 / 路由 / 拍照 / 柜子标注 / 物品管理 / AI 识别 / AI 对话 |
| `storage.js` | 文件夹序列化 / FS Access API / ZIP 导入导出 |
| `vercel.json` | Vercel 静态部署配置 |
| `README.md` | 本说明 |

## 下一步可扩展

- [ ] 柜子内细分抽屉层级（`cabinets/<slug>/drawer-1.md`）
- [ ] Web Worker 做 ZIP 压缩避免大数据卡 UI
- [ ] Git 集成（自动 `git commit` 每次变更）
- [ ] 离线 PWA 化，加到手机桌面
