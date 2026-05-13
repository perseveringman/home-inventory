import type {
  Cabinet,
  Item,
  ReminderEvent,
  Room,
  Subscription,
} from '../models';
import { GLOBAL_ROOM_ID, REMINDER_KIND_LABEL, SUB_CATEGORIES } from '../models';
import type { Storage } from '../storage/types';
import { getConfig } from '../storage/indexeddb';
import { isLooseCabinet } from './cabinet';
import { computeItemEvents, computeSubscriptionEvents } from './reminder';
import { subscriptionMonthlyCost } from './subscription';

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RenameSuggestion {
  id: string;
  newName: string;
}

export interface ChatContext {
  /** Current pathname, e.g. "/room/abc", "/inbox", "/subscribe" */
  currentPath?: string;
  /** Current room id when user is viewing one. */
  currentRoomId?: string;
  /** Today's local date in yyyy-mm-dd. */
  today?: string;
}

const SUB_CAT_NAME = Object.fromEntries(
  SUB_CATEGORIES.map((c) => [c.id, c.name])
) as Record<string, string>;

const CYCLE_NAME: Record<string, string> = {
  weekly: '周',
  monthly: '月',
  quarterly: '季',
  yearly: '年',
  custom: '自定义',
};

function formatItemMeta(item: Item): string {
  const parts: string[] = [];
  if (item.qty > 1) parts.push(`×${item.qty}`);
  if (item.tags?.length) parts.push(`#${item.tags.join('/')}`);
  if (item.expiry) parts.push(`保质至 ${item.expiry}`);
  if (item.openedAt) parts.push(`已开封 ${item.openedAt}`);
  if (item.warrantyMonths)
    parts.push(`保 ${item.warrantyMonths} 月起 ${item.purchasedAt || '?'}`);
  if (item.minStock != null) parts.push(`min=${item.minStock}`);
  if (item.season) parts.push(`季 ${item.season}`);
  return parts.length ? `（${parts.join('，')}）` : '';
}

function formatItemList(items: Item[], limit = 14): string {
  if (!items.length) return '（暂无物品）';
  const head = items
    .slice(0, limit)
    .map((it) => `${it.name}${formatItemMeta(it)}`)
    .join('、');
  if (items.length <= limit) return head;
  // Tag tail summary so the AI still has a sense of the rest.
  const tailTags = new Map<string, number>();
  for (const it of items.slice(limit)) {
    for (const tag of it.tags || []) tailTags.set(tag, (tailTags.get(tag) || 0) + 1);
  }
  const tagSummary = Array.from(tailTags.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t, n]) => `${t}×${n}`)
    .join('、');
  return `${head}… 等另 ${items.length - limit} 件${
    tagSummary ? `（标签：${tagSummary}）` : ''
  }`;
}

function eventLine(ev: ReminderEvent): string {
  const due =
    ev.daysLeft < 0
      ? `已逾期 ${-ev.daysLeft} 天`
      : ev.daysLeft === 0
      ? '今天'
      : `${ev.daysLeft} 天后`;
  return `- [${ev.level}|${REMINDER_KIND_LABEL[ev.kind] || ev.kind}] ${ev.title} · ${ev.subtitle} · ${due}`;
}

