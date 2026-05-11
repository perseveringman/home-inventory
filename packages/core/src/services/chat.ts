import type { Cabinet, Item, Room } from '../models';
import type { Storage } from '../storage/types';
import { getConfig } from '../storage/indexeddb';
import { isLooseCabinet } from './cabinet';

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

export function buildChatSystemPrompt(rooms: Room[], cabinets: Cabinet[], items: Item[]): string {
  const itemsByCabinet = new Map<string, Item[]>();
  for (const item of items) {
    if (!itemsByCabinet.has(item.cabinetId)) itemsByCabinet.set(item.cabinetId, []);
    itemsByCabinet.get(item.cabinetId)!.push(item);
  }
  const blocks = rooms
    .map((room) => {
      const roomCabinets = cabinets.filter((cabinet) => cabinet.roomId === room.id && !isLooseCabinet(cabinet));
      if (!roomCabinets.length) return `### ${room.name}\n（无储物单元）`;
      return `### ${room.name}（${roomCabinets.length} 个储物单元）\n${roomCabinets
        .map((cabinet, index) => {
          const cabinetItems = itemsByCabinet.get(cabinet.id) || [];
          const names = cabinetItems.length
            ? cabinetItems
                .slice(0, 12)
                .map((item) => `${item.name}${item.qty > 1 ? `×${item.qty}` : ''}`)
                .join('、') + (cabinetItems.length > 12 ? `… 等共 ${cabinetItems.length} 件` : '')
            : '（暂无物品）';
          return `${index + 1}. [id=${cabinet.id}] ${cabinet.name}：${names}`;
        })
        .join('\n')}`;
    })
    .join('\n\n');
  const totalCabinets = cabinets.filter((cabinet) => !isLooseCabinet(cabinet)).length;
  const totalItems = items.filter((item) => item.status !== 'pending').length;
  return `你是家居收纳整理助手。用户家中共 ${rooms.length} 个房间、${totalCabinets} 个储物单元、${totalItems} 件物品。

【全部储物单元清单（按房间分组）】
${blocks || '（用户还没有标注任何储物单元）'}

【你能帮用户做什么】
1. 给储物单元起更语义化的名字。
2. 推荐某类物品该放进哪个柜子。
3. 给出整理、分类、高低频放置、空间利用建议。
4. 跨房间梳理可以归并或明显偏离主题的物品。

【重要：重命名建议的输出格式】
当你建议重命名储物单元时，必须在回复正文之后追加 JSON 代码块：
\`\`\`rename
[{"id":"<上面清单里的id原值>","newName":"建议名"}]
\`\`\`
id 必须严格使用 [id=xxx] 的原值；newName 控制在 12 个字以内；一次最多 8 条。

回答风格：简洁、有条理、说人话。`;
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
