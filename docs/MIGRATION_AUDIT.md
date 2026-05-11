# 迁移一致性审计与补齐计划

> **项目**：home-inventory（家居收纳 · 物品档案）
> **审计对象**：从 `legacy/` 的 vanilla HTML/JS（4235 行 app.js + 746 行 storage.js + 389 行 demo.js）迁移到 `packages/web` 的 React + TS + Tailwind monorepo 架构。
> **审计方法**：逐行对照旧版所有 60+ 个函数、9 个页面、4 个对话框、全部辅助工具，核对新版 `packages/core` 与 `packages/web/src` 的覆盖情况。
> **结论**：模型层 100% 迁移、渲染骨架 100% 迁移，但 **核心交互约丢失 60%**。本文档给出完整 gap 清单与两批补齐计划。

---

## 0. TL;DR

| 维度 | 旧版 | 新版 | 状态 |
|---|---|---|---|
| 代码规模 | 5370 行 | ~2500 行 | 约 47% |
| 数据模型（types/enums/常量） | ✅ | ✅ | 完整 |
| 提醒引擎（6 类 item 事件 + 订阅事件） | ✅ | ✅ | 完整 |
| 订阅基本 CRUD | ✅ | 🟡 | 字段精简、无暂停分段、无 autoRenew |
| 页面骨架（9 个 scene/route） | ✅ | ✅ | 完整 |
| **页面核心交互** | ✅ | ❌ | **严重缺失** |
| **AI 识别/手动框选/边框编辑** | ✅ | ❌ | **核心灵魂功能缺失** |
| **全局 4 个悬浮按钮** | ✅ | ❌ | **全部缺失** |
| 文件夹同步 / ZIP 导入导出 / 示例数据 | ✅ | ❌ | 完全没迁移 |
| AI 对话抽屉（流式 + 重命名采纳） | ✅ | ❌ | 完全没迁移 |
| API 配置弹窗（含三路连通性测试） | ✅ | ❌ | 完全没迁移 |

本文把缺失项分为 **P0（阻塞核心体验）/ P1（明显差距）/ P2（细节锦上添花）**，并给出两批实施路线图。

---

## 1. 迁移架构与目录对照

```
legacy/                           packages/
├── index.html  (363 行)          ├── core/                 (共享纯 TS)
├── app.js      (4235 行)         │   └── src/
│   ├─ IndexedDB 封装             │       ├── models/        ← 实体 + 枚举 + 预设
│   ├─ Claude/Gemini Vision       │       ├── storage/       ← Storage 接口 + IndexedDB 实现
│   ├─ 提醒引擎                   │       ├── services/      ← ai / reminder / subscription / cabinet
│   ├─ 9 个 render* 页面          │       └── utils/         ← uid / image / date
│   ├─ 7 个 openXxxDialog         │
│   ├─ 文件夹同步（FSA）           └── web/                  (Vite5 + React18)
│   ├─ ZIP 打包/解包                  └── src/
│   ├─ AI 对话抽屉                     ├── components/       ← Scenebar / Tabbar / Header / Modal / BlobImage
│   ├─ API 配置弹窗                    ├── stores/useStore   ← zustand 内存镜像
│   ├─ 4 个全局 Fab                    ├── pages/
│   └─ 1 段启动流程                    │   ├── storage/      ← RoomsPage / RoomDetailPage / PhotoDetailPage / ItemsPage / SearchPage
├── storage.js  (746 行)                │   ├── modals/       ← RoomDialog / CabinetDialog / ItemDialog / SubscriptionDialog
│   └─ YAML/frontmatter/ZIP           │   ├── InboxPage
│      buildFileTree/parseFileTree    │   ├── OverviewPage
│      FSA 封装                        │   ├── SubscribePage
└── demo.js     (389 行)                │   └── SettingsPage
    └─ 3 个示例房间 + 示例照片        └── App.tsx
```

---

## 2. Gap 清单（按文件/功能粒度）

> 标识：❌ 完全缺失 · 🟡 已实现但与旧版有明显差距 · ✅ 与旧版一致。

### 2.1 照片详情页 `PhotoDetailPage`（P0 · 重灾区）

旧版 `renderPhotoDetail` 约 530 行，是全应用**最核心的交互页**；新版只有 185 行。

