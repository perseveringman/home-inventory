"use strict";
/**
 * 标签视图（TagView）：用户可以保存若干"按标签筛选物品的固定视图"，
 * 比如"旅行必备清单"、"药品急救包"、"换季衣物"。
 *
 * 数据存在 storage 的 'config' store 里，key = TAG_VIEWS_CONFIG_KEY。
 * 不需要新增 store，避免破坏 IndexedDB 升级。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAG_VIEWS_CONFIG_KEY = void 0;
exports.getTagViews = getTagViews;
exports.setTagViews = setTagViews;
exports.ensureDefaultTagViews = ensureDefaultTagViews;
exports.saveTagView = saveTagView;
exports.deleteTagView = deleteTagView;
exports.applyTagView = applyTagView;
const indexeddb_1 = require("../storage/indexeddb");
const id_1 = require("../utils/id");
exports.TAG_VIEWS_CONFIG_KEY = 'tagViews';
const DEFAULT_VIEWS = [
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
async function getTagViews(storage) {
    const list = await (0, indexeddb_1.getConfig)(storage, exports.TAG_VIEWS_CONFIG_KEY, []);
    if (!Array.isArray(list))
        return [];
    return list;
}
async function setTagViews(storage, views) {
    await (0, indexeddb_1.setConfig)(storage, exports.TAG_VIEWS_CONFIG_KEY, views);
}
async function ensureDefaultTagViews(storage) {
    const existing = await getTagViews(storage);
    if (existing.length > 0)
        return existing;
    // 第一次进入时给一个示例（旅行必备）
    const seeded = DEFAULT_VIEWS.map((v) => ({ ...v, createdAt: Date.now(), updatedAt: Date.now() }));
    await setTagViews(storage, seeded);
    return seeded;
}
async function saveTagView(storage, draft) {
    const list = await getTagViews(storage);
    const now = Date.now();
    if (draft.id) {
        const idx = list.findIndex((v) => v.id === draft.id);
        if (idx >= 0) {
            const next = { ...list[idx], ...draft, id: list[idx].id, updatedAt: now };
            list[idx] = next;
            await setTagViews(storage, list);
            return next;
        }
    }
    const created = {
        id: (0, id_1.uid)(),
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
async function deleteTagView(storage, id) {
    const list = await getTagViews(storage);
    await setTagViews(storage, list.filter((v) => v.id !== id));
}
/**
 * 根据视图条件，从物品列表中筛选。
 */
function applyTagView(view, items) {
    const tags = (view.tags || []).filter(Boolean);
    const q = (view.query || '').trim().toLowerCase();
    return items.filter((item) => {
        if (!view.includePending && item.status === 'pending')
            return false;
        const itemTags = item.tags || [];
        if (tags.length > 0) {
            if (view.mode === 'all') {
                if (!tags.every((t) => itemTags.includes(t)))
                    return false;
            }
            else {
                if (!tags.some((t) => itemTags.includes(t)))
                    return false;
            }
        }
        if (q && !(item.name || '').toLowerCase().includes(q))
            return false;
        return true;
    });
}
