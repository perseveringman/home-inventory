"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestItemSemantic = suggestItemSemantic;
const indexeddb_1 = require("../storage/indexeddb");
const apiBase_1 = require("./apiBase");
const semantic_1 = require("../utils/semantic");
const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';
function buildPrompt(input) {
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
function parseJson(text) {
    const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m)
        return null;
    try {
        const obj = JSON.parse(m[0]);
        let emoji = String(obj.emoji || '').trim();
        if (!emoji)
            return null;
        // 只取首个 grapheme，避免一串
        const seg = typeof Intl.Segmenter === 'function'
            ? new Intl.Segmenter('zh', { granularity: 'grapheme' })
            : null;
        if (seg) {
            const it = seg.segment(emoji)[Symbol.iterator]();
            const first = it.next();
            if (!first.done)
                emoji = first.value.segment;
        }
        if (!/\p{Extended_Pictographic}/u.test(emoji))
            return null;
        let hue = Math.round(Number(obj.hue));
        if (!Number.isFinite(hue))
            hue = 0;
        hue = ((hue % 360) + 360) % 360;
        return { emoji, hue };
    }
    catch {
        return null;
    }
}
async function callOpenAiCompat(provider, url, apiKey, model, prompt) {
    const key = apiKey || (0, apiBase_1.getUserApiKey)(provider) || undefined;
    const res = await fetch(key ? url : (0, apiBase_1.apiUrl)(`/api/ai/${provider}`), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(key ? { Authorization: `Bearer ${key}` } : (0, apiBase_1.apiAuthHeaders)()),
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            ...(provider === 'minimax'
                ? { max_completion_tokens: 120, reasoning_split: true }
                : { max_tokens: 120 }),
            temperature: 0.4,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`AI 配图失败 (${res.status})：${err.slice(0, 160)}`);
    }
    const data = await res.json();
    if (data.error)
        throw new Error(data.error.message || 'AI 配图返回错误');
    return data.choices?.[0]?.message?.content || '';
}
/**
 * 主入口：给定物品文本，返回 { emoji, hue }，永不抛错（失败回退本地启发）。
 */
async function suggestItemSemantic(storage, input) {
    const local = (0, semantic_1.inferItemSemantic)(input.name, input.tags || []);
    const prompt = buildPrompt(input);
    // DeepSeek 优先（便宜）
    try {
        const text = await callOpenAiCompat('deepseek', DEEPSEEK_API, undefined, (await (0, indexeddb_1.getConfig)(storage, 'deepseekModel', '')) || undefined, prompt);
        const parsed = parseJson(text);
        if (parsed)
            return { ...parsed, source: 'ai' };
    }
    catch (err) {
        console.warn('DeepSeek emoji suggestion failed:', err);
    }
    // MiniMax M3（国内 Token Plan）
    try {
        const text = await callOpenAiCompat('minimax', MINIMAX_API, undefined, (await (0, indexeddb_1.getConfig)(storage, 'minimaxModel', '')) || DEFAULT_MINIMAX_MODEL, prompt);
        const parsed = parseJson(text);
        if (parsed)
            return { ...parsed, source: 'ai' };
    }
    catch (err) {
        console.warn('MiniMax emoji suggestion failed:', err);
    }
    // OpenRouter（text only）
    try {
        const text = await callOpenAiCompat('openrouter', OPENROUTER_API, undefined, (await (0, indexeddb_1.getConfig)(storage, 'openrouterModel', '')) || undefined, prompt);
        const parsed = parseJson(text);
        if (parsed)
            return { ...parsed, source: 'ai' };
    }
    catch (err) {
        console.warn('OpenRouter emoji suggestion failed:', err);
    }
    return { ...local, source: 'local' };
}