| 功能 | 旧版位置 | 新版状态 | 备注 |
|---|---|---|---|
| AI 识别按钮（复用已上传照片） | 1570-1626 | ❌ | 新版只在**上传新照片时**触发，已存在的照片不能再跑识别 |
| 手动框选柜子（在图上拖拽出矩形） | 1628-1689 | ❌ | `draw-layer` + pointer/touch 事件 + 新柜子命名 |
| 编辑柜子边框（选中 + 8 手柄 + 平移） | 1691-1815 | ❌ | `editingBoxes` 模式，含 NW/N/NE/E/SE/S/SW/W 缩放与整体平移 |
| 删除照片（含级联删 cabinets/items） | 1554-1568 | ❌ | |
| 点柜子打开弹窗（`openCabinetDialog`） | 1817-1949 | 🟡 | 新版点柜子只切换 `activeCabinet`，弹窗被削成简单重命名 |
| 柜子列表缩略条（带物品 8 格预览） | 1519-1549 | ❌ | |

### 2.2 柜子对话框 `CabinetDialog`（P0）

旧版 `openCabinetDialog` ≈ 物品管理中心（1817-1949，含 HTML 约 130 行）。

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| 柜子重命名 | ✅ 即时 change 保存 | ✅ | OK |
| 删除柜子（级联删物品） | ✅ | ✅ | OK |
| **5 列物品网格**（emoji/图+名字+数量+保质期徽标） | 1831-1849 | ❌ | |
| **嵌入式加物品表单**（名称/数量/备注/保质期/拍照/选图） | 1852-1877 | ❌ | |
| 直接删物品（hover ×） | 1845-1848 | ❌ | |

### 2.3 待处理页 `InboxPage`（P0）

旧版 `renderInbox` 约 200 行。

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| 待归位物品**按房间分组**展示 | 2073-2144 | ❌ | 新版扁平网格 |
| 事件**按 kind 分组**（保质期/开封/保修/库存/换季/久未动/订阅） | 2082-2087 / 2155-2215 | ❌ | 新版按 level 平铺 |
| 事件行显示**位置信息**（房间 › 柜子） | 2193-2196 | ❌ | |
| 事件行显示**物品缩略图** | 2199-2201 | ❌ | |
| 订阅事件点击 → 打开 SubscriptionDialog | 2233-2238 | ❌ | 新版点击无反应 |
| critical 数 chip 徽标 | 2088 / 2152 | ❌ | |

### 2.4 物品归位/编辑对话框 `ItemDialog`（P0）

旧版 `openItemProcessDialog` 约 300 行，新版 373 行但关键交互缺失。

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| **房间+柜子两级联动下拉** | 2399-2478 | ❌ | 新版只有单一 `cabinetId` 下拉 |
| 虚拟选项 `__global_loose__` / `__room_loose__` | 2459-2475 | ❌ | 没法"放到全屋自由区/此房间自由区" |
| **来源照片预览 + AI rect overlay** | 2408-2416 | ❌ | 失去溯源能力 |
| 保质期徽标实时预览 | 2336 | ❌ | |
| 保质期"清除"按钮 | 2334 / 2492 | ❌ | |
| 对话框内删除按钮 | 2420 / 2482 | ❌ | |
| `status: pending → placed` 的语义按钮"保存并归位" | 2423 | 🟡 | 新版叫"保存"，不显性 |
| 自定义标签 Enter/逗号追加 | 2527-2538 | 🟡 | 新版要点"＋" |

### 2.5 房间列表页 `RoomsPage`（P0）

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| **全屋自由区卡片**（带物品数、pending 徽标） | 1189-1199 | ❌ | 入口缺失 |
| **房间封面图**（第一张照片作封面） | 1170-1177 | ❌ | 只显示 emoji |
| 统计包含柜子数 🗄️ | 1181-1184 | 🟡 | 新版只显示 📸/📦 |
| 编辑/删除交互 | modal tap 编辑按钮 | ❌ | 新版用 `prompt('e/d')` 极反直觉 |
| 首次空态引导 | 1160-1165 | ✅ | OK |

### 2.6 房间详情页 `RoomDetailPage`（P0）

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| **自由物品收纳处入口**（房间级 pending 集中处） | 1376-1389 | ❌ | |
| 首次拍照**双按钮**（📷 拍照 / 🖼️ 选图） | 1330-1344 | 🟡 | 新版只 capture 拍照 |
| 已有照片时的**加照片占位卡**（双按钮） | 1360-1373 | 🟡 | |
| 引导横幅（"拍几张平面照，AI 会识别柜子"） | 1319-1325 | ❌ | |
| 照片卡右上**柜子数徽标** | 1354 | ❌ | |
| 编辑房间入口 | 1314-1316 / 1394 | ❌ | 新版没有 |

### 2.7 物品页 `ItemsPage`（P1）

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| **按房间→柜子二级分组** | 1965-2031 | ❌ | 新版扁平网格 + tag filter |
| 物品页排除 pending | 1960 | ❌ | 新版混显（通过 filter 切换） |
| 面包屑跳到房间/照片页 | 2036-2037 | 🟡 | 新版只能打开 ItemDialog |

