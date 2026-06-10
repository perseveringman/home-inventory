import {
  DEFAULT_DOUBAO_SEED_20_LITE_MODEL,
  apiAuthHeaders,
  apiUrl,
  fileToBase64,
  getUserApiKey,
} from '@home-inventory/core';

const DOUBAO_API = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

export interface NativeItemLLMInput {
  id: string;
  image: Blob;
}

export interface NativeItemLLMLabel {
  id: string;
  name?: string;
  category?: string;
}

export interface NativeItemLLMOptions {
  allowedCategories?: string[];
}

function dataUrl(blob: Blob, base64: string): string {
  return `data:${blob.type || 'image/jpeg'};base64,${base64}`;
}

async function timeoutSignal(ms: number): Promise<AbortSignal> {
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function prepareVisionBlob(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const maxSide = 480;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.fillStyle = '#f7f7f7';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((next) => resolve(next || blob), 'image/jpeg', 0.82);
    });
  } catch {
    return blob;
  }
}

function normalizeAllowedCategories(categories: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const category of categories) {
    const value = category.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result.slice(0, 60);
}

function coerceAllowedCategory(value: string, allowedCategories: string[]): string | undefined {
  const category = value.trim();
  if (!category) return undefined;
  if (!allowedCategories.length) return category.slice(0, 24);

  const exact = allowedCategories.find((allowed) => allowed === category);
  if (exact) return exact;

  const normalized = category.replace(/\s+/g, '').toLowerCase();
  const normalizedMatch = allowedCategories.find((allowed) => allowed.replace(/\s+/g, '').toLowerCase() === normalized);
  if (normalizedMatch) return normalizedMatch;

  const containsMatch = allowedCategories.find((allowed) => {
    const normalizedAllowed = allowed.replace(/\s+/g, '').toLowerCase();
    return normalized.includes(normalizedAllowed) || normalizedAllowed.includes(normalized);
  });
  if (containsMatch) return containsMatch;

  const aliases: Record<string, string[]> = {
    药品: ['药物', '药', '医药'],
    保健品: ['营养品', '补剂', '保健'],
    食品: ['食物', '食材', '粮油', '调料', '水果', '蔬菜', '生鲜'],
    零食: ['小吃', '糖果', '饼干'],
    饮料: ['饮品', '酒水'],
    数码: ['电子产品', '电子设备', '手机配件', '电脑配件'],
    家电: ['电器', '小家电', '家用电器'],
    衣物: ['服装', '衣服', '鞋帽'],
    书籍: ['图书', '书本', '书'],
    文具: ['办公用品', '学习用品'],
    工具: ['五金', '维修工具', '清洁工具'],
    玩具: ['游戏用品'],
    美妆: ['化妆品', '护肤品', '洗护'],
    日用: ['生活用品', '家居用品', '个护', '清洁用品', '收纳用品'],
    厨具: ['厨房用品', '餐具', '锅具', '炊具'],
  };
  for (const allowed of allowedCategories) {
    const aliasMatch = (aliases[allowed] || []).some((alias) => normalized.includes(alias.replace(/\s+/g, '').toLowerCase()));
    if (aliasMatch) return allowed;
  }

  return undefined;
}

function buildMessages(items: Array<{ id: string; blob: Blob; base64: string }>, allowedCategories: string[]) {
  const ids = items.map((item) => item.id).join(', ');
  const categoryPrompt = allowedCategories.length
    ? `category 必须且只能从这个标签列表中选择一个：${allowedCategories.join('、')}。`
    : 'category 写最接近的中文分类。';
  const content: any[] = [
    {
      type: 'text',
      text: `识别这些物品图。只返回 JSON：{"items":[{"id":"...","name":"中文物品名","category":"标签"}]}。${categoryPrompt}必须使用这些 id：${ids}。不要解释。`,
    },
  ];
  for (const item of items) {
    content.push({ type: 'text', text: `id: ${item.id}` });
    content.push({ type: 'image_url', image_url: { url: dataUrl(item.blob, item.base64) } });
  }
  return [{ role: 'user', content }];
}

function parseLabels(text: string, ids: string[], allowedCategories: string[]): NativeItemLLMLabel[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/) || cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let payload: any;
  try {
    payload = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const rawItems = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
  return rawItems
    .map((entry: any, index: number) => {
      const category = coerceAllowedCategory(String(entry?.category || ''), allowedCategories);
      return {
        id: String(entry?.id || ids[index] || '').trim(),
        name: String(entry?.name || '').trim().slice(0, 24),
        category,
      };
    })
    .filter((entry: NativeItemLLMLabel) => entry.id && (entry.name || entry.category));
}

async function callDoubao(messages: any[], signal: AbortSignal): Promise<string> {
  const effectiveKey = getUserApiKey('doubao') || undefined;
  const res = await fetch(effectiveKey ? DOUBAO_API : apiUrl('/api/ai/doubao'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : apiAuthHeaders()),
    },
    signal,
    body: JSON.stringify({
      model: DEFAULT_DOUBAO_SEED_20_LITE_MODEL,
      service_tier: 'fast',
      messages,
      max_tokens: 360,
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`Doubao item label failed: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || data.raw || '';
}

async function callMiniMax(messages: any[], signal: AbortSignal): Promise<string> {
  const effectiveKey = getUserApiKey('minimax') || undefined;
  const res = await fetch(effectiveKey ? MINIMAX_API : apiUrl('/api/ai/minimax'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : apiAuthHeaders()),
    },
    signal,
    body: JSON.stringify({
      model: 'MiniMax-M3',
      messages,
      max_completion_tokens: 360,
      thinking: { type: 'disabled' },
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`MiniMax item label failed: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenRouter(messages: any[], signal: AbortSignal): Promise<string> {
  const effectiveKey = getUserApiKey('openrouter') || undefined;
  const res = await fetch(effectiveKey ? OPENROUTER_API : apiUrl('/api/ai/openrouter'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : apiAuthHeaders()),
    },
    signal,
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages,
      max_tokens: 360,
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter item label failed: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function recognizeNativeItemLabels(
  items: NativeItemLLMInput[],
  options: NativeItemLLMOptions = {}
): Promise<NativeItemLLMLabel[]> {
  const usable = items.filter((item) => item.id && item.image.size > 0).slice(0, 12);
  if (!usable.length) return [];
  const allowedCategories = normalizeAllowedCategories(options.allowedCategories);

  const prepared = await Promise.all(
    usable.map(async (item) => {
      const blob = await prepareVisionBlob(item.image);
      return {
        id: item.id,
        blob,
        base64: await fileToBase64(blob),
      };
    })
  );
  const messages = buildMessages(prepared, allowedCategories);
  const ids = prepared.map((item) => item.id);

  const providers = [callDoubao, callMiniMax, callOpenRouter];
  for (const provider of providers) {
    try {
      const signal = await timeoutSignal(12000);
      const text = await provider(messages, signal);
      const labels = parseLabels(text, ids, allowedCategories);
      if (labels.length) return labels;
    } catch (err) {
      console.warn('Native item LLM label failed, try next provider:', err);
    }
  }
  return [];
}
