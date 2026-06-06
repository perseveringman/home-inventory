# 视图页重构 + AI 路由感知

日期：2026-05-31

## 背景与目标

把现有「标签视图」(TagView) 整体改造为「视图」页，承载三类视图入口：**清单 / 标签 / 收纳柜**。Tab 顺序：[ 清单 ] [ 标签 ] [ 收纳柜 ]。

- **清单**：手动维护的物品集合（如「旅行必备」「出差包」），多对多。
- **标签**：基于 `item.tags` 的多选 chip 即时筛选（任一/全包含切换）。
- **收纳柜**：所有柜子卡片入口，复用现有按柜子分组的物品列表。

同时，让 AI 聊天能感知所有页面，输出 `navigate` action，用户确认后跳转。

## 数据模型

新增类型 `ItemList`（`packages/core/src/models/index.ts`）：

```ts
interface ItemList {
  id: string;
  name: string;
  emoji?: string;
  itemIds: string[];        // 多对多关系存这里
  createdAt: number;
  updatedAt: number;
}
```

新增 store `'lists'`（`packages/core/src/storage/types.ts`）。

**保留** `item.tags: string[]` 与 `PRESET_TAGS`（标签 chip 段需要）。

**删除** `tagViews` store / `tagViews.ts` 服务 / 旧页面，但先做迁移。

## 一次性迁移

启动时检测：若存在旧 TagView 数据且尚未迁移过（用 storage meta key `tagViews_migrated_v1` 标记），则：
1. 读所有旧 TagView。
2. 按其 `mode + tags + keywords` 跑筛选，拿到当下命中的 itemIds。
3. 写入新 `ItemList`，保留 `name/emoji`。
4. 设置 migrated 标记。

旧 store 数据保留不删（避免回滚困难），但前端不再读取。

## 页面结构

### `/views` ListsPage（视图主页）

顶部 segmented control：[ 清单 ] [ 标签 ] [ 收纳柜 ]。
默认 tab 用 URL search param `?tab=lists|tags|cabinets`，无 param 默认 `lists`。

- **清单段**：清单卡片网格（emoji + 名称 + 物品数）+「+ 新建清单」入口。
- **标签段**：模式切换（任一/全包含）+ chip 平铺 + 命中物品网格。chip 数据源是所有 `item.tags` 去重，PRESET_TAGS 排前。
- **收纳柜段**：所有柜子卡片网格，点击 → 现有房间详情页或柜子内部视图。

### `/views/list/:id` ListDetailPage（清单详情）

- 顶部：名称 + 物品数 + 编辑/删除菜单。
- 常驻搜索框（语义搜索 top30，已添加项灰显）+ 麦克风按钮。
- 物品卡网格，每张右上角 `✕`（点击即时移除，无确认）。
- 语音添加流程：
  1. Web Speech API 识别中文 → 文本。
  2. tokenize 拆词 → 每词 semanticSearch top1（带分数阈值）。
  3. 弹确认弹层：勾选要加入的物品，点确认批量入清单。
  4. 未匹配的词丢弃（不创建占位）。

## 路由变更

```
新增：
/views                → ListsPage
/views/list/:id       → ListDetailPage

删除：
/tags                 → TagViewsPage
/tags/:id             → TagViewsPage
```

底部导航 / Tabbar / Scenebar 中所有指向 `/tags` 的入口替换为 `/views`。

## AI 路由感知

### Prompt 注入

`buildChatSystemPrompt()` 追加「页面索引」段：

```
可用页面（输出 navigate action 让用户跳转）：
- /                        房间总览（首页）
- /views?tab=lists         清单总览
- /views?tab=tags          标签筛选
- /views?tab=cabinets      收纳柜总览
- /views/list/{listId}     某个清单详情
- /room/{roomId}           房间详情
- /search                  搜索
- /inbox                   收集箱
- /overview                数据总览
- /subscribe               订阅
- /labels                  二维码标签
- /settings                设置
```

### Facts 上下文扩充

在 `chat.ts` 的系统状态收集里新增：

```
lists: [{ id, name, itemCount }]
```

让 AI 能按名字查 list id。

### 新 action 块

````
```navigate
{ "path": "/views/list/abc123", "reason": "打开你的旅行必备清单" }
```
````

`ChatDrawer` 提取后渲染按钮"打开 → {reason}"，点击 `useNavigate()` 跳转并关闭抽屉。**不自动跳转**，与现有 action 一致需用户确认。

提取函数：`extractNavigateActions(text)` 放在 `aiActions.ts` 旁边。

## 实施顺序

1. 数据层：types + ItemList model + lists store + itemLists service
2. 一次性迁移钩子
3. ListsPage（三段 tab）
4. ListDetailPage（搜索 + 语音 + ✕）
5. 路由替换 + 入口替换
6. AI prompt 注入 + facts 扩充
7. navigate action 提取与渲染
8. 删除 TagViewsPage / tagViews.ts（保留 store 数据）
9. 真机自测

## 不做（YAGNI）

- 撤销移除（误触可重新搜索加回）
- 跨清单导入/合并
- 清单分享链接
- 自动跳转（始终需用户确认）
- 在标签 tab 里给物品加 ✕（这是视图，不是清单）
- 创建占位物品（语音未匹配的词直接丢弃）