### 2.8 搜索页 `SearchPage`（P2）

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| 结果点击跳到物品所在**照片页** | 2655-2657 | 🟡 | 新版打开 ItemDialog（更合理但失去可视化） |
| 支持 `tags` 搜索 | ❌ | ✅ | **新版更好** |
| 空态文案"输入关键词开始搜索" | 2622 | ❌ | |

### 2.9 总览页 `OverviewPage`（P1）

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| 概览卡片：物品总数（含总件数 qty） | 2703 | 🟡 | 新版没合计 qty |
| 概览卡片：**紧急提醒数** | 2705 | ❌ | |
| 概览卡片：**待归位数** | 2706 | ❌ | |
| 概览卡片：**订阅月度 ¥** | 2707 | ❌ | |
| 标签分布进度条 | 2717-2742 | ✅ | OK |
| 按房间分布（水平进度条） | 2744-2765 | 🟡 | 新版是卡片，不如进度条直观 |
| 点击房间跳转 | 2786-2796 | ❌ | |
| 统计排除 pending | 2672 | ❌ | 新版用 `items.length` 含 pending |

### 2.10 订阅页 `SubscribePage` + 对话框（P1）

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| 费用卡片：月均/年均/生效数 | 2920-2934 | ✅ | OK |
| **分类月均支出进度条** | 2936-2955 | ❌ | |
| **已暂停订阅单独成段**（opacity 75%） | 2993-3012 | 🟡 | 新版混显+半透明 |
| 订阅自定义 emoji 图标 | 3062-3070 | ❌ | 只用分类 emoji |
| 订阅卡**hash 背景色**（`subColorBg`） | 2978 / 3028-3031 | ❌ | |
| 对话框"标记本期已付"按钮 | 3059 / 3204 | 🟡 | 新版只能从列表点"已付" |
| `autoRenew` / `startedAt` / `endAt` 字段 | 3109-3135 | ❌ | Types 已定义，UI 缺 |
| 暂停/恢复按钮 | 3142 / 3196 | ✅ | OK |

### 2.11 设置页 `SettingsPage`（P0 数据管理 + P1 AI 配置）

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| 数据概览（房间/照片/柜子/物品+存储 MB） | 3381-3390 | 🟡 | 缺"照片/柜子"、缺存储占用 |
| **文件夹同步**（bind/unbind/立即同步，auto on write） | 3392-3413 / 3225-3307 | ❌ | FSA 能力全丢 |
| **ZIP 导出/导入** | 3416-3423 / 3309-3346 | ❌ | |
| **从文件夹导入** | 3424 / 3348-3356 | ❌ | |
| **加载示例数据** | 3425 / demo.js | ❌ | |
| 清空所有数据 | 3426 / 3477-3486 | ✅ | OK |
| **API 配置弹窗**（含 OpenRouter/DeepSeek/Claude + 三路测试） | 3443-3444 / 3969-4198 | 🟡 | 新版简化成 inline 输入框，无 DeepSeek、无测试按钮 |
| 使用指南文案 | 3454-3463 | ❌ | |

### 2.12 全局悬浮按钮（P0 · 完全缺失）

旧版 `index.html` 298-358 行 + `app.js` 772-1025 行，一共 4 个按钮：

| Fab | 功能 | 旧版位置 | 新版状态 |
|---|---|---|---|
| 💬 AI 对话助手 | 打开抽屉，含流式聊天、上下文（rooms/cabinets/items 摘要）、重命名采纳卡 | `openChatPanel` 3733-3964 | ❌ |
| 📷 即时识别（拍照） | 拍照 → 压缩 → AI 识别 → 裁剪 → 入当前房间自由区（或全屋自由区） | `runQuickItemScan` 801-888 | ❌ |
| 🖼️ 即时识别（选图） | 同上，但从相册选 | 同上 | ❌ |
| ✏️ 快速文字录入 | 多行物品（`名称×数量, 备注` 语法）+ 选择目的地 + 统一保质期 → 批量入库 | `openQuickAddDialog` 898-1025 | ❌ |

### 2.13 AI 能力（P1）

| 功能 | 旧版 | 新版 core | 备注 |
|---|---|---|---|
| OpenRouter / Gemini Vision | 3526-3583 | ✅ | OK |
| Claude Vision | 88-282 | ✅ | OK |
| 启发式占位 | 687-711 | ✅ | OK |
| **DeepSeek 文本对话** | 3499-3521 | ❌ | 完全没迁 |
| **流式聊天 `streamChatWithAI`**（SSE 解析） | 3606-3681 | ❌ | |
| **聊天 system prompt 构造**（rooms/cabinets/items 摘要） | 3683-3731 | ❌ | |
| AI 识别 prompt 精度 | 60 行精细指令 | 🟡 | 新版被削减到 24 行，识别覆盖度会下降 |

