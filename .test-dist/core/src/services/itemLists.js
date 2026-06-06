"use strict";
/**
 * 物品清单（ItemList）：用户手动维护的物品集合，
 * 例如「旅行必备」「出差包」「急救包」。多对多关系，
 * 一件物品可同时出现在多个清单里。
 *
 * 数据存在 storage 的 'config' store，key = ITEM_LISTS_CONFIG_KEY，
 * 不新增 store 避免破坏 IndexedDB 升级。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ITEM_LISTS_MIGRATED_KEY = exports.ITEM_LISTS_CONFIG_KEY = void 0;
exports.getItemLists = getItemLists;
exports.setItemLists = setItemLists;
exports.createItemList = createItemList;
exports.updateItemList = updateItemList;
exports.deleteItemList = deleteItemList;
exports.addItemsToList = addItemsToList;
exports.removeItemFromList = removeItemFromList;
exports.migrateTagViewsToItemLists = migrateTagViewsToItemLists;
const indexeddb_1 = require("../storage/indexeddb");
const id_1 = require("../utils/id");
exports.ITEM_LISTS_CONFIG_KEY = 'itemLists';
exports.ITEM_LISTS_MIGRATED_KEY = 'tagViews_migrated_v1';
async function getItemLists(storage) {
    const list = await (0, indexeddb_1.getConfig)(storage, exports.ITEM_LISTS_CONFIG_KEY, []);
    if (!Array.isArray(list))
        return [];
    return list;
}
async function setItemLists(storage, lists) {
    await (0, indexeddb_1.setConfig)(storage, exports.ITEM_LISTS_CONFIG_KEY, lists);
}
async function createItemList(storage, draft) {
    const lists = await getItemLists(storage);
    const now = Date.now();
    const created = {
        id: (0, id_1.uid)(),
        name: draft.name,
        emoji: draft.emoji,
        note: draft.note,
        itemIds: Array.from(new Set(draft.itemIds || [])),
        createdAt: now,
        updatedAt: now,
    };
    await setItemLists(storage, [...lists, created]);
    return created;
}
async function updateItemList(storage, id, patch) {
    const lists = await getItemLists(storage);
    const idx = lists.findIndex((l) => l.id === id);
    if (idx < 0)
        return null;
    const next = {
        ...lists[idx],
        ...patch,
        itemIds: patch.itemIds ? Array.from(new Set(patch.itemIds)) : lists[idx].itemIds,
        updatedAt: Date.now(),
    };
    lists[idx] = next;
    await setItemLists(storage, lists);
    return next;
}
async function deleteItemList(storage, id) {
    const lists = await getItemLists(storage);
    await setItemLists(storage, lists.filter((l) => l.id !== id));
}
async function addItemsToList(storage, listId, itemIds) {
    const lists = await getItemLists(storage);
    const idx = lists.findIndex((l) => l.id === listId);
    if (idx < 0)
        return null;
    const merged = Array.from(new Set([...lists[idx].itemIds, ...itemIds]));
    const next = { ...lists[idx], itemIds: merged, updatedAt: Date.now() };
    lists[idx] = next;
    await setItemLists(storage, lists);
    return next;
}
async function removeItemFromList(storage, listId, itemId) {
    const lists = await getItemLists(storage);
    const idx = lists.findIndex((l) => l.id === listId);
    if (idx < 0)
        return null;
    const next = {
        ...lists[idx],
        itemIds: lists[idx].itemIds.filter((id) => id !== itemId),
        updatedAt: Date.now(),
    };
    lists[idx] = next;
    await setItemLists(storage, lists);
    return next;
}
/**
 * 一次性迁移：把旧 TagView 按其规则当下命中的物品转换为 ItemList。
 * 幂等，已迁移过则跳过。
 */
async function migrateTagViewsToItemLists(storage, items, applyTagView) {
    const migrated = await (0, indexeddb_1.getConfig)(storage, exports.ITEM_LISTS_MIGRATED_KEY, false);
    if (migrated)
        return 0;
    const tagViews = await (0, indexeddb_1.getConfig)(storage, 'tagViews', []);
    if (!Array.isArray(tagViews) || tagViews.length === 0) {
        await (0, indexeddb_1.setConfig)(storage, exports.ITEM_LISTS_MIGRATED_KEY, true);
        return 0;
    }
    const existing = await getItemLists(storage);
    const now = Date.now();
    const created = tagViews.map((view) => {
        const matched = applyTagView(view, items);
        const itemIds = matched.map((it) => it.id).filter((id) => !!id);
        return {
            id: view.id || (0, id_1.uid)(),
            name: view.name || '未命名清单',
            emoji: view.emoji || '🧳',
            note: view.note,
            itemIds: Array.from(new Set(itemIds)),
            createdAt: view.createdAt || now,
            updatedAt: now,
        };
    });
    // 合并：若已存在同 id 清单则跳过（用户可能已手动建过）
    const existingIds = new Set(existing.map((l) => l.id));
    const fresh = created.filter((l) => !existingIds.has(l.id));
    await setItemLists(storage, [...existing, ...fresh]);
    await (0, indexeddb_1.setConfig)(storage, exports.ITEM_LISTS_MIGRATED_KEY, true);
    return fresh.length;
}
