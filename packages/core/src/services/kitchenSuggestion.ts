import type { Cabinet, Item, Room } from '../models';
import { GLOBAL_ROOM_ID } from '../models';
import { getConfig } from '../storage/indexeddb';
import type { Storage } from '../storage/types';
import { daysBetween, expiryInfo } from '../utils/date';
import { fileToBase64 } from '../utils/image';
import { apiAuthHeaders, apiUrl, getUserApiKey } from './apiBase';

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';

export type KitchenSuggestionMode = 'ai' | 'local';

export interface KitchenRankedItem {
  item: Item;
  score: number;
  signals: string[];
  daysLeft?: number;
  openedDaysLeft?: number;
}

export interface KitchenDishSuggestion {
  name: string;
  focusItemIds: string[];
  focusItems: string[];
  optionalItems: string[];
  missingItems: string[];
  reason: string;
  timeEstimate?: string;
  confidence: number;
}

export interface KitchenTodaySuggestion {
  mode: KitchenSuggestionMode;
  summary: string;
  priorityItemIds: string[];
  ingredientNames: string[];
  dishes: KitchenDishSuggestion[];
}

export interface KitchenImportDraft {
  name: string;
  qty: number;
  unit?: string;
  spec?: string;
  paidPrice?: number | null;
  unitPrice?: number | null;
  tags: string[];
  expiry?: string;
  productionDate?: string;
  openedShelfDays?: number | null;
  minStock?: number | null;
  note?: string;
  imageRect?: { x: number; y: number; w: number; h: number };
  confidence?: number;
}

interface KitchenSuggestionInput {
  items: Item[];
  rooms: Room[];
  cabinets: Cabinet[];
  today?: string;
  preferences?: string;
}

interface ImageSize {
  width: number;
  height: number;
}

interface ImageChunk {
  blob: Blob;
  offsetY: number;
  height: number;
}

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
const NON_FOOD_NAME_PATTERN =
  /(玩偶|玩具|公仔|模型|手办|收纳|抽屉|桌面|杂物|书|笔|本子|文件|音箱|耳机|充电|数据线|遥控|衣|裤|袜|鞋|纸巾|毛巾|牙刷|洗发|沐浴|护肤|口红|锅|碗|盘|杯|刀|叉|勺|铲|工具|螺丝|胶带)/;
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

function includesAny(source: string, words: string[]) {
  const text = source.toLowerCase();
  return words.some((word) => text.includes(word.toLowerCase()));
}

function looksLikeFoodName(text: string): boolean {
  return FOOD_NAME_PATTERNS.some((pattern) => pattern.test(text));
}

export function isKitchenInventoryItem(item: Item, rooms: Room[] = [], cabinets: Cabinet[] = []): boolean {
  const room = rooms.find((r) => r.id === item.roomId);
  const cabinet = cabinets.find((c) => c.id === item.cabinetId);
  if (item.tags?.some((tag) => FOOD_TAGS.has(tag))) return true;
  if (item.tags?.some((tag) => NON_FOOD_TAGS.has(tag))) return false;

  const itemText = `${item.name} ${item.note || ''}`;
  const locationText = `${room?.name || ''} ${cabinet?.name || ''}`;
  if (looksLikeFoodName(itemText)) return true;
  if (NON_FOOD_NAME_PATTERN.test(itemText)) return false;

  // 位置只能作为辅助信号，不能因为“书房/桌面”里含有“面”这类单字就误判。
  return includesAny(locationText, KITCHEN_LOCATION_WORDS) && looksLikeFoodName(item.name);
}

function openedRemainDays(item: Item, todayMs: number): number | undefined {
  if (!item.openedAt || !item.openedShelfDays) return undefined;
  const openedMs = new Date(`${item.openedAt}T00:00:00`).getTime();
  if (!Number.isFinite(openedMs)) return undefined;
  return Number(item.openedShelfDays) - daysBetween(openedMs, todayMs);
}