### 2.14 其他基础能力

| 功能 | 旧版 | 新版 | 备注 |
|---|---|---|---|
| `demo.js` 示例数据 | 389 行 | ❌ | |
| `storage.js` YAML frontmatter / ZIP 打包解包 | 746 行 | ❌ | |
| `scheduleAutoSync` 写操作钩子（600ms debounce 同步） | 3269-3285 | ❌ | 依赖 FSA |
| `IDB handles` 持久化（保存目录句柄） | 3226-3236 / storage.js 564-598 | ❌ | 同上 |
| 全局图片 `onerror` 兜底 SVG 占位 | 4212-4218 | 🟡 | 新版 BlobImage 有基础兜底，但不含 SVG 占位 |
| 底部 tabbar 仅在 storage scene 显示 | 1039-1051 | ✅ | OK |

---

## 3. 优先级分层

### 🔴 P0 — 必须补齐（否则应用无法正常使用）

1. **PhotoDetailPage** 三大交互：AI 识别复跑、手动框选、边框编辑
2. **CabinetDialog** 物品管理中心（5 列网格 + 嵌入式加物品表单）
3. **InboxPage** 分组 + 位置 + 缩略图 + 订阅事件跳转
4. **ItemDialog** 房间+柜子两级下拉 + 自由区虚拟选项 + 来源照片预览 + 删除
5. **RoomsPage** 全屋自由区卡片 + 房间封面 + 菜单（去掉 prompt 反模式）
6. **RoomDetailPage** 自由区入口 + 双按钮（拍照/选图） + 引导横幅
7. **4 个全局 Fab**（至少先做 ✏️ 快速录入 + 🖼️ 选图 scan，💬 AI 对话 + 📷 拍照 可放 P1）
8. **SettingsPage** 数据管理部分：ZIP 导出/导入 + 示例数据加载 + 清空

### 🟡 P1 — 明显差距（影响体验但不阻塞）

9. **AI 对话抽屉**（💬 Fab + 流式 + 重命名采纳卡 + DeepSeek 文本模型）
10. **API 配置弹窗**（OpenRouter/DeepSeek/Claude 三路测试）
11. **文件夹同步**（FSA · bind/auto-sync/unbind）
12. **OverviewPage** 补齐四卡片 + 水平进度条 + 点击跳转
13. **SubscribePage** 分类支出条 + 已暂停分段 + 自定义 emoji + hash 背景色
14. **SubscriptionDialog** autoRenew / startedAt / endAt 字段 + 编辑态"本期已付"
15. **ItemsPage** 改为房间→柜子二级分组视图
16. **AI 识别 prompt 恢复**到 60 行精细版（提升识别覆盖度）

### 🟢 P2 — 细节锦上添花

17. SearchPage 结果跳照片页的选项
18. 全局图片 onerror SVG 占位
19. 使用指南文案
20. 路由 hash 持久化（当前 Router v6 已部分覆盖）
21. 移动端独立工具条

---

## 4. 实施路线图

### 4.1 总体策略

- **core 扩展一部分新服务**（AI chat / FSA sync / ZIP / demo 数据），保持三端可复用。
- **web 端页面全面重写**核心交互（PhotoDetail / Cabinet / Item / Inbox / Rooms / RoomDetail）。
- **共享组件扩充**（FabDock、Drawer、ApiConfigDialog、QuickAddDialog、PhotoEditor）。
- **不动数据模型**（`Item`/`Cabinet`/`Subscription` 已充分），只补 UI + 服务。
- **沿用 B 方案**（新 DB 名 `home-inventory-v2` 已用），用户旧数据不迁。

### 4.2 Batch A — P0 核心体验补齐（阻塞项）

> 工作量预估：~1200-1500 行新增代码，分 6 个子任务，串行执行。

#### A1 · PhotoDetailPage 三大交互 + 柜子弹窗升级
- 新建 `web/src/pages/storage/PhotoEditor.tsx` 子组件，封装 AI 识别 / 手动框选 / 边框编辑三套互斥模式。
- 复用 `core/services/ai.ts` 的 `detectCabinetsAndItems`。
- PhotoEditor 内部 state：`mode: 'view' | 'draw' | 'edit'`，使用 React pointer events + `setPointerCapture`。
- 重写 `CabinetDialog`：5 列物品网格 + 嵌入式 `<form>`（名/数量/备注/保质期/拍照/选图）+ 删除。
- **验收**：照片页能重跑 AI、能手动画新柜子、能选中柜子拖 8 个手柄调整；点柜子能管理内部物品。

