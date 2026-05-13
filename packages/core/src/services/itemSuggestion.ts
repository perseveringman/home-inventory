import type { Cabinet, Item, Room, Season } from '../models';
import { GLOBAL_ROOM_ID, PRESET_TAGS } from '../models';
import { getConfig } from '../storage/indexeddb';
import type { Storage } from '../storage/types';
import { fileToBase64 } from '../utils/image';

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

export type SuggestionMode = 'ai' | 'local';

export interface ItemDraftSuggestion {
  name?: string;
  qty?: number;
  note?: string;
  tags?: string[];
  expiry?: string;
  roomId?: string;
  cabinetId?: string;
  openedShelfDays?: number | null;
  warrantyMonths?: number | null;
  minStock?: number | null;
  season?: Season;
  reason?: string;
  mode?: SuggestionMode;
}

interface SuggestItemDraftInput {
  item: Item;
  rooms: Room[];
  cabinets: Cabinet[];
  items: Item[];
  today?: string;
}

const TAG_NAMES = PRESET_TAGS.map((tag) => tag.name);

const KEYWORD_TAGS: Array<{ tag: string; words: string[] }> = [
  { tag: '药品', words: ['药', '片', '胶囊', '膏', '创可贴', '布洛芬', '感冒', '退烧', '消炎'] },
  { tag: '保健品', words: ['维生素', '鱼油', '蛋白粉', '钙片', '益生菌', '保健'] },
  { tag: '食品', words: ['米', '面', '饼', '糖', '罐头', '调料', '酱', '油', '奶', '咖啡', '茶', '零食'] },
  { tag: '饮料', words: ['饮料', '水', '可乐', '果汁', '啤酒', '牛奶', '酸奶'] },
  { tag: '数码', words: ['数据线', '充电', '耳机', '鼠标', '键盘', '手机', '相机', '硬盘', '电池'] },
  { tag: '家电', words: ['插座', '灯', '电器', '风扇', '遥控', '电源', '转换器'] },
  { tag: '衣物', words: ['衣', '裤', '袜', '帽', '围巾', '被', '床单', '鞋'] },
  { tag: '书籍', words: ['书', '文件', '资料', '绘本'] },
  { tag: '文具', words: ['笔', '本', '纸', '胶带', '剪刀', '订书机', '文件夹'] },
  { tag: '工具', words: ['螺丝', '锤', '钳', '扳手', '刀', '工具', '胶枪'] },
  { tag: '玩具', words: ['玩具', '积木', '娃娃', '拼图'] },
  { tag: '美妆', words: ['口红', '面膜', '护肤', '洗面奶', '香水', '粉底', '化妆'] },
  { tag: '日用', words: ['纸巾', '清洁', '洗衣', '洗手', '牙刷', '毛巾', '垃圾袋'] },
  { tag: '厨具', words: ['锅', '碗', '杯', '刀叉', '筷', '盘', '铲', '勺'] },
];

const ROOM_TAG_HINTS: Array<{ tags: string[]; words: string[] }> = [
  { tags: ['食品', '饮料', '厨具'], words: ['厨房', '餐厅', '橱柜', '冰箱', '食品', '调料'] },
  { tags: ['药品', '保健品', '美妆', '日用'], words: ['卫生间', '浴室', '药箱', '洗漱', '护理'] },
  { tags: ['书籍', '文具', '数码'], words: ['书房', '办公', '书桌', '文件', '数码'] },
  { tags: ['衣物'], words: ['卧室', '衣帽间', '衣柜', '床头', '收纳'] },
  { tags: ['玩具'], words: ['儿童房', '玩具', '客厅'] },
  { tags: ['家电'], words: ['客厅', '电器', '电视柜', '工具'] },
  { tags: ['工具'], words: ['阳台', '工具', '杂物', '储物'] },
];

function compactItemLine(item: Item): string {
  const meta = [
    item.qty > 1 ? `x${item.qty}` : '',
    item.tags?.length ? `#${item.tags.join('/')}` : '',
    item.expiry ? `exp=${item.expiry}` : '',
    item.note ? `note=${item.note.slice(0, 24)}` : '',
  ].filter(Boolean);
  return `${item.name}${meta.length ? ` (${meta.join(', ')})` : ''}`;
}