export function buildChatSystemPrompt(
  rooms: Room[],
  cabinets: Cabinet[],
  items: Item[],
  subscriptions: Subscription[] = [],
  ctx: ChatContext = {}
): string {
  const today = ctx.today || new Date().toISOString().slice(0, 10);

  // Group items by cabinetId (every item, no filters).
  const itemsByCabinet = new Map<string, Item[]>();
  for (const it of items) {
    const key = it.cabinetId || `__no_cabinet_${it.roomId}`;
    if (!itemsByCabinet.has(key)) itemsByCabinet.set(key, []);
    itemsByCabinet.get(key)!.push(it);
  }

  const placed = items.filter((i) => i.status === 'placed');
  const pending = items.filter((i) => i.status === 'pending');
  const totalCabinets = cabinets.filter((c) => !isLooseCabinet(c)).length;

  // ===== Per-room layout (includes both normal and loose cabinets) =====
  const roomBlocks = rooms.map((room) => {
    const normalCabs = cabinets.filter(
      (c) => c.roomId === room.id && (!c.type || c.type === 'normal')
    );
    const looseCab = cabinets.find(
      (c) => c.roomId === room.id && c.type === 'loose'
    );

    const lines: string[] = [];
    if (!normalCabs.length && !looseCab) {
      lines.push('（无储物单元）');
    } else {
      normalCabs.forEach((cab, idx) => {
        const its = itemsByCabinet.get(cab.id) || [];
        lines.push(`${idx + 1}. [id=${cab.id}] ${cab.name}：${formatItemList(its)}`);
      });
      if (looseCab) {
        const its = itemsByCabinet.get(looseCab.id) || [];
        if (its.length || normalCabs.length === 0) {
          lines.push(`* 自由区（本房间未归柜）：${formatItemList(its)}`);
        }
      }
    }
    return `### ${room.name}（${normalCabs.length} 个储物单元${
      ctx.currentRoomId === room.id ? '，← 当前正在浏览' : ''
    }）\n${lines.join('\n')}`;
  });

  // 全屋自由区
  const globalLoose = cabinets.find((c) => c.type === 'loose-global');
  let globalBlock = '';
  if (globalLoose) {
    const its = itemsByCabinet.get(globalLoose.id) || [];
    globalBlock = `\n### 全屋自由区（不属于任何房间）\n${formatItemList(its, 20)}`;
  }

  // ===== Pending queue =====
  let pendingBlock = '';
  if (pending.length) {
    const pendingLines = pending.slice(0, 30).map((it) => {
      const room = rooms.find((r) => r.id === it.roomId);
      const cabinet = cabinets.find((c) => c.id === it.cabinetId);
      const where = `${room ? room.name : '未知房间'} › ${cabinet ? cabinet.name : '（无柜子）'}`;
      return `- ${it.name}${formatItemMeta(it)} @ ${where}`;
    });
    pendingBlock =
      `\n【待处理（共 ${pending.length} 件，需要归位 / 整理）】\n` +
      pendingLines.join('\n') +
      (pending.length > 30 ? `\n…还有 ${pending.length - 30} 件未列出` : '');
  }

  // ===== Subscriptions =====
  let subBlock = '';
  if (subscriptions.length) {
    const active = subscriptions.filter((s) => s.status === 'active');
    const paused = subscriptions.filter((s) => s.status !== 'active');
    const monthly = active.reduce((sum, s) => sum + subscriptionMonthlyCost(s), 0);
    const subLines = active
      .slice()
      .sort(
        (a, b) =>
          new Date(a.nextDueAt || '2999-01-01').getTime() -
          new Date(b.nextDueAt || '2999-01-01').getTime()
      )
      .slice(0, 30)
      .map((s) => {
        const cat = SUB_CAT_NAME[s.category] || s.category;
        const cycle = CYCLE_NAME[s.cycle] || s.cycle;
        const due = s.nextDueAt ? `下次 ${s.nextDueAt}` : '未设定';
        return `- ${s.name}（${cat}）¥${s.amount.toFixed(2)}/${cycle} · ${due}`;
      });
    subBlock = `\n【订阅（生效 ${active.length} 条，月均 ¥${monthly.toFixed(0)}${
      paused.length ? `；另暂停 ${paused.length} 条` : ''
    }）】\n${subLines.join('\n') || '（无生效订阅）'}`;
  }

  // ===== Reminder events =====
  const itemEvents = computeItemEvents(items);
  const subEvents = computeSubscriptionEvents(subscriptions);
  const allEvents = [...itemEvents, ...subEvents].sort(
    (a, b) => a.daysLeft - b.daysLeft
  );
  const importantEvents = allEvents.filter(
    (e) => e.level === 'critical' || e.level === 'warn'
  );
  let eventsBlock = '';
  if (importantEvents.length) {
    const top = importantEvents.slice(0, 20);
    eventsBlock =
      `\n【近期提醒（${importantEvents.length} 条 critical/warn）】\n` +
      top.map(eventLine).join('\n') +
      (importantEvents.length > 20
        ? `\n…还有 ${importantEvents.length - 20} 条`
        : '');
  }

  // ===== Current location =====
  const locationParts: string[] = [`今天是 ${today}`];
  if (ctx.currentPath) locationParts.push(`用户当前在页面 ${ctx.currentPath}`);
  if (ctx.currentRoomId && ctx.currentRoomId !== GLOBAL_ROOM_ID) {
    const r = rooms.find((rm) => rm.id === ctx.currentRoomId);
    if (r) locationParts.push(`正在浏览房间「${r.name}」`);
  }

  return `你是这个家居收纳应用的 AI 收纳助手。${locationParts.join('；')}。

【家庭概况】
${rooms.length} 个房间 · ${totalCabinets} 个储物单元 · ${placed.length} 件已归位 · ${pending.length} 件待处理 · ${subscriptions.length} 条订阅。

【全部储物单元清单（按房间分组，含未归位区）】
${roomBlocks.join('\n\n') || '（用户还没有任何房间）'}${globalBlock}
${pendingBlock}${subBlock}${eventsBlock}

【你能帮用户做什么】
1. 回答关于「待处理」「物品」「订阅」「提醒事件」的具体问题，引用上面的清单原文。
2. 推荐某类物品（如药品、文具、季节衣物）该放进哪个柜子；可基于已有内容判断同类聚集。
3. 提醒近期到期 / 逾期 / 即将扣款的事项；解释 critical 与 warn 的区别。
4. 给储物单元起更语义化的名字（仅当用户主动要重命名时输出 \`\`\`rename\`\`\` 块）。
5. 给出整理、分类、空间利用的简洁建议。

【重要：重命名建议的输出格式】
仅当用户明确请求重命名/改名时，在正文之后追加：
\`\`\`rename
[{"id":"<上面清单里的id原值>","newName":"建议名"}]
\`\`\`
id 必须严格使用 [id=xxx] 的原值；newName 控制在 12 个字以内；一次最多 8 条。其它情况下不要输出此代码块。

回答风格：简洁、有条理、说人话。引用具体物品/订阅时贴近清单中的命名，不要捏造不存在的条目。`;
}