#### A2 · InboxPage 重构
- 按房间分组 pending（`Map<roomId, Item[]>`，含 `__global__` 特殊组）。
- 按 kind 分组 events（7 类 × critical/warn/info 颜色）。
- 事件行组件 `<EventRow>`：缩略图 + 位置面包屑 + subtitle + level chip。
- 订阅事件点击 → `SubscriptionDialog`。
- **验收**：与 legacy 视觉基本一致；订阅事件行能点击打开订阅编辑。

#### A3 · ItemDialog 房间+柜子两级下拉 + 来源照片
- 新增 `roomId` state（以 `item.cabinetId → cabinet.roomId` 初始化）。
- `<select roomSel>` onChange 动态刷新 `<select cabSel>`（含 `__room_loose__` / `__global_loose__`）。
- 保存时若选虚拟值，`ensureLooseCabinet(storage, rid)` / `ensureGlobalLooseCabinet(storage)`。
- 新增 `sourcePhoto` lookup + 折叠 `<details>` 显示缩略图 + aiRect overlay（绝对定位矩形）。
- 新增"删除物品"按钮、保质期"清除"按钮。
- 保存按钮文案改为"保存并归位"（仅当 `status === 'pending'`）。
- **验收**：能从 Inbox 点 pending item → 选房间 → 选柜子（或虚拟区）→ 保存后 item status 变 placed。

#### A4 · RoomsPage + RoomDetailPage
- RoomsPage：
  - 新增"全屋自由区"卡片（若 `ensureGlobalLooseCabinet` 存在），显示物品数+pending 徽标。
  - 房间卡片用 `photos.find(p => p.roomId === r.id)` 作封面，fallback emoji。
  - 去掉 `prompt('e/d')`，改为右上三点菜单（用现有 Modal 实现一个 `<RoomMenu>`）。
- RoomDetailPage：
  - 顶部新增引导横幅（仅当 photos.length === 0）。
  - 空态和已有照片两种布局，都要双按钮（📷 capture=environment / 🖼️ 纯 file）。
  - 底部加"📥 自由物品收纳处"入口卡片，点击打开 `<LooseListDialog>` 弹窗。
- 新建 `<LooseListDialog>`（房间级/全屋级共用）：3×4 网格 + 按 pending 优先排序。
- **验收**：RoomsPage 能看到全屋自由区入口；RoomDetailPage 能看到并进入该房间的自由区。

#### A5 · Fab Dock（✏️ 快速录入 + 🖼️ 选图 scan + 📷 拍照 scan）
- 新建 `web/src/components/FabDock.tsx`，固定右下角，按 storage scene 显示。
- 三个按钮都派发逻辑到 `core/services/quickAdd.ts`（新建）和已有 `ai.ts`。
- 快速录入 `<QuickAddDialog>`：
  - `<textarea>` 每行一件，支持 `名称×数量, 备注` 语法。
  - 房间+柜子两级下拉 + 统一 expiry。
  - 批量 `put('items', ...)` + toast。
- 即时识别 scan：
  - 根据 `location.pathname` 推断目标房间（`/room/:id` → 该房间自由区；否则全屋自由区）。
  - 调用 `compressImage + detectCabinetsAndItems + cropItemFromPhoto + put`。
  - 全部入 `status: 'pending'`，badge 刷新由 store 自动。
- 💬 AI 对话 Fab 在 A5 里只占位，A5 不实现抽屉（放 B1）。
- **验收**：右下角能看到三个按钮；快速录入能批量创建；拍照/选图能识别后入 Inbox。

#### A6 · SettingsPage 数据管理（ZIP + 示例 + 清空）
- 扩展 `core/services`：
  - `demo.ts`（移植 legacy `demo.js` 的 3 个示例房间+照片）。
  - `exportZip.ts` / `importZip.ts`（移植 `storage.js` 的 `buildFileTree/parseFileTree/filesToZipBlob/zipBlobToFiles`）。
- SettingsPage 添加 4 个按钮 + 数据统计（含存储 MB 计算 `photos.reduce(... blob.size)`）。
- **验收**：能导出 zip、能导入 zip 覆盖、能加载示例、能清空。

### 4.3 Batch B — P1 体验升级（可选）

> 工作量预估：~800-1000 行，可按子任务独立挑选。

#### B1 · AI 对话抽屉
- `core/services/chat.ts`：`streamChatWithAI(messages, onDelta, abortSignal)` + DeepSeek + OpenRouter + `buildChatSystemPrompt(rooms, cabinets, items)`。
- `web/src/components/ChatDrawer.tsx`：底部 slide-up 抽屉、消息气泡、typing dots、流式写入、重命名卡 + 采纳按钮。
- FabDock 的 💬 按钮打开抽屉。