function buildPlacementOptions(rooms: Room[], cabinets: Cabinet[], items: Item[]): string {
  const itemsByCabinet = new Map<string, Item[]>();
  for (const item of items) {
    if (!itemsByCabinet.has(item.cabinetId)) itemsByCabinet.set(item.cabinetId, []);
    itemsByCabinet.get(item.cabinetId)!.push(item);
  }

  const lines: string[] = [
    `- roomId=${GLOBAL_ROOM_ID} cabinetId=__global_loose__ label=全屋自由区`,
  ];
  for (const room of rooms) {
    lines.push(`- roomId=${room.id} room=${room.name}`);
    const normalCabinets = cabinets
      .filter((cabinet) => cabinet.roomId === room.id && (!cabinet.type || cabinet.type === 'normal'))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const cabinet of normalCabinets) {
      const examples = (itemsByCabinet.get(cabinet.id) || [])
        .slice(0, 8)
        .map(compactItemLine)
        .join('、');
      lines.push(`  - cabinetId=${cabinet.id} name=${cabinet.name}${examples ? ` existing=${examples}` : ''}`);
    }
    lines.push('  - cabinetId=__room_loose__ name=此房间自由区');
  }
  return lines.join('\n');
}

function buildSuggestionPrompt(input: SuggestItemDraftInput): string {
  const { item, rooms, cabinets, items, today } = input;
  const currentCabinet = cabinets.find((cabinet) => cabinet.id === item.cabinetId);
  const currentRoom = rooms.find((room) => room.id === item.roomId);

  return `你正在家居收纳应用的“待处理物品编辑弹窗”里，为一个物品生成可直接预填的表单草稿。

今天：${today || new Date().toISOString().slice(0, 10)}

当前物品：
- id=${item.id}
- name=${item.name || '（空）'}
- qty=${item.qty || 1}
- note=${item.note || '（空）'}
- tags=${item.tags?.join('/') || '（空）'}
- emoji=${item.aiEmoji || '（无）'}
- 当前房间=${currentRoom?.name || item.roomId || '未知'} 当前柜子=${currentCabinet?.name || item.cabinetId || '未知'}

可用标签：${TAG_NAMES.join('、')}

可选位置（返回时 roomId 和 cabinetId 必须严格来自这里）：
${buildPlacementOptions(rooms, cabinets, items)}

请只返回一个 JSON 对象，不要 Markdown，不要解释。字段如下，没把握就省略：
{
  "name": "更准确的物品名",
  "qty": 1,
  "note": "一句短备注",
  "tags": ["药品"],
  "roomId": "房间 id",
  "cabinetId": "柜子 id 或 __room_loose__ 或 __global_loose__",
  "expiry": "yyyy-mm-dd",
  "openedShelfDays": 90,
  "warrantyMonths": 12,
  "minStock": 1,
  "season": "spring|summer|autumn|winter|",
  "reason": "为什么这样建议，20 字以内"
}

规则：
1. 优先帮用户完成“待处理物品归位”：尽量推荐最像同类物品聚集的柜子。
2. 若当前名称像“物品1/白色瓶子/未知物品”且你能从图片或上下文判断，可以改名；否则保留原名。
3. 标签最多 4 个，优先使用可用标签。
4. 不要编造具体保质期、购买日期或品牌规格；没有确定来源时不要返回 expiry。
5. note 可以提醒用户补录关键事实，例如“待确认保质期”，但不要写空泛宣传语。
6. cabinetId 为普通柜子 id 时，roomId 必须是该柜子的 roomId；选择房间自由区时 cabinetId 用 "__room_loose__"；选择全屋自由区时 roomId 用 "${GLOBAL_ROOM_ID}" 且 cabinetId 用 "__global_loose__"。`;
}

async function callOpenAiCompat(
  url: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: 'system' | 'user'; content: unknown }>
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 900,
      temperature: 0.25,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI 建议失败 (${res.status})：${err.slice(0, 160)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'AI 建议返回错误');
  return data.choices?.[0]?.message?.content || '';
}

function parseJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 建议格式异常');
  return JSON.parse(match[0]);
}

function sanitizeText(value: unknown, max = 80): string | undefined {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : undefined;
}

function sanitizeDate(value: unknown): string | undefined {
  const text = sanitizeText(value, 10);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function sanitizePositiveNumber(value: unknown, max: number): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : undefined;
}