export function rankKitchenItem(item: Item, today = new Date()): KitchenRankedItem {
  const signals: string[] = [];
  let score = 0;
  const info = expiryInfo(item.expiry);
  if (info) {
    if (info.days <= 0) score += 120;
    else if (info.days <= 3) score += 95;
    else if (info.days <= 7) score += 76;
    else if (info.days <= 14) score += 56;
    else if (info.days <= 30) score += 34;
    if (info.days <= 30) signals.push(info.label);
  }

  const todayMs = new Date(today.toISOString().slice(0, 10) + 'T00:00:00').getTime();
  const remain = openedRemainDays(item, todayMs);
  if (remain !== undefined) {
    if (remain < 0) score += 100;
    else if (remain <= 3) score += 72;
    else if (remain <= 7) score += 44;
    if (remain <= 14) signals.push(remain < 0 ? `开封超 ${-remain} 天` : `开封后还剩 ${remain} 天`);
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

export function rankKitchenItems(items: Item[], today = new Date()): KitchenRankedItem[] {
  return items
    .filter((item) => item.status !== 'pending' && Number(item.qty || 0) > 0)
    .map((item) => rankKitchenItem(item, today))
    .sort((a, b) => b.score - a.score || (b.item.lastTouchedAt || b.item.createdAt) - (a.item.lastTouchedAt || a.item.createdAt));
}

function locationLabel(item: Item, rooms: Room[], cabinets: Cabinet[]) {
  const room = rooms.find((r) => r.id === item.roomId);
  const cabinet = cabinets.find((c) => c.id === item.cabinetId);
  const roomName = item.roomId === GLOBAL_ROOM_ID ? '全屋' : room?.name || '未知房间';
  return `${roomName}${cabinet?.name ? `/${cabinet.name}` : ''}`;
}

function compactKitchenLine(rank: KitchenRankedItem, rooms: Room[], cabinets: Cabinet[]) {
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

function buildTodaySuggestionPrompt(input: KitchenSuggestionInput, ranked: KitchenRankedItem[]) {
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

async function callOpenAiCompat(
  provider: 'deepseek' | 'minimax' | 'openrouter',
  url: string,
  apiKey: string | undefined,
  model: string | undefined,
  messages: Array<{ role: 'system' | 'user'; content: unknown }>
): Promise<string> {
  const effectiveKey = apiKey || getUserApiKey(provider) || undefined;
  if (provider === 'minimax' && !effectiveKey) {
    throw new Error('MiniMax 官方 API Key 未配置，跳过 MiniMax 直连');
  }
  const res = await fetch(effectiveKey ? url : apiUrl(`/api/ai/${provider}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : apiAuthHeaders()),
    },
    body: JSON.stringify({
      model,
      messages,
      ...(provider === 'minimax'
        ? { max_completion_tokens: 1600, thinking: { type: 'disabled' } }
        : { max_tokens: 1600 }),
      temperature: 0.35,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`厨房 AI 失败 (${res.status})：${err.slice(0, 180)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || '厨房 AI 返回错误');
  if (data.base_resp?.status_code) {
    throw new Error(data.base_resp.status_msg || `MiniMax 返回错误 ${data.base_resp.status_code}`);
  }
  return data.choices?.[0]?.message?.content || '';
}

async function callVisionCompat(
  provider: 'minimax' | 'openrouter',
  url: string,
  model: string | undefined,
  blob: Blob,
  prompt: string
) {
  const base64 = await fileToBase64(blob);
  const mediaType = blob.type || 'image/jpeg';
  return callOpenAiCompat(provider, url, undefined, model, [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' } },
      ],
    },
  ]);
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (objectMatch) return JSON.parse(objectMatch[0]);
  if (arrayMatch) return JSON.parse(arrayMatch[0]);
  throw new Error('AI 返回格式异常');
}

function text(value: unknown, max = 80): string | undefined {
  const result = String(value || '').trim();
  return result ? result.slice(0, max) : undefined;
}

function date(value: unknown): string | undefined {
  const result = text(value, 10);
  return result && /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : undefined;
}

function positiveNumber(value: unknown, max: number): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.round(parsed * 10) / 10) : undefined;
}

function nullablePositiveInteger(value: unknown, max: number): number | null | undefined {
  if (value === null) return null;
  const parsed = positiveNumber(value, max);
  return parsed == null ? undefined : Math.round(parsed);
}

function money(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value == null || value === '') return undefined;
  const parsed = Number(String(value).replace(/[¥￥,\s]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : undefined;
}

function pixelRect(value: unknown, size: ImageSize, offsetY = 0): KitchenImportDraft['imageRect'] | undefined {
  const obj = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  let x = Number(obj.x);
  let y = Number(obj.y) + offsetY;
  let w = Number(obj.w);
  let h = Number(obj.h);
  if (![x, y, w, h].every(Number.isFinite)) return undefined;
  x = Math.max(0, Math.min(size.width, x));
  y = Math.max(0, Math.min(size.height, y));
  w = Math.max(1, Math.min(size.width - x, w));
  h = Math.max(1, Math.min(size.height - y, h));
  return rect({ x: x / size.width, y: y / size.height, w: w / size.width, h: h / size.height });
}

function rect(value: unknown): KitchenImportDraft['imageRect'] | undefined {
  const obj = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  let x = Number(obj.x);
  let y = Number(obj.y);
  let w = Number(obj.w);
  let h = Number(obj.h);
  if (![x, y, w, h].every(Number.isFinite)) return undefined;
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  w = Math.max(0.02, Math.min(1, w));
  h = Math.max(0.02, Math.min(1, h));
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return w > 0.02 && h > 0.02 ? { x, y, w, h } : undefined;
}

function stringList(value: unknown, maxItems = 8, maxLen = 40): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((entry) => text(entry, maxLen))
    .filter((entry): entry is string => !!entry)
    .filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    })
    .slice(0, maxItems);
}

