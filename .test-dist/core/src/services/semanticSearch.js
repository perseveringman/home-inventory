"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticSearchInventory = semanticSearchInventory;
const SYNONYMS = {
    转换头: ['转接头', 'adapter', '插头', '转换器'],
    转接头: ['转换头', 'adapter', '插头', '转换器'],
    数据线: ['线缆', '充电线', '线', 'cable'],
    药: ['药品', '片', '胶囊', '创可贴'],
    药品: ['药', '片', '胶囊', '创可贴'],
    白色: ['white', '白'],
    黑色: ['black', '黑'],
    说明书: ['manual', '手册'],
    发票: ['收据', 'receipt', '小票'],
    保修: ['warranty', '质保'],
};
function tokenize(input) {
    const compact = input
        .trim()
        .toLowerCase()
        .replace(/[，。？！、,.?!;；:："'“”‘’()[\]{}]/g, ' ');
    const ascii = compact.match(/[a-z0-9]+/g) || [];
    const cjk = compact
        .replace(/[a-z0-9\s]/g, '')
        .split(/\s*/)
        .filter(Boolean);
    const words = compact.split(/\s+/).filter((x) => x.length > 1);
    return Array.from(new Set([...words, ...ascii, ...cjk]));
}
function expandTokens(tokens) {
    const expanded = new Set(tokens);
    for (const token of tokens) {
        for (const [key, vals] of Object.entries(SYNONYMS)) {
            if (token.includes(key) || key.includes(token)) {
                expanded.add(key);
                vals.forEach((val) => expanded.add(val.toLowerCase()));
            }
        }
    }
    return Array.from(expanded);
}
function itemText(item, room, cabinet) {
    return [
        item.name,
        item.note,
        item.tags?.join(' '),
        item.aiEmoji,
        item.brand,
        item.modelNumber,
        item.serialNumber,
        item.manualUrl,
        item.receiptNote,
        room?.name,
        cabinet?.name,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}
function semanticSearchInventory(query, rooms, cabinets, items, photos, limit = 30) {
    const rawTokens = tokenize(query);
    const tokens = expandTokens(rawTokens);
    if (!tokens.length)
        return [];
    const results = [];
    for (const item of items) {
        const cabinet = cabinets.find((c) => c.id === item.cabinetId);
        const room = rooms.find((r) => r.id === item.roomId || r.id === cabinet?.roomId);
        const photo = item.sourcePhotoId ? photos.find((p) => p.id === item.sourcePhotoId) : undefined;
        const text = itemText(item, room, cabinet);
        let score = 0;
        const matched = [];
        for (const token of tokens) {
            if (!token)
                continue;
            if (text.includes(token)) {
                score += rawTokens.includes(token) ? 3 : 1.5;
                matched.push(token);
            }
        }
        if (item.name.toLowerCase().includes(query.trim().toLowerCase()))
            score += 8;
        if (item.tags?.some((tag) => query.includes(tag)))
            score += 4;
        if (item.status === 'placed')
            score += 0.5;
        if (score > 0) {
            results.push({
                item,
                room,
                cabinet,
                photo,
                score,
                matched: Array.from(new Set(matched)).slice(0, 6),
                reason: matched.length
                    ? `命中 ${Array.from(new Set(matched)).slice(0, 3).join('、')}`
                    : '名称或标签接近',
            });
        }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