function sanitizeNullablePositiveNumber(value: unknown, max: number): number | null | undefined {
  if (value === null) return null;
  return sanitizePositiveNumber(value, max);
}

function sanitizeSeason(value: unknown): Season | undefined {
  const season = sanitizeText(value, 12);
  if (season === '' || season === 'spring' || season === 'summer' || season === 'autumn' || season === 'winter') {
    return season;
  }
  return undefined;
}

function sanitizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const tags = value
    .map((tag) => sanitizeText(tag, 12))
    .filter((tag): tag is string => !!tag)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .slice(0, 4);
  return tags.length ? tags : undefined;
}

function sanitizeSuggestion(
  raw: unknown,
  rooms: Room[],
  cabinets: Cabinet[],
  mode: SuggestionMode
): ItemDraftSuggestion {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const roomIds = new Set([GLOBAL_ROOM_ID, ...rooms.map((room) => room.id)]);
  const normalCabinets = cabinets.filter((cabinet) => !cabinet.type || cabinet.type === 'normal');
  const normalCabinetIds = new Set(normalCabinets.map((cabinet) => cabinet.id));

  let roomId = sanitizeText(obj.roomId, 80);
  let cabinetId = sanitizeText(obj.cabinetId, 80);

  if (cabinetId && normalCabinetIds.has(cabinetId)) {
    roomId = normalCabinets.find((cabinet) => cabinet.id === cabinetId)?.roomId;
  } else if (cabinetId === '__global_loose__' || roomId === GLOBAL_ROOM_ID) {
    roomId = GLOBAL_ROOM_ID;
    cabinetId = '__global_loose__';
  } else if (cabinetId === '__room_loose__') {
    if (!roomId || roomId === GLOBAL_ROOM_ID || !roomIds.has(roomId)) {
      roomId = undefined;
      cabinetId = undefined;
    }
  } else {
    cabinetId = undefined;
    if (roomId && !roomIds.has(roomId)) roomId = undefined;
  }

  return {
    name: sanitizeText(obj.name, 40),
    qty: sanitizePositiveNumber(obj.qty, 999),
    note: sanitizeText(obj.note, 120),
    tags: sanitizeTags(obj.tags),
    expiry: sanitizeDate(obj.expiry),
    roomId,
    cabinetId,
    openedShelfDays: sanitizeNullablePositiveNumber(obj.openedShelfDays, 3650),
    warrantyMonths: sanitizeNullablePositiveNumber(obj.warrantyMonths, 240),
    minStock: sanitizeNullablePositiveNumber(obj.minStock, 999),
    season: sanitizeSeason(obj.season),
    reason: sanitizeText(obj.reason, 80),
    mode,
  };
}

function inferTags(item: Item): string[] {
  const haystack = `${item.name} ${item.note} ${item.aiEmoji || ''}`.toLowerCase();
  const tags: string[] = [];
  for (const group of KEYWORD_TAGS) {
    if (group.words.some((word) => haystack.includes(word.toLowerCase()))) tags.push(group.tag);
  }
  return Array.from(new Set([...tags, ...(item.tags || [])])).slice(0, 4);
}

function scoreRoom(room: Room, tags: string[], item: Item): number {
  let score = item.roomId === room.id ? 2 : 0;
  const text = `${room.name} ${item.name}`.toLowerCase();
  for (const hint of ROOM_TAG_HINTS) {
    if (!hint.tags.some((tag) => tags.includes(tag))) continue;
    for (const word of hint.words) {
      if (text.includes(word.toLowerCase())) score += 2;
    }
  }
  return score;
}

function scoreCabinet(cabinet: Cabinet, tags: string[], item: Item, allItems: Item[]): number {
  let score = scoreRoom({ id: cabinet.roomId, name: '', icon: '', createdAt: 0 }, tags, item);
  const cabinetText = cabinet.name.toLowerCase();
  for (const tag of tags) {
    if (cabinetText.includes(tag.toLowerCase())) score += 4;
  }
  for (const hint of ROOM_TAG_HINTS) {
    if (!hint.tags.some((tag) => tags.includes(tag))) continue;
    for (const word of hint.words) {
      if (cabinetText.includes(word.toLowerCase())) score += 2;
    }
  }
  for (const existing of allItems.filter((existingItem) => existingItem.cabinetId === cabinet.id)) {
    const sharedTags = existing.tags?.filter((tag) => tags.includes(tag)).length || 0;
    score += sharedTags * 3;
  }
  return score;
}