#### B2 · API 配置弹窗
- `web/src/pages/modals/ApiConfigDialog.tsx`：3 段（OpenRouter / DeepSeek / Claude），各带独立"测试连接"按钮。
- 测试图片生成函数（`makeTestBlob`，移植 legacy 3977-3989）。
- SettingsPage AI 段改为一个"配置 API"按钮，点击打开该弹窗。

#### B3 · 文件夹同步
- `core/storage/fsa.ts`：`saveHandle/loadHandle/ensurePermission` + `buildFileTree/writeTreeToDirectory/readTreeFromDirectory`。
- `core/services/sync.ts`：`SyncState` + `doSyncNow` + `scheduleAutoSync`（debounced 600ms）。
- `useStore` 的 `put/del` 调用后派发 `sync.schedule()`。
- SettingsPage 新增"同步到本地文件夹"段。

#### B4 · OverviewPage 卡片 + 水平进度条
- 四卡片（物品总数/紧急提醒/待归位/月度订阅）。
- 水平房间进度条，点击跳转。
- 过滤 `placed` 物品做统计。

#### B5 · SubscribePage 细节
- 分类支出进度条段。
- 已暂停订阅单独 section（像 legacy 2993-3012）。
- 订阅卡片加 `subColorBg` hash 背景 + 自定义 emoji 输入。
- SubscriptionDialog 补 autoRenew / startedAt / endAt / 编辑态"本期已付"按钮。

#### B6 · ItemsPage 二级分组视图
- 按 room → cabinet 分组，折叠式。
- 新增物品按钮保留。

#### B7 · AI 识别 prompt 恢复精细版
- `core/services/ai.ts` 的 `CABINET_DETECT_PROMPT` 替换回 legacy 99-156 的 60 行完整版。

### 4.4 Batch C — P2（仅视情况补）

- C1 SearchPage 结果跳照片页选项（开关）
- C2 `BlobImage` 加 SVG 占位兜底
- C3 SettingsPage 使用指南
- C4 移动端独立工具条

---

## 5. 任务粒度分解（落地到可执行 PR）

| ID | 任务 | 所属 Batch | 预估行数 | 依赖 |
|---|---|---|---|---|
| A1-1 | 新建 `core/utils/cropItemFromPhoto` 确认导出 | A1 | 20 | — |
| A1-2 | `CabinetDialog` 升级为物品管理中心 | A1 | +150 | — |
| A1-3 | 新建 `PhotoEditor` 组件（三模式） | A1 | +350 | — |
| A1-4 | `PhotoDetailPage` 接入 PhotoEditor + 删除照片 | A1 | +60 | A1-3 |
| A2-1 | `InboxPage` 重构分组 + 事件行组件 | A2 | +200 | — |
| A3-1 | `ItemDialog` 双级下拉 + 虚拟选项 + 来源照片 | A3 | +180 | — |
| A3-2 | `ensureLooseCabinet` 在 store 层包装一次 | A3 | +30 | — |
| A4-1 | `RoomsPage` 加全屋自由区卡片 + 封面 + 菜单 | A4 | +120 | — |
| A4-2 | `RoomDetailPage` 双按钮 + 引导 + 自由区入口 | A4 | +100 | — |
| A4-3 | 新建 `LooseListDialog` | A4 | +100 | — |
| A5-1 | 新建 `FabDock` 组件 | A5 | +80 | — |
| A5-2 | 新建 `QuickAddDialog` | A5 | +180 | — |
| A5-3 | 新建 `core/services/quickAdd.ts` + 接入 scan | A5 | +130 | — |
| A6-1 | 新建 `core/services/demo.ts` | A6 | +250 | — |
| A6-2 | 新建 `core/services/exportZip.ts` + `importZip.ts`（zip impl 用 `fflate` 或保留手写） | A6 | +500 | — |
| A6-3 | `SettingsPage` 数据管理 UI | A6 | +120 | A6-1/A6-2 |
| B1-1 | `core/services/chat.ts` + prompt | B1 | +180 | — |
| B1-2 | `ChatDrawer` 组件 | B1 | +200 | B1-1 |
| B1-3 | 接入 FabDock 的 💬 按钮 | B1 | +20 | B1-2 |
| B2-1 | `ApiConfigDialog` 组件 | B2 | +280 | — |
| B2-2 | SettingsPage 接入配置弹窗 | B2 | +20 | B2-1 |
| B3-1 | `core/storage/fsa.ts` | B3 | +150 | — |
| B3-2 | `core/services/sync.ts` + auto-sync hook | B3 | +80 | B3-1 |
| B3-3 | SettingsPage 同步 UI | B3 | +100 | B3-1 |
| B4 | OverviewPage 卡片 + 进度条 | B4 | +120 | — |
| B5 | SubscribePage 细节 + SubscriptionDialog 补字段 | B5 | +200 | — |
| B6 | ItemsPage 二级分组 | B6 | +150 | — |
| B7 | AI prompt 恢复精细版 | B7 | +100 | — |

