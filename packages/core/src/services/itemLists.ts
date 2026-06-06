/**
 * 物品清单（ItemList）：用户手动维护的物品集合，
 * 例如「旅行必备」「出差包」「急救包」。多对多关系，
 * 一件物品可同时出现在多个清单里。
 *
 * 数据存在 storage 的 'config' store，key = ITEM_LISTS_CONFIG_KEY，
 * 不新增 store 避免破坏 IndexedDB 升级。
 */

import type { ItemList } from '../models';
import { getConfig, setConfig } from '../storage/indexeddb';
import type { Storage } from '../storage/types';
import { uid } from '../utils/id';

export const ITEM_LISTS_CONFIG_KEY = 'itemLists';
export const ITEM_LISTS_MIGRATED_KEY = 'tagViews_migrated_v1';

export async function getItemLists(storage: Storage): Promise<ItemList[]> {
  const list = await getConfig<ItemList[]>(storage, ITEM_LISTS_CONFIG_KEY, []);
  if (!Array.isArray(list)) return [];
  return list;
}

export async function setItemLists(storage: Storage, lists: ItemList[]): Promise<void> {
  await setConfig(storage, ITEM_LISTS_CONFIG_KEY, lists);
}

export async function createItemList(
  storage: Storage,
  draft: { name: string; emoji?: string; note?: string; itemIds?: string[] }
): Promise<ItemList> {
  const lists = await getItemLists(storage);
  const now = Date.now();
  const created: ItemList = {
    id: uid(),
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

export async function updateItemList(
  storage: Storage,
  id: string,
  patch: Partial<Pick<ItemList, 'name' | 'emoji' | 'note' | 'itemIds'>>
): Promise<ItemList | null> {
  const lists = await getItemLists(storage);
  const idx = lists.findIndex((l) => l.id === id);
  if (idx < 0) return null;
  const next: ItemList = {
    ...lists[idx],
    ...patch,
    itemIds: patch.itemIds ? Array.from(new Set(patch.itemIds)) : lists[idx].itemIds,
    updatedAt: Date.now(),
  };
  lists[idx] = next;
  await setItemLists(storage, lists);
  return next;
}

export async function deleteItemList(storage: Storage, id: string): Promise<void> {
  const lists = await getItemLists(storage);
  await setItemLists(storage, lists.filter((l) => l.id !== id));
}

export async function addItemsToList(
  storage: Storage,
  listId: string,
  itemIds: string[]
): Promise<ItemList | null> {
  const lists = await getItemLists(storage);
  const idx = lists.findIndex((l) => l.id === listId);
  if (idx < 0) return null;
  const merged = Array.from(new Set([...lists[idx].itemIds, ...itemIds]));
  const next: ItemList = { ...lists[idx], itemIds: merged, updatedAt: Date.now() };
  lists[idx] = next;
  await setItemLists(storage, lists);
  return next;
}

export async function removeItemFromList(
  storage: Storage,
  listId: string,
  itemId: string
): Promise<ItemList | null> {
  const lists = await getItemLists(storage);
  const idx = lists.findIndex((l) => l.id === listId);
  if (idx < 0) return null;
  const next: ItemList = {
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
export async function migrateTagViewsToItemLists<
  T extends { id?: string; name?: string; tags?: string[] }
>(
  storage: Storage,
  items: T[],
  applyTagView: (view: any, items: T[]) => T[]
): Promise<number> {
  const migrated = await getConfig<boolean>(storage, ITEM_LISTS_MIGRATED_KEY, false);
  if (migrated) return 0;
  const tagViews = await getConfig<any[]>(storage, 'tagViews', []);
  if (!Array.isArray(tagViews) || tagViews.length === 0) {
    await setConfig(storage, ITEM_LISTS_MIGRATED_KEY, true);
    return 0;
  }
  const existing = await getItemLists(storage);
  const now = Date.now();
  const created: ItemList[] = tagViews.map((view) => {
    const matched = applyTagView(view, items);
    const itemIds = matched.map((it) => it.id).filter((id): id is string => !!id);
    return {
      id: view.id || uid(),
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
  await setConfig(storage, ITEM_LISTS_MIGRATED_KEY, true);
  return fresh.length;
}
