import type {
  Cabinet,
  Item,
  ItemList,
  ReminderEvent,
  Room,
  Subscription,
} from '../models';
import { GLOBAL_ROOM_ID, REMINDER_KIND_LABEL, SUB_CATEGORIES } from '../models';
import type { Storage } from '../storage/types';
import { getConfig } from '../storage/indexeddb';
import { apiAuthHeaders, apiUrl, getUserApiKey } from './apiBase';
import { isLooseCabinet } from './cabinet';
import { computeItemEvents, computeSubscriptionEvents } from './reminder';
import { subscriptionMonthlyCost } from './subscription';

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';

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
    .map((it) => `[itemId=${it.id}] ${it.name}${formatItemMeta(it)}`)
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
  ctx: ChatContext = {},
  itemLists: ItemList[] = []
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
      return `- [itemId=${it.id}] ${it.name}${formatItemMeta(it)} @ ${where}`;
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
    const formatSubLine = (s: Subscription) => {
      const cat = SUB_CAT_NAME[s.category] || s.category;
      const cycle = CYCLE_NAME[s.cycle] || s.cycle;
      const due = s.nextDueAt ? `下次 ${s.nextDueAt}` : '未设定';
      const extras = [
        s.planName ? `套餐 ${s.planName}` : '',
        s.autoRenew === false ? '不续费' : '',
        s.paymentMethod ? `支付 ${s.paymentMethod}` : '',
        s.url || s.cancelUrl ? '有管理/退订链接' : '缺管理链接',
        s.decision ? `决策 ${s.decision}` : '',
        s.usageNote ? `使用 ${s.usageNote}` : '',
        s.priceHistory?.length ? `价格历史 ${s.priceHistory.map((p) => `${p.date}:¥${p.amount}`).slice(-3).join('/')}` : '',
        s.status !== 'active' ? `状态 ${s.status}` : '',
      ].filter(Boolean);
      return `- [subId=${s.id}] ${s.name}（${cat}）¥${s.amount.toFixed(2)}/${cycle} · ${due}${
        extras.length ? ` · ${extras.join(' · ')}` : ''
      }`;
    };
    const subLines = active
      .slice()
      .sort(
        (a, b) =>
          new Date(a.nextDueAt || '2999-01-01').getTime() -
          new Date(b.nextDueAt || '2999-01-01').getTime()
      )
      .slice(0, 30)
      .map(formatSubLine);
    const pausedLines = paused.slice(0, 12).map(formatSubLine);
    subBlock = `\n【订阅（生效 ${active.length} 条，月均 ¥${monthly.toFixed(0)}${
      paused.length ? `；另暂停 ${paused.length} 条` : ''
    }）】\n${subLines.join('\n') || '（无生效订阅）'}${
      pausedLines.length ? `\n暂停/取消：\n${pausedLines.join('\n')}` : ''
    }`;
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

  // ===== ItemLists =====
  let listsBlock = '';
  if (itemLists.length) {
    const lines = itemLists.slice(0, 30).map((l) => {
      const validIds = l.itemIds.filter((id) => items.some((it) => it.id === id));
      const sample = validIds
        .slice(0, 4)
        .map((id) => items.find((it) => it.id === id)?.name || '')
        .filter(Boolean)
        .join('、');
      return `- [listId=${l.id}] ${l.emoji || '🧳'} ${l.name}（${validIds.length} 件${
        sample ? `：${sample}${validIds.length > 4 ? '…' : ''}` : ''
      }）`;
    });
    listsBlock = `\n【物品清单（共 ${itemLists.length} 个，手动维护）】\n${lines.join('\n')}`;
  }

  // ===== Current location =====
  const locationParts: string[] = [`今天是 ${today}`];
  if (ctx.currentPath) locationParts.push(`用户当前在页面 ${ctx.currentPath}`);
  if (ctx.currentRoomId && ctx.currentRoomId !== GLOBAL_ROOM_ID) {
    const r = rooms.find((rm) => rm.id === ctx.currentRoomId);
    if (r) locationParts.push(`正在浏览房间「${r.name}」`);
  }

  return `你是这个家居收纳应用的 AI 收纳与订阅管家。${locationParts.join('；')}。

【家庭概况】
${rooms.length} 个房间 · ${totalCabinets} 个储物单元 · ${placed.length} 件已归位 · ${pending.length} 件待处理 · ${subscriptions.length} 条订阅 · ${itemLists.length} 个清单。

【全部储物单元清单（按房间分组，含未归位区）】
${roomBlocks.join('\n\n') || '（用户还没有任何房间）'}${globalBlock}
${pendingBlock}${subBlock}${eventsBlock}${listsBlock}

【可跳转的页面（用 navigate 块输出）】
- /                        房间总览（首页）
- /views?tab=lists         清单总览
- /views?tab=tags          标签筛选
- /views?tab=cabinets      收纳柜入口
- /views/list/{listId}     某个清单的详情（itemIds 可在该页增删）
- /room/{roomId}           房间详情
- /search                  搜索
- /inbox                   待处理收集箱
- /overview                数据总览
- /subscribe               订阅
- /labels                  二维码标签
- /settings                设置

【你能帮用户做什么】
1. 回答关于「待处理」「物品」「订阅」「提醒事件」「清单」的具体问题，引用上面的清单原文。
2. 推荐某类物品（如药品、文具、季节衣物）该放进哪个柜子；可基于已有内容判断同类聚集。
3. 提醒近期到期 / 逾期 / 即将扣款的事项；解释 critical 与 warn 的区别。
4. 给储物单元起更语义化的名字（仅当用户主动要重命名时输出 \`\`\`rename\`\`\` 块）。
5. 当用户明确要求你"执行、批量归位、打标签、移动、更新、生成二维码标签"时，先用自然语言说明方案，然后追加 \`\`\`inventory_actions\`\`\` 块，让前端展示 diff 后由用户确认执行。
6. 作为订阅管家，帮用户从一句话、账单文本、CSV、邮件/短信/银行账单文本或扣款截图 OCR 文本中建立订阅；审计重复订阅、涨价、快续费、缺管理链接、年度大额续费、可暂停项；当用户明确要求"新增、更新、合并、暂停、恢复、取消、标记已付、批量处理订阅"时，先说明理由与影响，再追加 \`\`\`subscription_actions\`\`\` 块。
7. 当用户问"打开/进入/查看 xxx 页面/清单"或回答涉及"去看 xxx"的引导时，可在正文之后追加 \`\`\`navigate\`\`\` 块，前端会渲染按钮让用户点击跳转。

【重要：重命名建议的输出格式】
仅当用户明确请求重命名/改名时，在正文之后追加：
\`\`\`rename
[{"id":"<上面清单里的id原值>","newName":"建议名"}]
\`\`\`
id 必须严格使用 [id=xxx] 的原值；newName 控制在 12 个字以内；一次最多 8 条。其它情况下不要输出此代码块。

【重要：可执行操作的输出格式】
仅当用户明确要求更改数据时，在正文之后追加：
\`\`\`inventory_actions
{
  "summary": "一句话说明要做什么",
  "actions": [
    {"type":"moveItems","itemIds":["<itemId>"],"targetCabinetId":"<cabinet id 或 __room_loose__ 或 __global_loose__>","targetRoomId":"<移动到房间自由区时必填>"},
    {"type":"tagItems","itemIds":["<itemId>"],"tags":["药品"],"mode":"append"},
    {"type":"renameCabinet","cabinetId":"<id>","newName":"新名字"},
    {"type":"createLabels","targetType":"cabinet","targetIds":["<cabinet id>"]}
  ]
}
\`\`\`
只使用清单中出现过的 id；没有把握时不要输出操作块，改为询问用户确认。不要直接说"已完成"，因为需要用户点击应用。

【重要：订阅操作的输出格式】
仅当用户明确要求创建/修改/暂停/恢复/取消/标记订阅已付时，在正文之后追加：
\`\`\`subscription_actions
{
  "summary": "一句话说明要做什么",
  "actions": [
    {"type":"createSubscription","draft":{"name":"Netflix","category":"membership","amount":68,"cycle":"monthly","nextDueAt":"2026-05-20","paymentMethod":"招行信用卡","url":"https://...","note":"从账单文本识别","autoRenew":true}},
    {"type":"updateSubscription","subId":"<subId>","patch":{"amount":88,"nextDueAt":"2026-06-01","url":"https://...","cancelUrl":"https://...","decision":"review","usageNote":"最近少用，续费前确认","priceHistory":[{"amount":68,"date":"2026-05-01","note":"旧价格"},{"amount":88,"date":"2026-06-01","note":"新价格"}],"cancellationPlan":[{"id":"step-1","text":"打开账户设置"},{"id":"step-2","text":"关闭自动续费"}],"note":"价格上涨，续费前复核"}},
    {"type":"mergeSubscriptions","sourceSubId":"<重复项 subId>","targetSubId":"<保留项 subId>","patch":{"note":"合并重复订阅记录"}},
    {"type":"markPaid","subId":"<subId>"},
    {"type":"pauseSubscription","subId":"<subId>"},
    {"type":"resumeSubscription","subId":"<subId>"},
    {"type":"cancelSubscription","subId":"<subId>"}
  ]
}
\`\`\`
subId 必须严格使用上面订阅清单里的 [subId=xxx] 原值。category 只能是 software/loan/utility/rent/membership/insurance/telecom/other；cycle 只能是 weekly/monthly/quarterly/yearly/custom。日期必须是 yyyy-mm-dd。没有把握时不要输出操作块，改为询问用户确认。不要直接说"已完成"，因为需要用户点击应用。

【重要：跳转动作的输出格式】
当用户的问题适合跳到某个页面时（例如"打开旅行必备清单""去看待处理""列出所有食品"），在正文之后追加：
\`\`\`navigate
{"path":"/views/list/<listId>","reason":"打开你的旅行必备清单"}
\`\`\`
path 必须以 / 开头，使用上面"可跳转的页面"列表里的真实路径；listId 等占位必须替换为上面【物品清单】里出现过的 [listId=xxx] 原值。reason 控制在 14 字以内，作为按钮文案。一次最多 3 条；用户问题与跳转无关时，不要输出此块。

回答风格：简洁、有条理、说人话。引用具体物品/订阅/清单时贴近清单中的命名，不要捏造不存在的条目。`;
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
  provider: 'deepseek' | 'minimax' | 'openrouter',
  url: string,
  apiKey: string | undefined,
  model: string | undefined,
  messages: ChatMessage[],
  onDelta: (delta: string, full: string) => void,
  abortSignal?: AbortSignal
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
        ? { max_completion_tokens: 4096, thinking: { type: 'disabled' } }
        : { max_tokens: 4096 }),
      temperature: 0.6,
      stream: true,
    }),
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
  let lastError: unknown;
  try {
    return await streamOpenAiCompat(
      'deepseek',
      DEEPSEEK_API,
      undefined,
      (await getConfig<string>(storage, 'deepseekModel', '')) || undefined,
      messages,
      onDelta,
      abortSignal
    );
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    lastError = err;
    console.warn('DeepSeek chat failed, try MiniMax:', err);
  }

  try {
    return await streamOpenAiCompat(
      'minimax',
      MINIMAX_API,
      undefined,
      (await getConfig<string>(storage, 'minimaxModel', '')) || DEFAULT_MINIMAX_MODEL,
      messages,
      onDelta,
      abortSignal
    );
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    lastError = err;
    console.warn('MiniMax chat failed, try OpenRouter:', err);
  }

  try {
    return await streamOpenAiCompat(
      'openrouter',
      OPENROUTER_API,
      undefined,
      (await getConfig<string>(storage, 'openrouterModel', '')) || undefined,
      messages,
      onDelta,
      abortSignal
    );
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    console.warn('OpenRouter chat failed:', err);
    throw err instanceof Error ? err : lastError instanceof Error ? lastError : new Error('AI 对话失败');
  }
}