**Batch A 总计 ~2370 行；Batch B 总计 ~1600 行。**（含删除的旧代码抵消，实际净增约 60% 左右。）

---

## 6. 文件变更一览

### 6.1 新增文件

```
packages/core/src/services/
├── quickAdd.ts        (A5)    批量文字录入 + 即时扫描入 Inbox
├── chat.ts            (B1)    流式聊天 + DeepSeek + system prompt 构造
├── demo.ts            (A6)    示例数据（移植自 legacy/demo.js）
├── exportZip.ts       (A6)    buildFileTree + filesToZipBlob
├── importZip.ts       (A6)    zipBlobToFiles + parseFileTree
└── sync.ts            (B3)    文件夹自动同步

packages/core/src/storage/
└── fsa.ts             (B3)    File System Access API handle 管理

packages/web/src/components/
├── FabDock.tsx        (A5)    右下角 4 个悬浮按钮
├── ChatDrawer.tsx     (B1)    AI 对话抽屉
└── RoomMenu.tsx       (A4)    房间卡片的 ··· 菜单

packages/web/src/pages/storage/
└── PhotoEditor.tsx    (A1)    AI 识别 / 手动框选 / 边框编辑三模式

packages/web/src/pages/modals/
├── LooseListDialog.tsx (A4)   自由区物品列表弹窗
├── QuickAddDialog.tsx  (A5)   快速文字录入
└── ApiConfigDialog.tsx (B2)   API 配置 + 连通性测试
```

### 6.2 修改文件

```
packages/web/src/pages/
├── storage/PhotoDetailPage.tsx     (A1)  接入 PhotoEditor，删除照片
├── modals/CabinetDialog.tsx        (A1)  升级为物品管理中心
├── modals/ItemDialog.tsx           (A3)  双级下拉 + 虚拟选项 + 来源照片
├── storage/RoomsPage.tsx           (A4)  全屋自由区卡片 + 封面 + 菜单
├── storage/RoomDetailPage.tsx      (A4)  引导 + 双按钮 + 自由区入口
├── InboxPage.tsx                   (A2)  分组 + 位置 + 缩略图
├── OverviewPage.tsx                (B4)  4 卡片 + 进度条
├── SubscribePage.tsx               (B5)  分类条 + 已暂停分段
├── modals/SubscriptionDialog.tsx   (B5)  补字段 + 本期已付
├── storage/ItemsPage.tsx           (B6)  二级分组
└── SettingsPage.tsx                (A6+B2+B3) 数据管理 + API 配置入口 + 同步

packages/web/src/App.tsx             (A5)  挂载 FabDock
packages/web/src/stores/useStore.ts  (B3)  auto-sync hook
packages/core/src/services/ai.ts     (B7)  恢复 60 行精细 prompt
packages/core/src/services/cabinet.ts (A3) 若需要再暴露辅助函数
```

---

## 7. 验收 Checklist

### 7.1 Batch A 验收（核心体验回归）

- [ ] **照片详情页**
  - [ ] 新上传照片自动 AI 识别柜子 + 物品
  - [ ] 已存在照片可以**重新**点"✨ AI 识别"
  - [ ] 能在图上**拖拽绘制**一个新柜子 + 命名
  - [ ] 能点"✏️ 编辑边框"进入编辑模式，选中柜子后拖 8 个手柄调整
  - [ ] 能删除照片（级联删柜子/物品）
- [ ] **柜子弹窗**
  - [ ] 显示该柜子内所有物品（5 列网格、保质期徽标）
  - [ ] 能嵌入式添加新物品（名称 / 数量 / 备注 / 保质期 / 拍照 / 选图）
  - [ ] 能直接删除物品 / 删除整个柜子
- [ ] **待处理页**
  - [ ] pending 物品按房间分组展示
  - [ ] 事件按 kind 分组，带紧急数 chip
  - [ ] 事件行显示物品缩略图 + 位置面包屑（房间 › 柜子）
  - [ ] 订阅事件点击打开 SubscriptionDialog
