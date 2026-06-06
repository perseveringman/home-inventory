"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKitchenInventoryItem = isKitchenInventoryItem;
exports.rankKitchenItem = rankKitchenItem;
exports.rankKitchenItems = rankKitchenItems;
exports.suggestKitchenToday = suggestKitchenToday;
exports.suggestKitchenImportFromImage = suggestKitchenImportFromImage;
const models_1 = require("../models");
const indexeddb_1 = require("../storage/indexeddb");
const date_1 = require("../utils/date");
const image_1 = require("../utils/image");
const apiBase_1 = require("./apiBase");
const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';
const FOOD_TAGS = new Set([
    '食品',
    '食物',
    '食材',
    '生鲜',
    '蔬菜',
    '水果',
    '肉禽蛋奶',
    '乳制品',
    '主食',
    '零食',
    '饮料',
    '调料',
    '调味品',
    '冷冻',
    '剩菜',
]);
const NON_FOOD_TAGS = new Set([
    '药品',
    '保健品',
    '数码',
    '家电',
    '衣物',
    '书籍',
    '文具',
    '工具',
    '玩具',
    '美妆',
    '日用',
    '厨具',
]);
const KITCHEN_LOCATION_WORDS = [
    '厨房',
    '冰箱',
    '冷藏',
    '冷冻',
    '橱柜',
    '吊柜',
    '食品柜',
    '零食柜',
    '饮料柜',
    '调料架',
];
const NON_FOOD_NAME_PATTERN = /(玩偶|玩具|公仔|模型|手办|收纳|抽屉|桌面|杂物|书|笔|本子|文件|音箱|耳机|充电|数据线|遥控|衣|裤|袜|鞋|纸巾|毛巾|牙刷|洗发|沐浴|护肤|口红|锅|碗|盘|杯|刀|叉|勺|铲|工具|螺丝|胶带)/;
const FOOD_NAME_PATTERNS = [
    /(番茄|西红柿|土豆|黄瓜|青椒|辣椒|白菜|菠菜|生菜|油麦菜|芹菜|韭菜|西兰花|花菜|蘑菇|香菇|金针菇|洋葱|胡萝卜|茄子|南瓜|冬瓜|豆芽|玉米|葱|姜|蒜|香菜)/,
    /(苹果|香蕉|橙|橘|梨|草莓|葡萄|西瓜|蓝莓|柠檬|牛油果|芒果|桃|猕猴桃)/,
    /(鸡蛋|鸭蛋|鹌鹑蛋|蛋液|牛奶|酸奶|奶酪|芝士|黄油|奶油)/,
    /(鸡胸|鸡腿|鸡翅|鸡肉|牛肉|猪肉|羊肉|肉末|肉片|排骨|培根|火腿|香肠|虾|鱼肉|鱼片|鱼丸|鱼排|鱼柳|三文鱼|鳕鱼|带鱼|鲈鱼|金枪鱼)/,
    /(豆腐|豆干|豆皮|腐竹|毛豆|豆角|豌豆)/,
    /(大米|米饭|小米|糯米|面条|挂面|意面|方便面|米粉|河粉|粉丝|面包|吐司|馒头|包子|饺子|馄饨|年糕|燕麦)/,
    /(酱油|醋|料酒|蚝油|辣椒酱|豆瓣酱|番茄酱|沙拉酱|盐|白糖|冰糖|红糖|胡椒|花椒|孜然|咖喱|味精|鸡精|淀粉|面粉|食用油|花生油|橄榄油|芝麻油|香油)/,
    /(可乐|雪碧|果汁|茶叶|茶包|咖啡|矿泉水|苏打水|啤酒|红酒|饮料)/,
    /(饼干|薯片|巧克力|糖果|坚果|瓜子|花生|零食|罐头|火锅底料|泡菜|咸菜)/,
];
function includesAny(source, words) {
    const text = source.toLowerCase();
    return words.some((word) => text.includes(word.toLowerCase()));
}
function looksLikeFoodName(text) {
    return FOOD_NAME_PATTERNS.some((pattern) => pattern.test(text));
}
function isKitchenInventoryItem(item, rooms = [], cabinets = []) {
    const room = rooms.find((r) => r.id === item.roomId);
    const cabinet = cabinets.find((c) => c.id === item.cabinetId);
    if (item.tags?.some((tag) => FOOD_TAGS.has(tag)))
        return true;
    if (item.tags?.some((tag) => NON_FOOD_TAGS.has(tag)))
        return false;
    const itemText = `${item.name} ${item.note || ''}`;
    const locationText = `${room?.name || ''} ${cabinet?.name || ''}`;
    if (looksLikeFoodName(itemText))
        return true;
    if (NON_FOOD_NAME_PATTERN.test(itemText))
        return false;
    // 位置只能作为辅助信号，不能因为“书房/桌面”里含有“面”这类单字就误判。
    return includesAny(locationText, KITCHEN_LOCATION_WORDS) && looksLikeFoodName(item.name);
}
function openedRemainDays(item, todayMs) {
    if (!item.openedAt || !item.openedShelfDays)
        return undefined;
    const openedMs = new Date(`${item.openedAt}T00:00:00`).getTime();
    if (!Number.isFinite(openedMs))
        return undefined;
    return Number(item.openedShelfDays) - (0, date_1.daysBetween)(openedMs, todayMs);
}
function rankKitchenItem(item, today = new Date()) {
    const signals = [];
    let score = 0;
    const info = (0, date_1.expiryInfo)(item.expiry);
    if (info) {
        if (info.days <= 0)
            score += 120;
        else if (info.days <= 3)
            score += 95;
        else if (info.days <= 7)
            score += 76;
        else if (info.days <= 14)
            score += 56;
        else if (info.days <= 30)
            score += 34;
        if (info.days <= 30)
            signals.push(info.label);
    }
    const todayMs = new Date(today.toISOString().slice(0, 10) + 'T00:00:00').getTime();
    const remain = openedRemainDays(item, todayMs);
    if (remain !== undefined) {
        if (remain < 0)
            score += 100;
        else if (remain <= 3)
            score += 72;
        else if (remain <= 7)
            score += 44;
        if (remain <= 14)
            signals.push(remain < 0 ? `开封超 ${-remain} 天` : `开封后还剩 ${remain} 天`);
    }
    if (item.minStock != null && Number(item.qty || 0) < Number(item.minStock)) {
        score += Number(item.qty || 0) <= 0 ? 18 : 10;
        signals.push(Number(item.qty || 0) <= 0 ? '已用完' : '库存偏低');
    }
    if (item.note && /(剩|半|开封|尽快|待用|熟食|剩菜)/.test(item.note)) {
        score += 24;
        signals.push('备注提示优先处理');
    }
    return {
        item,
        score,
        signals,
        daysLeft: info?.days,
        openedDaysLeft: remain,
    };
}
function rankKitchenItems(items, today = new Date()) {
    return items
        .filter((item) => item.status !== 'pending' && Number(item.qty || 0) > 0)
        .map((item) => rankKitchenItem(item, today))
        .sort((a, b) => b.score - a.score || (b.item.lastTouchedAt || b.item.createdAt) - (a.item.lastTouchedAt || a.item.createdAt));
}
function locationLabel(item, rooms, cabinets) {
    const room = rooms.find((r) => r.id === item.roomId);
    const cabinet = cabinets.find((c) => c.id === item.cabinetId);
    const roomName = item.roomId === models_1.GLOBAL_ROOM_ID ? '全屋' : room?.name || '未知房间';
    return `${roomName}${cabinet?.name ? `/${cabinet.name}` : ''}`;
}
function compactKitchenLine(rank, rooms, cabinets) {
    const item = rank.item;
    const parts = [
        `id=${item.id}`,
        `name=${item.name}`,
        `qty=${item.qty}`,
        item.tags?.length ? `tags=${item.tags.join('/')}` : '',
        item.expiry ? `expiry=${item.expiry}` : '',
        item.openedAt ? `openedAt=${item.openedAt}` : '',
        item.openedShelfDays ? `openedShelfDays=${item.openedShelfDays}` : '',
        rank.signals.length ? `signals=${rank.signals.join('、')}` : '',
        `location=${locationLabel(item, rooms, cabinets)}`,
        item.note ? `note=${item.note.slice(0, 36)}` : '',
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
}
function buildTodaySuggestionPrompt(input, ranked) {
    const today = input.today || new Date().toISOString().slice(0, 10);
    const pantry = ranked.slice(0, 80).map((rank) => compactKitchenLine(rank, input.rooms, input.cabinets)).join('\n');
    return `你是一个只服务独居/小家庭日常做饭的厨房库存助手。请基于库存、保质期和开封状态，推荐今天优先使用的食材和菜名。

今天：${today}
用户偏好：${input.preferences?.trim() || '无'}

库存清单（优先级已按临期/开封/低库存粗排）：
${pantry || '（空）'}

任务：
1. 选出今天最该优先处理的 3-8 个食材。
2. 推荐 3-5 个“菜名/吃法名”，不要输出详细菜谱步骤。
3. 不要依赖菜谱库，不要编造用户没有的大量食材。
4. 允许列出少量可选缺失项，但 missingItems 每道最多 2 个，并且尽量是葱姜蒜、青菜、主食这类常见补充。
5. 过期很久或明确可能不安全的食材不要推荐食用；可以在 reason 里提醒先确认状态。
6. 返回的 focusItemIds 必须来自库存清单里的 id。

只返回 JSON，不要 Markdown，不要解释：
{
  "summary": "今天建议先处理...",
  "priorityItemIds": ["item_id"],
  "ingredientNames": ["番茄", "鸡蛋"],
  "dishes": [
    {
      "name": "番茄炒蛋",
      "focusItemIds": ["item_id"],
      "focusItems": ["番茄", "鸡蛋"],
      "optionalItems": ["葱"],
      "missingItems": [],
      "reason": "番茄快到期，鸡蛋好搭配",
      "timeEstimate": "15 分钟",
      "confidence": 0.86
    }
  ]
}`;
}
async function callOpenAiCompat(provider, url, apiKey, model, messages) {
    const effectiveKey = apiKey || (0, apiBase_1.getUserApiKey)(provider) || undefined;
    const res = await fetch(effectiveKey ? url : (0, apiBase_1.apiUrl)(`/api/ai/${provider}`), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : (0, apiBase_1.apiAuthHeaders)()),
        },
        body: JSON.stringify({
            model,
            messages,
            ...(provider === 'minimax' ? { max_completion_tokens: 1600, reasoning_split: true } : { max_tokens: 1600 }),
            temperature: 0.35,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`厨房 AI 失败 (${res.status})：${err.slice(0, 180)}`);
    }
    const data = await res.json();
    if (data.error)
        throw new Error(data.error.message || '厨房 AI 返回错误');
    return data.choices?.[0]?.message?.content || '';
}
async function callVisionCompat(provider, url, model, blob, prompt) {
    const base64 = await (0, image_1.fileToBase64)(blob);
    const mediaType = blob.type || 'image/jpeg';
    return callOpenAiCompat(provider, url, undefined, model, [
        {
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
            ],
        },
    ]);
}
function parseJson(text) {
    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (objectMatch)
        return JSON.parse(objectMatch[0]);
    if (arrayMatch)
        return JSON.parse(arrayMatch[0]);
    throw new Error('AI 返回格式异常');
}
function text(value, max = 80) {
    const result = String(value || '').trim();
    return result ? result.slice(0, max) : undefined;
}
function date(value) {
    const result = text(value, 10);
    return result && /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : undefined;
}
function positiveNumber(value, max) {
    if (value == null || value === '')
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.round(parsed * 10) / 10) : undefined;
}
function nullablePositiveInteger(value, max) {
    if (value === null)
        return null;
    const parsed = positiveNumber(value, max);
    return parsed == null ? undefined : Math.round(parsed);
}
function money(value) {
    if (value === null)
        return null;
    if (value == null || value === '')
        return undefined;
    const parsed = Number(String(value).replace(/[¥￥,\s]/g, ''));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : undefined;
}
function rect(value) {
    const obj = (value && typeof value === 'object' ? value : {});
    let x = Number(obj.x);
    let y = Number(obj.y);
    let w = Number(obj.w);
    let h = Number(obj.h);
    if (![x, y, w, h].every(Number.isFinite))
        return undefined;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    w = Math.max(0.02, Math.min(1, w));
    h = Math.max(0.02, Math.min(1, h));
    if (x + w > 1)
        w = 1 - x;
    if (y + h > 1)
        h = 1 - y;
    return w > 0.02 && h > 0.02 ? { x, y, w, h } : undefined;
}
function stringList(value, maxItems = 8, maxLen = 40) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    return value
        .map((entry) => text(entry, maxLen))
        .filter((entry) => !!entry)
        .filter((entry) => {
        if (seen.has(entry))
            return false;
        seen.add(entry);
        return true;
    })
        .slice(0, maxItems);
}
function clampConfidence(value, fallback = 0.72) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(0.1, Math.min(1, parsed));
}
function sanitizeTodaySuggestion(raw, ranked, mode) {
    const obj = (raw && typeof raw === 'object' ? raw : {});
    const itemIds = new Set(ranked.map((rank) => rank.item.id));
    const priorityItemIds = stringList(obj.priorityItemIds, 8, 80).filter((id) => itemIds.has(id));
    const dishesRaw = Array.isArray(obj.dishes) ? obj.dishes : [];
    const dishes = dishesRaw
        .map((entry) => {
        const dish = (entry && typeof entry === 'object' ? entry : {});
        const name = text(dish.name, 40);
        if (!name)
            return null;
        const focusItemIds = stringList(dish.focusItemIds, 8, 80).filter((id) => itemIds.has(id));
        const focusItems = stringList(dish.focusItems, 8, 24);
        return {
            name,
            focusItemIds,
            focusItems: focusItems.length
                ? focusItems
                : focusItemIds.map((id) => ranked.find((rank) => rank.item.id === id)?.item.name).filter((value) => !!value),
            optionalItems: stringList(dish.optionalItems, 4, 24),
            missingItems: stringList(dish.missingItems, 2, 24),
            reason: text(dish.reason, 90) || '优先使用当前库存',
            timeEstimate: text(dish.timeEstimate, 16),
            confidence: clampConfidence(dish.confidence),
        };
    })
        .filter((entry) => !!entry)
        .slice(0, 5);
    return {
        mode,
        summary: text(obj.summary, 120) || (priorityItemIds.length ? '今天优先处理临期和已开封食材。' : '当前没有明显需要优先处理的食材。'),
        priorityItemIds,
        ingredientNames: stringList(obj.ingredientNames, 10, 24),
        dishes,
    };
}
function foodKind(name) {
    if (/(鸡蛋|鸭蛋|蛋)/.test(name))
        return 'egg';
    if (/(鸡|牛|猪|肉|鱼|虾|排骨|培根|火腿|腊肠|香肠)/.test(name))
        return 'protein';
    if (/(米饭|米|面|面条|粉|饼|馒头|吐司|面包)/.test(name))
        return 'carb';
    if (/(青菜|白菜|菠菜|生菜|油麦|芹菜|番茄|西红柿|土豆|蘑菇|菌|青椒|辣椒|黄瓜|胡萝卜|洋葱|西兰花|豆芽|茄子|笋)/.test(name))
        return 'veg';
    if (/(豆腐|豆干|腐竹|豆皮)/.test(name))
        return 'tofu';
    return 'other';
}
function firstByKind(ranked, kind) {
    return ranked.find((rank) => foodKind(rank.item.name) === kind);
}
function localTodaySuggestion(ranked) {
    const top = ranked.slice(0, 8);
    if (!top.length) {
        return {
            mode: 'local',
            summary: '还没有可用于推荐的厨房库存，先录入今天看到的食材。',
            priorityItemIds: [],
            ingredientNames: [],
            dishes: [],
        };
    }
    const egg = firstByKind(top, 'egg');
    const protein = firstByKind(top, 'protein');
    const veg = firstByKind(top, 'veg');
    const tofu = firstByKind(top, 'tofu');
    const carb = firstByKind(top, 'carb');
    const dishes = [];
    const addDish = (name, ranks, optionalItems = [], missingItems = []) => {
        const used = ranks.filter((rank) => !!rank);
        if (!used.length || dishes.some((dish) => dish.name === name))
            return;
        dishes.push({
            name,
            focusItemIds: used.map((rank) => rank.item.id),
            focusItems: used.map((rank) => rank.item.name),
            optionalItems,
            missingItems,
            reason: used.flatMap((rank) => rank.signals).slice(0, 2).join('，') || '优先使用当前库存',
            timeEstimate: '15-25 分钟',
            confidence: 0.66,
        });
    };
    if (egg && veg && /番茄|西红柿/.test(veg.item.name))
        addDish('番茄炒蛋', [veg, egg], ['葱']);
    if (protein && veg)
        addDish(`${protein.item.name}炒${veg.item.name}`, [protein, veg], ['蒜', '酱油']);
    if (egg && veg)
        addDish(`${veg.item.name}炒蛋`, [veg, egg], ['葱']);
    if (tofu)
        addDish('家常豆腐', [tofu, veg], ['蒜'], ['青椒']);
    if (veg)
        addDish(`清炒${veg.item.name}`, [veg], ['蒜']);
    if (carb && (protein || veg || egg))
        addDish(`${carb.item.name}快手炒饭`, [carb, protein || veg || egg], ['葱']);
    addDish(`${top.slice(0, 3).map((rank) => rank.item.name).join('、')}今日优先处理`, top.slice(0, 3), []);
    return {
        mode: 'local',
        summary: `今天优先看 ${top.slice(0, 3).map((rank) => rank.item.name).join('、')}。`,
        priorityItemIds: top.slice(0, 8).map((rank) => rank.item.id),
        ingredientNames: top.slice(0, 8).map((rank) => rank.item.name),
        dishes: dishes.slice(0, 5),
    };
}
async function suggestKitchenToday(storage, input) {
    const ranked = rankKitchenItems(input.items);
    if (!ranked.length)
        return localTodaySuggestion(ranked);
    const prompt = buildTodaySuggestionPrompt(input, ranked);
    try {
        const result = await callOpenAiCompat('deepseek', DEEPSEEK_API, undefined, (await (0, indexeddb_1.getConfig)(storage, 'deepseekModel', '')) || undefined, [{ role: 'user', content: prompt }]);
        const suggestion = sanitizeTodaySuggestion(parseJson(result), ranked, 'ai');
        if (suggestion.dishes.length)
            return suggestion;
    }
    catch (err) {
        console.warn('DeepSeek kitchen suggestion failed, fallback:', err);
    }
    try {
        const result = await callOpenAiCompat('minimax', MINIMAX_API, undefined, (await (0, indexeddb_1.getConfig)(storage, 'minimaxModel', '')) || DEFAULT_MINIMAX_MODEL, [{ role: 'user', content: prompt }]);
        const suggestion = sanitizeTodaySuggestion(parseJson(result), ranked, 'ai');
        if (suggestion.dishes.length)
            return suggestion;
    }
    catch (err) {
        console.warn('MiniMax kitchen suggestion failed, fallback:', err);
    }
    return localTodaySuggestion(ranked);
}
function buildKitchenImportPrompt() {
    return `你是厨房库存导入助手。请从图片中识别食材、调料、饮料、零食或剩菜，并把电商/买菜订单里的商品信息结构化。

图片可能是：
1. 冰箱/橱柜/调料架照片；
2. 生鲜或外卖购物截图；
3. 超市订单、收据、小票、备忘录截图；
4. 手写或印刷的食材清单。

请提取能进入家庭厨房库存的项目。不要识别厨具、包装袋噪声、优惠券、店名、退款提示、按钮文案。

对订单截图：
- name：商品名，去掉“秒杀”“空运直达”等营销词，但保留核心品名和规格关键信息。
- qty：购买数量，优先读取“数量：1”这类字段。
- paidPrice：该商品右侧或附近的“实付 ¥xx.xx”，是这一行商品的实付总价，不要用退款金额。
- unitPrice：读取“单价：¥xx/盒”这类字段，没有就省略。
- spec：读取“规格：450g”“1L”“约500g”等。
- productionDate：只有截图明确写出生产日期时返回 yyyy-mm-dd；如“26年5月29日”在今天为 2026 年时应写 "2026-05-29"。
- imageRect：商品缩略图/实物图在整张截图中的归一化边界框，格式 {"x":0~1,"y":0~1,"w":0~1,"h":0~1}，用于裁出物品图片。
- tags：请按品类打标签，优先从这些标签选择 1-3 个：食品、食材、生鲜、肉禽蛋奶、蔬菜、水果、主食、乳制品、饮料、零食、调味品、冷冻。

保质期/到期日只有图片明确写出时才返回，不要估算。数量不确定时 qty=1。

只返回 JSON，不要 Markdown：
{
  "items": [
    {
      "name": "潭牛冷鲜文昌鸡半只切块 450g",
      "qty": 1,
      "unit": "盒",
      "spec": "450g",
      "paidPrice": 36.51,
      "unitPrice": 38.9,
      "tags": ["生鲜", "肉禽蛋奶"],
      "expiry": "2026-06-12",
      "productionDate": "2026-05-29",
      "openedShelfDays": null,
      "minStock": 2,
      "note": "订单截图导入",
      "imageRect": {"x":0.07,"y":0.30,"w":0.13,"h":0.08},
      "confidence": 0.82
    }
  ]
}`;
}
function inferImportTags(name) {
    const tags = [];
    if (/(鸡|鸭|牛|猪|羊|肉|鱼|虾|蟹|蛋|排骨|文昌鸡)/.test(name))
        tags.push('生鲜', '肉禽蛋奶');
    if (/(番茄|土豆|黄瓜|青椒|辣椒|菜|蘑菇|洋葱|胡萝卜|西兰花|葱|姜|蒜)/.test(name))
        tags.push('蔬菜');
    if (/(葡萄|苹果|香蕉|橙|梨|草莓|西瓜|蓝莓|柠檬|椰子)/.test(name))
        tags.push('水果');
    if (/(牛奶|酸奶|奶酪|芝士|黄油|奶油)/.test(name))
        tags.push('乳制品');
    if (/(椰子水|水|可乐|雪碧|果汁|茶|咖啡|饮料|啤酒)/.test(name))
        tags.push('饮料');
    if (/(米|面|粉|馒头|包子|饺子|吐司|面包|燕麦)/.test(name))
        tags.push('主食');
    if (/(酱油|醋|料酒|蚝油|酱|盐|糖|胡椒|花椒|孜然|咖喱|淀粉|食用油|香油)/.test(name))
        tags.push('调味品');
    if (/(冷冻|冻|冰鲜|冷鲜)/.test(name))
        tags.push('冷冻');
    if (!tags.length)
        tags.push('食品');
    return Array.from(new Set(tags));
}
function normalizeImportTags(name, rawTags) {
    const tags = [...rawTags, ...inferImportTags(name)].map((tag) => (tag === '调料' ? '调味品' : tag));
    const seen = new Set();
    return tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .filter((tag) => {
        if (seen.has(tag))
            return false;
        seen.add(tag);
        return true;
    })
        .slice(0, 4);
}
function sanitizeImportDraft(raw) {
    const obj = (raw && typeof raw === 'object' ? raw : {});
    const name = text(obj.name, 60);
    if (!name)
        return null;
    const tags = normalizeImportTags(name, stringList(obj.tags, 4, 12));
    return {
        name,
        qty: positiveNumber(obj.qty, 999) || 1,
        unit: text(obj.unit, 12),
        spec: text(obj.spec, 40),
        paidPrice: money(obj.paidPrice),
        unitPrice: money(obj.unitPrice),
        tags: tags.length ? tags : inferImportTags(name),
        expiry: date(obj.expiry),
        productionDate: date(obj.productionDate),
        openedShelfDays: nullablePositiveInteger(obj.openedShelfDays, 3650),
        minStock: nullablePositiveInteger(obj.minStock, 999),
        note: text(obj.note, 120),
        imageRect: rect(obj.imageRect),
        confidence: clampConfidence(obj.confidence, 0.65),
    };
}
function sanitizeImportResult(raw) {
    const source = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray(raw.items)
            ? raw.items
            : [];
    const seen = new Set();
    return source
        .map(sanitizeImportDraft)
        .filter((draft) => !!draft)
        .filter((draft) => {
        const key = draft.name.toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    })
        .slice(0, 30);
}
async function suggestKitchenImportFromImage(storage, blob) {
    const prompt = buildKitchenImportPrompt();
    try {
        const result = await callVisionCompat('minimax', MINIMAX_API, (await (0, indexeddb_1.getConfig)(storage, 'minimaxModel', '')) || DEFAULT_MINIMAX_MODEL, blob, prompt);
        const drafts = sanitizeImportResult(parseJson(result));
        if (drafts.length)
            return drafts;
    }
    catch (err) {
        console.warn('MiniMax kitchen image import failed, fallback:', err);
    }
    const result = await callVisionCompat('openrouter', OPENROUTER_API, (await (0, indexeddb_1.getConfig)(storage, 'openrouterModel', '')) || undefined, blob, prompt);
    return sanitizeImportResult(parseJson(result));
}