export async function testTextAI(
  storage: Storage,
  provider: 'deepseek' | 'minimax' | 'openrouter'
): Promise<string> {
  const modelName =
    provider === 'deepseek'
      ? 'deepseekModel'
      : provider === 'minimax'
        ? 'minimaxModel'
        : 'openrouterModel';
  const model =
    (await getConfig<string>(storage, modelName, '')) ||
    (provider === 'minimax' ? DEFAULT_MINIMAX_MODEL : undefined);
  const url = provider === 'deepseek' ? DEEPSEEK_API : provider === 'minimax' ? MINIMAX_API : OPENROUTER_API;
  const userKey = getUserApiKey(provider);
  if (provider === 'minimax' && !userKey) {
    throw new Error('MiniMax 官方 API Key 未配置');
  }
  const res = await fetch(userKey ? url : apiUrl(`/api/ai/${provider}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userKey ? { Authorization: `Bearer ${userKey}` } : apiAuthHeaders()),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '用一句中文回复：连接正常。' }],
      ...(provider === 'minimax'
        ? { max_completion_tokens: 32, thinking: { type: 'disabled' } }
        : { max_tokens: 32 }),
    }),
  });
  if (!res.ok) throw new Error(`连接失败 (${res.status})：${(await res.text()).slice(0, 120)}`);
  return '连接正常';
}