export function extractRenameSuggestions(text: string): RenameSuggestion[] {
  const match = text.match(/```rename\s*([\s\S]*?)```/i);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]!.trim());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({ id: String(item.id || ''), newName: String(item.newName || '').trim() }))
      .filter((item) => item.id && item.newName)
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function stripRenameBlock(text: string): string {
  return text.replace(/```rename\s*[\s\S]*?```/gi, '').trim();
}

async function streamOpenAiCompat(
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  onDelta: (delta: string, full: string) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: 4096, temperature: 0.6, stream: true }),
    signal: abortSignal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API (${res.status}): ${err.slice(0, 200)}`);
  }
  if (!res.body) throw new Error('当前环境不支持流式响应');
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx = buffer.indexOf('\n\n');
    while (sepIdx !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      for (const line of rawEvent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return full;
        if (!payload) continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? '';
          if (delta) {
            full += delta;
            onDelta(delta, full);
          }
        } catch {
          // Ignore provider comment/heartbeat events.
        }
      }
      sepIdx = buffer.indexOf('\n\n');
    }
  }
  return full;
}

export async function streamChatWithAI(
  storage: Storage,
  messages: ChatMessage[],
  onDelta: (delta: string, full: string) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  const deepseekKey = await getConfig<string>(storage, 'deepseekKey', '');
  if (deepseekKey) {
    return streamOpenAiCompat(
      DEEPSEEK_API,
      deepseekKey,
      await getConfig<string>(storage, 'deepseekModel', 'deepseek-v4-flash'),
      messages,
      onDelta,
      abortSignal
    );
  }
  const openrouterKey = await getConfig<string>(storage, 'openrouterKey', '');
  if (openrouterKey) {
    return streamOpenAiCompat(
      OPENROUTER_API,
      openrouterKey,
      await getConfig<string>(storage, 'openrouterModel', 'google/gemini-2.5-flash'),
      messages,
      onDelta,
      abortSignal
    );
  }
  throw new Error('请先在设置页配置 DeepSeek 或 OpenRouter API Key');
}

export async function testTextAI(storage: Storage, provider: 'deepseek' | 'openrouter'): Promise<string> {
  const keyName = provider === 'deepseek' ? 'deepseekKey' : 'openrouterKey';
  const modelName = provider === 'deepseek' ? 'deepseekModel' : 'openrouterModel';
  const apiKey = await getConfig<string>(storage, keyName, '');
  if (!apiKey) throw new Error('请先填写 API Key');
  const url = provider === 'deepseek' ? DEEPSEEK_API : OPENROUTER_API;
  const model = await getConfig<string>(
    storage,
    modelName,
    provider === 'deepseek' ? 'deepseek-v4-flash' : 'google/gemini-2.5-flash'
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '用一句中文回复：连接正常。' }],
      max_tokens: 32,
    }),
  });
  if (!res.ok) throw new Error(`连接失败 (${res.status})：${(await res.text()).slice(0, 120)}`);
  return '连接正常';
}