function clampConfidence(value: unknown, fallback = 0.72): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0.1, Math.min(1, parsed));
}

function rectIoU(a: KitchenImportDraft['imageRect'], b: KitchenImportDraft['imageRect']) {
  if (!a || !b) return 0;
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

function suppressOverlappingDrafts(drafts: KitchenImportDraft[]) {
  const sorted = [...drafts].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const kept: KitchenImportDraft[] = [];
  for (const draft of sorted) {
    if (!draft.imageRect) {
      kept.push(draft);
      continue;
    }
    const duplicate = kept.some((entry) => rectIoU(draft.imageRect, entry.imageRect) > 0.1 || sameNearbyName(draft, entry));
    if (!duplicate) kept.push(draft);
  }
  return kept.sort((a, b) => (a.imageRect?.y || 0) - (b.imageRect?.y || 0));
}

function sameNearbyName(a: KitchenImportDraft, b: KitchenImportDraft) {
  const an = a.name.replace(/\s/g, '');
  const bn = b.name.replace(/\s/g, '');
  if (!an || !bn || !(an.includes(bn) || bn.includes(an))) return false;
  if (!a.imageRect || !b.imageRect) return false;
  const ay = a.imageRect.y + a.imageRect.h / 2;
  const by = b.imageRect.y + b.imageRect.h / 2;
  return Math.abs(ay - by) < Math.max(a.imageRect.h, b.imageRect.h) * 1.2;
}

function sanitizeTodaySuggestion(raw: unknown, ranked: KitchenRankedItem[], mode: KitchenSuggestionMode): KitchenTodaySuggestion {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const itemIds = new Set(ranked.map((rank) => rank.item.id));
  const priorityItemIds = stringList(obj.priorityItemIds, 8, 80).filter((id) => itemIds.has(id));
  const dishesRaw = Array.isArray(obj.dishes) ? obj.dishes : [];
  const dishes = dishesRaw
    .map((entry): KitchenDishSuggestion | null => {
      const dish = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const name = text(dish.name, 40);
      if (!name) return null;
      const focusItemIds = stringList(dish.focusItemIds, 8, 80).filter((id) => itemIds.has(id));
      const focusItems = stringList(dish.focusItems, 8, 24);
      return {
        name,
        focusItemIds,
        focusItems: focusItems.length
          ? focusItems
          : focusItemIds.map((id) => ranked.find((rank) => rank.item.id === id)?.item.name).filter((value): value is string => !!value),
        optionalItems: stringList(dish.optionalItems, 4, 24),
        missingItems: stringList(dish.missingItems, 2, 24),
        reason: text(dish.reason, 90) || '优先使用当前库存',
        timeEstimate: text(dish.timeEstimate, 16),
        confidence: clampConfidence(dish.confidence),
      };
    })
    .filter((entry): entry is KitchenDishSuggestion => !!entry)
    .slice(0, 5);

  return {
    mode,
    summary: text(obj.summary, 120) || (priorityItemIds.length ? '今天优先处理临期和已开封食材。' : '当前没有明显需要优先处理的食材。'),
    priorityItemIds,
    ingredientNames: stringList(obj.ingredientNames, 10, 24),
    dishes,
  };
}

function foodKind(name: string) {
  if (/(鸡蛋|鸭蛋|蛋)/.test(name)) return 'egg';
  if (/(鸡|牛|猪|肉|鱼|虾|排骨|培根|火腿|腊肠|香肠)/.test(name)) return 'protein';
  if (/(米饭|米|面|面条|粉|饼|馒头|吐司|面包)/.test(name)) return 'carb';
  if (/(青菜|白菜|菠菜|生菜|油麦|芹菜|番茄|西红柿|土豆|蘑菇|菌|青椒|辣椒|黄瓜|胡萝卜|洋葱|西兰花|豆芽|茄子|笋)/.test(name)) return 'veg';
  if (/(豆腐|豆干|腐竹|豆皮)/.test(name)) return 'tofu';
  return 'other';
}

function firstByKind(ranked: KitchenRankedItem[], kind: string) {
  return ranked.find((rank) => foodKind(rank.item.name) === kind);
}

function localTodaySuggestion(ranked: KitchenRankedItem[]): KitchenTodaySuggestion {
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
  const dishes: KitchenDishSuggestion[] = [];
  const addDish = (name: string, ranks: Array<KitchenRankedItem | undefined>, optionalItems: string[] = [], missingItems: string[] = []) => {
    const used = ranks.filter((rank): rank is KitchenRankedItem => !!rank);
    if (!used.length || dishes.some((dish) => dish.name === name)) return;
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

  if (egg && veg && /番茄|西红柿/.test(veg.item.name)) addDish('番茄炒蛋', [veg, egg], ['葱']);
  if (protein && veg) addDish(`${protein.item.name}炒${veg.item.name}`, [protein, veg], ['蒜', '酱油']);
  if (egg && veg) addDish(`${veg.item.name}炒蛋`, [veg, egg], ['葱']);
  if (tofu) addDish('家常豆腐', [tofu, veg], ['蒜'], ['青椒']);
  if (veg) addDish(`清炒${veg.item.name}`, [veg], ['蒜']);
  if (carb && (protein || veg || egg)) addDish(`${carb.item.name}快手炒饭`, [carb, protein || veg || egg], ['葱']);
  addDish(`${top.slice(0, 3).map((rank) => rank.item.name).join('、')}今日优先处理`, top.slice(0, 3), []);

  return {
    mode: 'local',
    summary: `今天优先看 ${top.slice(0, 3).map((rank) => rank.item.name).join('、')}。`,
    priorityItemIds: top.slice(0, 8).map((rank) => rank.item.id),
    ingredientNames: top.slice(0, 8).map((rank) => rank.item.name),
    dishes: dishes.slice(0, 5),
  };
}

export async function suggestKitchenToday(
  storage: Storage,
  input: KitchenSuggestionInput
): Promise<KitchenTodaySuggestion> {
  const ranked = rankKitchenItems(input.items);
  if (!ranked.length) return localTodaySuggestion(ranked);
  const prompt = buildTodaySuggestionPrompt(input, ranked);

  try {
    const result = await callOpenAiCompat(
      'deepseek',
      DEEPSEEK_API,
      undefined,
      (await getConfig<string>(storage, 'deepseekModel', '')) || undefined,
      [{ role: 'user', content: prompt }]
    );
    const suggestion = sanitizeTodaySuggestion(parseJson(result), ranked, 'ai');
    if (suggestion.dishes.length) return suggestion;
  } catch (err) {
    console.warn('DeepSeek kitchen suggestion failed, fallback:', err);
  }

  try {
    const result = await callOpenAiCompat(
      'minimax',
      MINIMAX_API,
      undefined,
      (await getConfig<string>(storage, 'minimaxModel', '')) || DEFAULT_MINIMAX_MODEL,
      [{ role: 'user', content: prompt }]
    );
    const suggestion = sanitizeTodaySuggestion(parseJson(result), ranked, 'ai');
    if (suggestion.dishes.length) return suggestion;
  } catch (err) {
    console.warn('MiniMax kitchen suggestion failed, fallback:', err);
  }

  return localTodaySuggestion(ranked);
}

function buildKitchenImportPrompt() {
  return `识别图片里的订单商品。

请按从上到下的顺序，找出所有商品图，并把每个商品图和旁边的商品名、数量、实付价格对应起来。

只返回这些字段：
- name：商品名
- qty：数量，没有看到就填 1
- paidPrice：实付价格，没有看到就省略
- pixelRect：商品图本身的像素框，不要框文字、价格、按钮、空白或整行
- imageRect：商品图本身的归一化框
- confidence：0 到 1

pixelRect 和 imageRect 的 x/y 都是左上角，w/h 都是宽高。
pixelRect 相对于当前输入图片的像素坐标。
imageRect 相对于当前输入图片归一化。

只返回 JSON：
{
  "items": [
    {
      "name": "潭牛冷鲜文昌鸡半只切块 450g",
      "qty": 1,
      "paidPrice": 36.51,
      "pixelRect": {"x":57,"y":241,"w":140,"h":140},
      "imageRect": {"x":0.07,"y":0.30,"w":0.13,"h":0.06},
      "confidence": 0.82
    }
  ]
}`;
}

function inferImportTags(name: string): string[] {
  const tags: string[] = [];
  if (/(鸡|鸭|牛|猪|羊|肉|鱼|虾|蟹|蛋|排骨|文昌鸡)/.test(name)) tags.push('生鲜', '肉禽蛋奶');
  if (/(番茄|土豆|黄瓜|青椒|辣椒|菜|蘑菇|洋葱|胡萝卜|西兰花|葱|姜|蒜)/.test(name)) tags.push('蔬菜');
  if (/(葡萄|苹果|香蕉|橙|梨|草莓|西瓜|蓝莓|柠檬|椰子)/.test(name)) tags.push('水果');
  if (/(牛奶|酸奶|奶酪|芝士|黄油|奶油)/.test(name)) tags.push('乳制品');
  if (/(椰子水|水|可乐|雪碧|果汁|茶|咖啡|饮料|啤酒)/.test(name)) tags.push('饮料');
  if (/(米|面|粉|馒头|包子|饺子|吐司|面包|燕麦)/.test(name)) tags.push('主食');
  if (/(酱油|醋|料酒|蚝油|酱|盐|糖|胡椒|花椒|孜然|咖喱|淀粉|食用油|香油)/.test(name)) tags.push('调味品');
  if (/(冷冻|冻|冰鲜|冷鲜)/.test(name)) tags.push('冷冻');
  if (!tags.length) tags.push('食品');
  return Array.from(new Set(tags));
}

function normalizeImportTags(name: string, rawTags: string[]) {
  const tags = [...rawTags, ...inferImportTags(name)].map((tag) => (tag === '调料' ? '调味品' : tag));
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .slice(0, 4);
}

function sanitizeImportDraft(raw: unknown, size?: ImageSize, offsetY = 0): KitchenImportDraft | null {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = text(obj.name, 60);
  if (!name) return null;
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
    imageRect: size ? pixelRect(obj.pixelRect, size, offsetY) || rect(obj.imageRect) : rect(obj.imageRect),
    confidence: clampConfidence(obj.confidence, 0.65),
  };
}

function sanitizeImportResult(raw: unknown, size?: ImageSize, offsetY = 0): KitchenImportDraft[] {
  const source: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).items)
      ? (raw as any).items
      : [];
  const seen = new Set<string>();
  return source
    .map((entry) => sanitizeImportDraft(entry, size, offsetY))
    .filter((draft): draft is KitchenImportDraft => !!draft)
    .filter((draft) => {
      const key = draft.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

async function getImageSize(blob: Blob): Promise<ImageSize> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return size;
}

async function splitImageChunks(blob: Blob, size: ImageSize): Promise<ImageChunk[]> {
  if (size.height <= 1300) return [{ blob, offsetY: 0, height: size.height }];
  const chunkHeight = 1000;
  const overlap = 260;
  const step = chunkHeight - overlap;
  const bitmap = await createImageBitmap(blob);
  const chunks: ImageChunk[] = [];
  for (let y = 0; y < size.height; y += step) {
    const height = Math.min(chunkHeight, size.height - y);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, y, size.width, height, 0, 0, size.width, height);
    const chunkBlob = await new Promise<Blob>((resolve) => canvas.toBlob((next) => resolve(next!), 'image/jpeg', 0.9));
    chunks.push({ blob: chunkBlob, offsetY: y, height });
    if (y + height >= size.height) break;
  }
  bitmap.close?.();
  return chunks;
}

