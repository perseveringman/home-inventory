/**
 * AI 自动配图服务：根据物品名称 / 标签 / 备注，让 AI 推断一个最合适的 emoji
 * 和主色调（hue 0~360），由前端用 Canvas 合成漂亮的语义缩略图。
 *
 * 优先：DeepSeek（便宜快） → MiniMax M3 → OpenRouter (text only) → 本地启发式。
 * 完全文本协议，不消耗 vision 配额。
 */
import type { Storage } from '../storage/types';
import { getConfig } from '../storage/indexeddb';
import { apiAuthHeaders, apiUrl, getUserApiKey } from './apiBase';
import { inferItemSemantic, type SemanticGuess } from '../utils/semantic';

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';

export interface AiSemanticInput {
  name: string;
  tags?: string[];
  note?: string;
}

function buildPrompt(input: AiSemanticInput): string {
  return `你是一个家居物品的"图标设计师"。给定一个物品的名称（可能还有标签和备注），
请推断一个最合适的单 emoji，以及一个 0~360 的主色调（hue）用于背景。

要求：
1. 只输出 JSON：{"emoji":"🍎","hue":12,"reason":"…"}。
2. emoji 必须是 1 个 Unicode emoji（可以含变体选择符），不要 ascii、不要文字、不要多个。
3. hue 是整数，0=红 / 30=橙 / 50=黄 / 130=绿 / 200=青 / 240=蓝 / 280=紫 / 330=粉。
4. 颜色应贴合物品本身的真实印象（番茄→0、香蕉→50、薄荷→145、海盐→200）。
5. reason 不超过 20 字。

物品名称：${input.name}
标签：${(input.tags || []).join('、') || '（无）'}
备注：${(input.note || '').slice(0, 80) || '（无）'}`;
}

function parseJson(text: string): { emoji: string; hue: number } | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    let emoji = String(obj.emoji || '').trim();
    if (!emoji) return null;
    // 只取首个 grapheme，避免一串
    const seg =
      typeof (Intl as any).Segmenter === 'function'
        ? new (Intl as any).Segmenter('zh', { granularity: 'grapheme' })
        : null;
    if (seg) {
      const it = seg.segment(emoji)[Symbol.iterator]();
      const first = it.next();
      if (!first.done) emoji = first.value.segment;
    }
    if (!/\p{Extended_Pictographic}/u.test(emoji)) return null;
    let hue = Math.round(Number(obj.hue));
    if (!Number.isFinite(hue)) hue = 0;
    hue = ((hue % 360) + 360) % 360;
    return { emoji, hue };
  } catch {
    return null;
  }
}

async function callOpenAiCompat(
  provider: 'deepseek' | 'minimax' | 'openrouter',
  url: string,
  apiKey: string | undefined,
  model: string | undefined,
  prompt: string
): Promise<string> {
  const key = apiKey || getUserApiKey(provider) || undefined;
  if (provider === 'minimax' && !key) {
    throw new Error('MiniMax 官方 API Key 未配置，跳过 MiniMax 直连');
  }
  const res = await fetch(key ? url : apiUrl(`/api/ai/${provider}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : apiAuthHeaders()),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      ...(provider === 'minimax'
        ? { max_completion_tokens: 120, thinking: { type: 'disabled' } }
        : { max_tokens: 120 }),
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI 配图失败 (${res.status})：${err.slice(0, 160)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'AI 配图返回错误');
  if (data.base_resp?.status_code) {
    throw new Error(data.base_resp.status_msg || `MiniMax 返回错误 ${data.base_resp.status_code}`);
  }
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 主入口：给定物品文本，返回 { emoji, hue }，永不抛错（失败回退本地启发）。
 */
export async function suggestItemSemantic(
  storage: Storage,
  input: AiSemanticInput
): Promise<SemanticGuess & { source: 'ai' | 'local' }> {
  const local = inferItemSemantic(input.name, input.tags || []);
  const prompt = buildPrompt(input);

  // DeepSeek 优先（便宜）
  try {
    const text = await callOpenAiCompat(
      'deepseek',
      DEEPSEEK_API,
      undefined,
      (await getConfig<string>(storage, 'deepseekModel', '')) || undefined,
      prompt
    );
    const parsed = parseJson(text);
    if (parsed) return { ...parsed, source: 'ai' };
  } catch (err) {
    console.warn('DeepSeek emoji suggestion failed:', err);
  }

  // MiniMax M3（国内 Token Plan）
  try {
    const text = await callOpenAiCompat(
      'minimax',
      MINIMAX_API,
      undefined,
      (await getConfig<string>(storage, 'minimaxModel', '')) || DEFAULT_MINIMAX_MODEL,
      prompt
    );
    const parsed = parseJson(text);
    if (parsed) return { ...parsed, source: 'ai' };
  } catch (err) {
    console.warn('MiniMax emoji suggestion failed:', err);
  }

  // OpenRouter（text only）
  try {
    const text = await callOpenAiCompat(
      'openrouter',
      OPENROUTER_API,
      undefined,
      (await getConfig<string>(storage, 'openrouterModel', '')) || undefined,
      prompt
    );
    const parsed = parseJson(text);
    if (parsed) return { ...parsed, source: 'ai' };
  } catch (err) {
    console.warn('OpenRouter emoji suggestion failed:', err);
  }

  return { ...local, source: 'local' };
}