- [ ] **物品对话框**
  - [ ] 有房间下拉 + 柜子下拉（联动）
  - [ ] 能选"全屋自由区"或"此房间自由区"虚拟项
  - [ ] 对于 AI 识别物品，能展开看来源照片 + 高亮 rect
  - [ ] 对话框内能直接删除物品
  - [ ] 保存后 pending 物品 status 变 placed
- [ ] **房间列表**
  - [ ] 能看到"全屋自由区"大卡片（带物品数、pending 徽标）
  - [ ] 房间卡片显示第一张照片作封面（若无则 emoji）
  - [ ] 能通过 ··· 菜单编辑/删除房间（不是 prompt）
- [ ] **房间详情**
  - [ ] 空态引导横幅
  - [ ] 空态与非空态都有双按钮：📷 拍照 / 🖼️ 选图
  - [ ] 底部"📥 自由物品收纳处"入口能打开该房间的自由区弹窗
- [ ] **全局悬浮按钮**
  - [ ] 右下角看到 ✏️ / 🖼️ / 📷 三个按钮（💬 在 B1 做）
  - [ ] ✏️ 打开快速录入弹窗，能批量入库
  - [ ] 📷 / 🖼️ 能即时识别并入 Inbox
- [ ] **设置**
  - [ ] 能导出 ZIP
  - [ ] 能导入 ZIP（覆盖）
  - [ ] 能加载示例数据
  - [ ] 存储占用 MB 显示正确

### 7.2 Batch B 验收

- [ ] 💬 Fab 打开 AI 对话抽屉，流式输出、能采纳重命名建议
- [ ] API 配置弹窗能独立测试 OpenRouter / DeepSeek / Claude
- [ ] 绑定文件夹后自动同步，SettingsPage 显示最近同步时间
- [ ] OverviewPage 4 卡片（总数/紧急/待归位/订阅）正常
- [ ] SubscribePage 分类支出条 + 已暂停分段 + 自定义 emoji
- [ ] ItemsPage 按房间→柜子分组展示
- [ ] AI 识别覆盖度恢复（比对同一张图的识别物品数）

### 7.3 构建与部署

- [ ] `pnpm typecheck` 绿
- [ ] `pnpm --filter @home-inventory/web build` 绿，产物在 `packages/web/dist`
- [ ] Vercel 部署成功（install 用 `--no-frozen-lockfile`，稳定后改回）
- [ ] 手动冒烟：首屏加载、加载示例数据、上传一张照片跑 AI（需配 key）、加订阅、看 Inbox

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| ZIP 打包移植复杂（legacy 是手写的 DEFLATE） | A6 工期膨胀 | 引入 `fflate`（~9KB gzipped）代替手写 |
| File System Access API 浏览器兼容性（Safari iOS 不支持） | B3 影响范围 | UI 做能力嗅探，不支持时隐藏入口，仅提供 ZIP 方式 |
| PhotoEditor pointer events 在移动端触摸手势冲突 | A1 体验 | 严格 `touch-action: none` + `setPointerCapture`；参考 legacy 74-84 的 `pointer: coarse` 放大手柄 |
| 聊天流 SSE 在某些代理/CDN 被缓冲 | B1 可用性 | 显式 `Accept: text/event-stream`；必要时提供非流式降级 |
| 旧 DB 里有残留但 schema 不一致 | 启动崩溃 | 已用 `home-inventory-v2` 新 DB，用户放弃旧数据 |
| AI prompt 精细版 token 消耗大 | B7 成本 | 保留 toggle，默认精细版，用户可切换简版 |

---

## 9. 时间预估（单人节奏）

- **Batch A（P0 核心）**：6 个子任务，串行 2-3 天（按 8 小时/天计）
- **Batch B（P1 体验）**：7 个子任务，可独立拆分 2-3 天
- **Batch C（P2 细节）**：零散补，0.5 天
- **构建 + 冒烟 + 部署验证**：0.5 天

**总计 ~5-7 个工作日**做到 legacy 1:1。

---

## 10. 执行原则

1. **每完成一个子任务就跑 `pnpm typecheck` + `pnpm build`**，避免积压错误。
2. **严禁破坏现有数据模型**（`Item` / `Cabinet` / `Subscription`），只扩不改。
3. **优先复用 core 能力**，web 端只做 UI 组合。
4. **交互参照 legacy**（旧版 CSS 类名 `photo-stage` / `cabinet-box` / `handle` 等已在新版 `styles/index.css` 保留，直接沿用）。
5. **移动端优先**（Fab / Dialog / Editor 都要覆盖手机触摸）。
6. **每个子任务单独 commit**，commit message 带 `[A1]` `[B3]` 前缀，方便回滚。

---

**文档版本**：v1.0 · 2026-05-10
**维护**：随 Batch 推进滚动更新本文档的验收 Checklist
