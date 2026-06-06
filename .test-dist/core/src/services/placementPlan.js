"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestPlacementPlan = suggestPlacementPlan;
exports.applyPlacementPlan = applyPlacementPlan;
const models_1 = require("../models");
const cabinet_1 = require("./cabinet");
const actionLog_1 = require("./actionLog");
const KEYWORD_TAGS = [
    { tag: '药品', words: ['药', '片', '胶囊', '创可贴', '布洛芬', '感冒', '退烧'] },
    { tag: '保健品', words: ['维生素', '鱼油', '蛋白粉', '钙片', '益生菌'] },
    { tag: '食品', words: ['米', '面', '饼', '糖', '调料', '酱', '油', '奶', '咖啡', '茶', '零食'] },
    { tag: '饮料', words: ['饮料', '水', '可乐', '果汁', '啤酒', '牛奶', '酸奶'] },
    { tag: '数码', words: ['线', '充电', '耳机', '鼠标', '键盘', '手机', '相机', '硬盘', '电池'] },
    { tag: '家电', words: ['插座', '灯', '遥控', '电源', '转换器'] },
    { tag: '衣物', words: ['衣', '裤', '袜', '帽', '围巾', '被', '床单', '鞋'] },
    { tag: '书籍', words: ['书', '文件', '资料', '绘本'] },
    { tag: '文具', words: ['笔', '本', '纸', '胶带', '剪刀', '订书机', '文件夹'] },
    { tag: '工具', words: ['螺丝', '锤', '钳', '扳手', '刀', '工具'] },
    { tag: '玩具', words: ['玩具', '积木', '娃娃', '拼图'] },
    { tag: '美妆', words: ['口红', '面膜', '护肤', '洗面奶', '香水', '粉底'] },
    { tag: '日用', words: ['纸巾', '清洁', '洗衣', '牙刷', '毛巾', '垃圾袋'] },
    { tag: '厨具', words: ['锅', '碗', '杯', '刀叉', '筷', '盘', '铲', '勺'] },
];
function inferTags(item) {
    const haystack = `${item.name} ${item.note} ${item.aiEmoji || ''}`.toLowerCase();
    const tags = item.tags?.length ? item.tags.slice() : [];
    for (const group of KEYWORD_TAGS) {
        if (group.words.some((word) => haystack.includes(word.toLowerCase())))
            tags.push(group.tag);
    }
    return Array.from(new Set(tags));
}
function scoreCabinet(cabinet, item, tags, allItems) {
    let score = item.roomId === cabinet.roomId ? 3 : 0;
    const text = `${cabinet.name} ${item.name}`.toLowerCase();
    for (const tag of tags) {
        if (text.includes(tag.toLowerCase()))
            score += 5;
    }
    for (const existing of allItems.filter((x) => x.cabinetId === cabinet.id && x.status !== 'pending')) {
        const overlap = (existing.tags || []).filter((tag) => tags.includes(tag)).length;
        score += overlap * 4;
        if (existing.name && item.name && existing.name[0] === item.name[0])
            score += 0.5;
    }
    return score;
}
function suggestPlacementPlan(rooms, cabinets, items, limit = 40) {
    const normalCabinets = cabinets.filter((cabinet) => !cabinet.type || cabinet.type === 'normal');
    const pending = items
        .filter((item) => item.status === 'pending')
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    const suggestions = pending.map((item) => {
        const tags = inferTags(item);
        const best = normalCabinets
            .map((cabinet) => ({ cabinet, score: scoreCabinet(cabinet, item, tags, items) }))
            .sort((a, b) => b.score - a.score)[0];
        const room = rooms.find((r) => r.id === item.roomId);
        if (best && best.score > 2) {
            const targetRoom = rooms.find((r) => r.id === best.cabinet.roomId);
            return {
                itemId: item.id,
                targetRoomId: best.cabinet.roomId,
                targetCabinetId: best.cabinet.id,
                targetLabel: `${targetRoom?.name || '未知房间'} › ${best.cabinet.name}`,
                confidence: Math.min(0.94, 0.48 + best.score / 20),
                reason: tags.length ? `和 ${tags.slice(0, 2).join('/')} 类物品更接近` : '按当前房间和柜名推断',
            };
        }
        if (item.roomId && item.roomId !== models_1.GLOBAL_ROOM_ID) {
            return {
                itemId: item.id,
                targetRoomId: item.roomId,
                targetCabinetId: '__room_loose__',
                targetLabel: `${room?.name || '当前房间'} › 自由区`,
                confidence: 0.45,
                reason: '没有明显同类柜子，先留在当前房间自由区',
            };
        }
        return {
            itemId: item.id,
            targetRoomId: models_1.GLOBAL_ROOM_ID,
            targetCabinetId: '__global_loose__',
            targetLabel: '全屋自由区',
            confidence: 0.38,
            reason: '缺少房间上下文，先放全屋自由区',
        };
    });
    return {
        id: `plan-${Date.now()}`,
        createdAt: Date.now(),
        summary: suggestions.length
            ? `建议归位 ${suggestions.length} 件待处理物品`
            : '当前没有待归位物品',
        suggestions,
    };
}
async function applyPlacementPlan(storage, plan, itemIds) {
    const selected = new Set(itemIds);
    let applied = 0;
    for (const suggestion of plan.suggestions) {
        if (!selected.has(suggestion.itemId))
            continue;
        const item = await storage.get('items', suggestion.itemId);
        if (!item)
            continue;
        let cabinet;
        if (suggestion.targetCabinetId === '__global_loose__') {
            cabinet = await (0, cabinet_1.ensureGlobalLooseCabinet)(storage);
            await storage.put('cabinets', cabinet);
        }
        else if (suggestion.targetCabinetId === '__room_loose__') {
            cabinet = await (0, cabinet_1.ensureLooseCabinet)(storage, suggestion.targetRoomId);
            await storage.put('cabinets', cabinet);
        }
        else {
            cabinet = await storage.get('cabinets', suggestion.targetCabinetId);
        }
        if (!cabinet)
            continue;
        await storage.put('items', {
            ...item,
            cabinetId: cabinet.id,
            roomId: cabinet.roomId,
            status: 'placed',
            reviewStatus: 'accepted',
            confidence: suggestion.confidence,
            aiReason: suggestion.reason,
            lastTouchedAt: Date.now(),
        });
        applied += 1;
    }
    if (applied) {
        await (0, actionLog_1.logAction)(storage, {
            source: 'ai',
            type: 'placement_plan_applied',
            summary: `批量归位 ${applied} 件物品`,
            after: { itemIds },
        });
    }
    return applied;
}
