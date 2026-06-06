/**
 * 标签视图（TagView）：用户可以保存若干"按标签筛选物品的固定视图"，
 * 比如"旅行必备清单"、"药品急救包"、"换季衣物"。
 *
 * 数据存在 storage 的 'config' store 里，key = TAG_VIEWS_CONFIG_KEY。
 * 不需要新增 store，避免破坏 IndexedDB 升级。
 */

import { getConfig, setConfig } from '../storage/indexeddb';
import type { Storage } from '../storage/types';
import { uid } from '../utils/id';

export type TagViewMode = 'all' | 'any';

export interface TagView {
  id: string;
  name: string;
  /** 单 emoji，做为视图的封面图标 */
  emoji?: string;
  /** 必须命中的标签（mode=all 时全部命中，mode=any 时任意一个命中） */
  tags: string[];
  /** 命中标签的逻辑：all=必须包含全部 / any=包含任意一个，默认 any */
  mode: TagViewMode;
  /** 可选：按物品名称模糊搜索（额外过滤条件） */
  query?: string;
  /** 是否显示已归位之外的物品 */
  includePending?: boolean;
  /** 排序字段，可选 */
  sort?: 'name' | 'recent' | 'created';
  /** 用户为该视图写的简短描述，比如"出门 3 天必备" */
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export const TAG_VIEWS_CONFIG_KEY = 'tagViews';

const DEFAULT_VIEWS: TagView[] = [
  {
    id: 'preset_travel',
    name: '旅行必备清单',
    emoji: '🧳',
    tags: ['旅行', '出行', '行李'],
    mode: 'any',
    sort: 'name',
    note: '出门要带、回家要清点的物品',
    createdAt: 0,
    updatedAt: 0,
  },
];

export async function getTagViews(storage: Storage): Promise<TagView[]> {
  const list = await getConfig<TagView[]>(storage, TAG_VIEWS_CONFIG_KEY, []);
  if (!Array.isArray(list)) return [];
  return list;
}

export async function setTagViews(storage: Storage, views: TagView[]): Promise<void> {
  await setConfig(storage, TAG_VIEWS_CONFIG_KEY, views);
}

export async function ensureDefaultTagViews(storage: Storage): Promise<TagView[]> {
  const existing = await getTagViews(storage);
  if (existing.length > 0) return existing;
  // 第一次进入时给一个示例（旅行必备）
  const seeded = DEFAULT_VIEWS.map((v) => ({ ...v, createdAt: Date.now(), updatedAt: Date.now() }));
  await setTagViews(storage, seeded);
  return seeded;
}

export async function saveTagView(
  storage: Storage,
  draft: Omit<TagView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<TagView> {
  const list = await getTagViews(storage);
  const now = Date.now();
  if (draft.id) {
    const idx = list.findIndex((v) => v.id === draft.id);
    if (idx >= 0) {
      const next: TagView = { ...list[idx], ...draft, id: list[idx].id, updatedAt: now } as TagView;
      list[idx] = next;
      await setTagViews(storage, list);
      return next;
    }
  }
  const created: TagView = {
    id: uid(),
    name: draft.name,
    emoji: draft.emoji,
    tags: draft.tags,
    mode: draft.mode,
    query: draft.query,
    includePending: draft.includePending,
    sort: draft.sort,
    note: draft.note,
    createdAt: now,
    updatedAt: now,
  };
  await setTagViews(storage, [...list, created]);
  return created;
}

export async function deleteTagView(storage: Storage, id: string): Promise<void> {
  const list = await getTagViews(storage);
  await setTagViews(storage, list.filter((v) => v.id !== id));
}

/**
 * 根据视图条件，从物品列表中筛选。
 */
export function applyTagView<T extends { name?: string; tags?: string[]; status?: string }>(
  view: Pick<TagView, 'tags' | 'mode' | 'query' | 'includePending'>,
  items: T[]
): T[] {
  const tags = (view.tags || []).filter(Boolean);
  const q = (view.query || '').trim().toLowerCase();
  return items.filter((item) => {
    if (!view.includePending && item.status === 'pending') return false;
    const itemTags = item.tags || [];
    if (tags.length > 0) {
      if (view.mode === 'all') {
        if (!tags.every((t) => itemTags.includes(t))) return false;
      } else {
        if (!tags.some((t) => itemTags.includes(t))) return false;
      }
    }
    if (q && !(item.name || '').toLowerCase().includes(q)) return false;
    return true;
  });
}