function heuristicSuggestion(input: SuggestItemDraftInput): ItemDraftSuggestion {
  const tags = inferTags(input.item);
  const normalCabinets = input.cabinets.filter((cabinet) => !cabinet.type || cabinet.type === 'normal');
  const bestCabinet = normalCabinets
    .map((cabinet) => ({ cabinet, score: scoreCabinet(cabinet, tags, input.item, input.items) }))
    .sort((a, b) => b.score - a.score)[0];
  const bestRoom = input.rooms
    .map((room) => ({ room, score: scoreRoom(room, tags, input.item) }))
    .sort((a, b) => b.score - a.score)[0];

  const suggestion: ItemDraftSuggestion = {
    tags: tags.length ? tags : undefined,
    qty: input.item.qty || 1,
    reason: '按名称和已有收纳推断',
    mode: 'local',
  };

  if (bestCabinet && bestCabinet.score > 0) {
    suggestion.roomId = bestCabinet.cabinet.roomId;
    suggestion.cabinetId = bestCabinet.cabinet.id;
  } else if (bestRoom && bestRoom.score > 0) {
    suggestion.roomId = bestRoom.room.id;
    suggestion.cabinetId = '__room_loose__';
  } else if (input.item.roomId && input.item.roomId !== GLOBAL_ROOM_ID) {
    suggestion.roomId = input.item.roomId;
    suggestion.cabinetId = '__room_loose__';
  } else {
    suggestion.roomId = GLOBAL_ROOM_ID;
    suggestion.cabinetId = '__global_loose__';
  }

  if (!input.item.note && (tags.includes('药品') || tags.includes('食品') || tags.includes('保健品'))) {
    suggestion.note = '待确认保质期';
    suggestion.minStock = 1;
  }
  if (!input.item.note && tags.includes('衣物')) {
    suggestion.season = inferSeason(input.item.name);
  }
  return suggestion;
}

function inferSeason(name: string): Season | undefined {
  if (/羽绒|毛衣|围巾|冬/.test(name)) return 'winter';
  if (/短袖|凉鞋|泳|夏/.test(name)) return 'summer';
  if (/春/.test(name)) return 'spring';
  if (/秋/.test(name)) return 'autumn';
  return undefined;
}

async function buildOpenRouterMessages(prompt: string, item: Item) {
  if (!item.image) {
    return [{ role: 'user' as const, content: prompt }];
  }
  const base64 = await fileToBase64(item.image);
  return [
    {
      role: 'user' as const,
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
      ],
    },
  ];
}

export async function suggestItemDraft(
  storage: Storage,
  input: SuggestItemDraftInput
): Promise<ItemDraftSuggestion> {
  const prompt = buildSuggestionPrompt(input);
  const openrouterKey = await getConfig<string>(storage, 'openrouterKey', '');

  if (openrouterKey && input.item.image) {
    const text = await callOpenAiCompat(
      OPENROUTER_API,
      openrouterKey,
      await getConfig<string>(storage, 'openrouterModel', 'google/gemini-2.5-flash'),
      await buildOpenRouterMessages(prompt, input.item)
    );
    return sanitizeSuggestion(parseJsonObject(text), input.rooms, input.cabinets, 'ai');
  }

  const deepseekKey = await getConfig<string>(storage, 'deepseekKey', '');
  if (deepseekKey) {
    const text = await callOpenAiCompat(
      DEEPSEEK_API,
      deepseekKey,
      await getConfig<string>(storage, 'deepseekModel', 'deepseek-v4-flash'),
      [{ role: 'user', content: prompt }]
    );
    return sanitizeSuggestion(parseJsonObject(text), input.rooms, input.cabinets, 'ai');
  }

  if (openrouterKey) {
    const text = await callOpenAiCompat(
      OPENROUTER_API,
      openrouterKey,
      await getConfig<string>(storage, 'openrouterModel', 'google/gemini-2.5-flash'),
      [{ role: 'user', content: prompt }]
    );
    return sanitizeSuggestion(parseJsonObject(text), input.rooms, input.cabinets, 'ai');
  }

  await new Promise((resolve) => setTimeout(resolve, 450));
  return heuristicSuggestion(input);
}