async function callMiniMaxKitchenImportChunks(storage: Storage, blob: Blob, prompt: string): Promise<KitchenImportDraft[]> {
  const size = await getImageSize(blob);
  const chunks = await splitImageChunks(blob, size);
  const model = (await getConfig<string>(storage, 'minimaxModel', '')) || DEFAULT_MINIMAX_MODEL;
  const all: KitchenImportDraft[] = [];
  for (const chunk of chunks) {
    const result = await callVisionCompat('minimax', MINIMAX_API, model, chunk.blob, prompt);
    all.push(...sanitizeImportResult(parseJson(result), size, chunk.offsetY));
  }
  return suppressOverlappingDrafts(all).slice(0, 30);
}

export async function suggestKitchenImportFromImage(storage: Storage, blob: Blob): Promise<KitchenImportDraft[]> {
  const prompt = buildKitchenImportPrompt();
  try {
    const drafts = await callMiniMaxKitchenImportChunks(storage, blob, prompt);
    if (drafts.length) return drafts;
  } catch (err) {
    console.warn('MiniMax kitchen image import failed, fallback:', err);
  }

  const result = await callVisionCompat(
    'openrouter',
    OPENROUTER_API,
    (await getConfig<string>(storage, 'openrouterModel', '')) || undefined,
    blob,
    prompt
  );
  return sanitizeImportResult(parseJson(result), await getImageSize(blob));
}
