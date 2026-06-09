"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferSubCategory = inferSubCategory;
exports.inferSubCycle = inferSubCycle;
exports.buildSubscriptionImportPlanFromText = buildSubscriptionImportPlanFromText;
exports.buildSubscriptionImportPlanFromCsv = buildSubscriptionImportPlanFromCsv;
exports.buildSubscriptionImportPrompt = buildSubscriptionImportPrompt;
exports.recognizeSubscriptionBillImage = recognizeSubscriptionBillImage;
exports.recognizeSubscriptionFromImage = recognizeSubscriptionFromImage;
exports.buildVoiceSubscriptionDraft = buildVoiceSubscriptionDraft;
exports.recognizeSubscriptionFromVoice = recognizeSubscriptionFromVoice;
const models_1 = require("../models");
const image_1 = require("../utils/image");
const id_1 = require("../utils/id");
const subscriptionActions_1 = require("./subscriptionActions");
const apiBase_1 = require("./apiBase");
const MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash';
function pickVisionProvider(explicitApiKey) {
    if (explicitApiKey || (0, apiBase_1.getUserApiKey)('minimax'))
        return 'minimax';
    if ((0, apiBase_1.getUserApiKey)('openrouter'))
        return 'openrouter';
    return 'openrouter';
}
function providerUrl(provider) {
    if (provider === 'minimax')
        return MINIMAX_API;
    if (provider === 'deepseek')
        return 'https://api.deepseek.com/chat/completions';
    return OPENROUTER_API;
}
function providerDefaultModel(provider) {
    if (provider === 'minimax')
        return DEFAULT_MINIMAX_MODEL;
    if (provider === 'openrouter')
        return DEFAULT_OPENROUTER_MODEL;
    return undefined;
}
const CATEGORY_BY_NAME = [
    [/chatgpt|cursor|notion|figma|github|vercel|icloud|dropbox|云|软件|工具|app|saas/i, 'software'],
    [/房贷|贷款|车贷|分期/i, 'loan'],
    [/电费|水费|燃气|煤气|宽带|物业/i, 'utility'],
    [/房租|租金/i, 'rent'],
    [/会员|自动续费|包月|netflix|spotify|youtube|bilibili|腾讯视频|爱奇艺|优酷|盒马|山姆|买菜|美团|饿了么/i, 'membership'],
    [/保险|医保|车险|寿险/i, 'insurance'],
    [/移动|联通|电信|话费|流量|手机|通讯/i, 'telecom'],
];
const CYCLE_BY_TEXT = [
    [/每周|周付|weekly/i, 'weekly'],
    [/每季|季度|quarter/i, 'quarterly'],
    [/每年|年度|年费|包年|年卡|year/i, 'yearly'],
    [/自定义|custom/i, 'custom'],
    [/每月|月付|月费|包月|月卡|月度|按月|monthly|month/i, 'monthly'],
];
function categoryFromText(text) {
    return CATEGORY_BY_NAME.find(([re]) => re.test(text))?.[1] || 'other';
}
function cycleFromText(text) {
    return CYCLE_BY_TEXT.find(([re]) => re.test(text))?.[1] || 'monthly';
}
/** 公开给语音/搜索入口复用的轻量推断器 */
function inferSubCategory(text) {
    return categoryFromText(text);
}
function inferSubCycle(text) {
    return cycleFromText(text);
}
function cleanCell(value) {
    return String(value || '').trim().replace(/^"|"$/g, '').replace(/""/g, '"');
}
function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === '"' && quoted && next === '"') {
            cell += '"';
            i += 1;
            continue;
        }
        if (ch === '"') {
            quoted = !quoted;
            continue;
        }
        if (ch === ',' && !quoted) {
            row.push(cleanCell(cell));
            cell = '';
            continue;
        }
        if ((ch === '\n' || ch === '\r') && !quoted) {
            if (ch === '\r' && next === '\n')
                i += 1;
            row.push(cleanCell(cell));
            if (row.some(Boolean))
                rows.push(row);
            row = [];
            cell = '';
            continue;
        }
        cell += ch;
    }
    row.push(cleanCell(cell));
    if (row.some(Boolean))
        rows.push(row);
    return rows;
}
function normalizeHeader(header) {
    const key = header.trim().toLowerCase();
    if (/名称|name|商户|项目|服务/.test(key))
        return 'name';
    if (/套餐|plan/.test(key))
        return 'planName';
    if (/金额|amount|price|扣款/.test(key))
        return 'amount';
    if (/周期|cycle|频率/.test(key))
        return 'cycle';
    if (/下次|next|due|扣款日/.test(key))
        return 'nextDueAt';
    if (/开始|start/.test(key))
        return 'startedAt';
    if (/结束|end/.test(key))
        return 'endAt';
    if (/分类|类型|category/.test(key))
        return 'category';
    if (/支付|payment|卡|账户/.test(key))
        return 'paymentMethod';
    if (/链接|url|管理|退订/.test(key))
        return 'url';
    if (/备注|note|说明/.test(key))
        return 'note';
    if (/来源|source/.test(key))
        return 'source';
    return key;
}
function parseAmount(text) {
    const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Math.abs(Number(match[0])) : 0;
}
function parseDate(text) {
    const iso = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/);
    if (iso) {
        const [y, m, d] = iso[0].split(/[-/]/).map(Number);
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const md = text.match(/(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*日?/);
    if (md) {
        const year = new Date().getFullYear();
        return `${year}-${String(Number(md[1])).padStart(2, '0')}-${String(Number(md[2])).padStart(2, '0')}`;
    }
    return undefined;
}
function detectSourceFromText(text) {
    if (/短信|验证码|【[^】]+】/.test(text))
        return 'sms';
    if (/邮件|发件人|收件人|subject|from:/i.test(text))
        return 'email';
    if (/银行|信用卡|储蓄卡|账单|交易|扣款|入账|支出|零钱|微信支付|支付宝/i.test(text))
        return 'bank';
    return 'ai_text';
}
function valueAfterLabel(text, labels) {
    const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const match = text.match(new RegExp(`(?:${labelPattern})\\s*[:：]?\\s*([^\\n\\r]+)`, 'i'));
    return cleanCell(match?.[1]);
}
function extractNameFromText(text) {
    const labelled = valueAfterLabel(text, ['续费项目', '订阅项目', '扣款项目', '项目名称', '商品名称', '服务名称', '会员名称', '项目']);
    if (labelled)
        return labelled.replace(/微信自动续费|自动续费|续费成功|续费凭证/g, '').trim() || labelled;
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const candidate = lines.find((line) => !/^(续费凭证|续费金额|金额|支付方式|付款方式|续费方式)$/i.test(line) &&
        !/^[-+]?¥?\s*\d+(?:\.\d+)?$/.test(line) &&
        /(会员|订阅|自动续费|包月|包年|月卡|年卡|续费)/.test(line));
    if (candidate) {
        return candidate
            .replace(/^(续费项目|订阅项目|扣款项目|项目名称|商品名称|服务名称)\s*[:：]?\s*/i, '')
            .replace(/微信自动续费|自动续费|续费成功|续费凭证/g, '')
            .trim() || candidate;
    }
    return undefined;
}
function extractAmountFromText(text) {
    const labelled = valueAfterLabel(text, ['续费金额', '扣款金额', '支付金额', '金额', '合计', '实付']);
    const amount = parseAmount(labelled || '');
    if (amount > 0)
        return amount;
    const money = text.match(/[¥￥]\s*-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:元|块钱|块)/);
    return money ? parseAmount(money[0]) : 0;
}
function extractPaymentMethodFromText(text) {
    return valueAfterLabel(text, ['续费方式', '支付方式', '付款方式', '扣款方式', '支付账户', '付款账户']);
}
function buildSubscriptionImportPlanFromText(text, source = detectSourceFromText(text)) {
    const normalized = text.trim();
    if (!normalized)
        return null;
    const amount = extractAmountFromText(normalized);
    const name = extractNameFromText(normalized);
    if (!name || amount <= 0)
        return null;
    const nextDueAt = parseDate(normalized);
    const importBatchId = (0, id_1.uid)();
    return {
        summary: `从账单文本识别 1 条订阅草稿`,
        actions: [
            {
                type: 'createSubscription',
                draft: {
                    name,
                    category: categoryFromText(normalized),
                    amount,
                    cycle: cycleFromText(normalized),
                    nextDueAt,
                    paymentMethod: extractPaymentMethodFromText(normalized),
                    source,
                    confidence: 0.82,
                    evidenceText: normalized.slice(0, 1200),
                    importBatchId,
                    note: nextDueAt ? undefined : '原始文本未包含明确的下次扣款日，请确认后补充。',
                },
            },
        ],
    };
}
function buildSubscriptionImportPlanFromCsv(text, source = 'csv') {
    const rows = parseCsvRows(text);
    if (rows.length < 2)
        return null;
    const headers = rows[0].map(normalizeHeader);
    const importBatchId = (0, id_1.uid)();
    const actions = rows.slice(1).map((row) => {
        const record = Object.fromEntries(headers.map((h, i) => [h, cleanCell(row[i])]));
        const name = record.name || record['0'];
        if (!name)
            return null;
        const amount = parseAmount(record.amount || '');
        const nextDueAt = parseDate(record.nextDueAt || record.note || '');
        const category = models_1.SUB_CATEGORIES.some((cat) => cat.id === record.category)
            ? record.category
            : categoryFromText(`${name} ${record.category || ''} ${record.note || ''}`);
        const cycle = cycleFromText(`${record.cycle || ''} ${record.note || ''}`);
        return {
            type: 'createSubscription',
            draft: {
                name,
                planName: record.planName || undefined,
                category,
                amount,
                cycle,
                nextDueAt,
                startedAt: parseDate(record.startedAt || ''),
                endAt: parseDate(record.endAt || ''),
                paymentMethod: record.paymentMethod || undefined,
                url: record.url || undefined,
                cancelUrl: /退订|cancel/i.test(record.url || '') ? record.url : undefined,
                note: record.note || undefined,
                source,
                confidence: 0.8,
                evidenceText: row.join(', '),
                importBatchId,
            },
        };
    }).filter(Boolean);
    if (!actions.length)
        return null;
    return {
        summary: `从 ${source === 'csv' ? 'CSV' : source} 导入 ${actions.length} 条订阅草稿`,
        actions,
    };
}
function buildSubscriptionImportPrompt(text, source = 'ai_text') {
    return `请从下面的${source === 'sms' ? '短信' : source === 'email' ? '邮件' : source === 'bank' ? '银行账单' : '账单文本'}中识别订阅/周期性扣款，生成可确认执行的 subscription_actions。

要求：
1. 只把明确的周期性订阅、会员、房租、贷款、水电、保险、通讯账单建成 createSubscription。
2. 如果疑似与已有订阅重复，请优先输出 mergeSubscriptions 或 updateSubscription，不要重复创建。
3. draft.source 设为 "${source}"，confidence 用 0~1 表示把握，evidenceText 保存原文关键证据。
4. 不确定下次扣款日时可以省略 nextDueAt，但要在正文里说明缺失。

账单文本：
${text.slice(0, 12000)}`;
}
async function recognizeSubscriptionBillImage(blob, options = {}) {
    const base64 = await (0, image_1.fileToBase64)(blob);
    const mediaType = blob.type || 'image/jpeg';
    const prompt = `你是订阅账单截图识别助手。请阅读截图里的扣款、账单、短信或邮件内容，识别周期性订阅或定期账单。

只输出 subscription_actions 代码块，前面可以用一句中文说明识别结果。schema:
\`\`\`subscription_actions
{
  "summary": "从截图识别 N 条订阅草稿",
  "actions": [
    {"type":"createSubscription","draft":{"name":"服务名","category":"software","amount":21,"cycle":"monthly","nextDueAt":"2026-05-28","paymentMethod":"Apple Pay","source":"ai_vision","confidence":0.86,"evidenceText":"截图中的关键文字"}}
  ]
}
\`\`\`

category 只能是 software/loan/utility/rent/membership/insurance/telecom/other；cycle 只能是 weekly/monthly/quarterly/yearly/custom；日期必须 yyyy-mm-dd。没有足够证据时不要创建。`;
    const provider = pickVisionProvider(options.apiKey);
    const effectiveKey = options.apiKey || (0, apiBase_1.getUserApiKey)(provider) || undefined;
    const res = await fetch(effectiveKey ? providerUrl(provider) : (0, apiBase_1.apiUrl)(`/api/ai/${provider}`), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : (0, apiBase_1.apiAuthHeaders)()),
        },
        body: JSON.stringify({
            model: options.model || providerDefaultModel(provider),
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
                    ],
                },
            ],
            ...(provider === 'minimax'
                ? { max_completion_tokens: 2048, thinking: { type: 'disabled' } }
                : { max_tokens: 2048 }),
            temperature: 0.2,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`截图识别失败 (${res.status})：${err.slice(0, 160)}`);
    }
    const data = await res.json();
    if (data.error)
        throw new Error(data.error.message || '截图识别返回错误');
    if (data.base_resp?.status_code) {
        throw new Error(data.base_resp.status_msg || `MiniMax 返回错误 ${data.base_resp.status_code}`);
    }
    const text = data.choices?.[0]?.message?.content || data.raw || '';
    return (0, subscriptionActions_1.extractSubscriptionActionPlan)(String(text));
}
/* ===================== 单条订阅：图片识别 ===================== */
/**
 * 从一张图片识别「单条」订阅信息，给「图片添加订阅」入口用。
 * 图片可以是：App Store 应用截图、订阅管理页、扣款短信/邮件截图、账单。
 * 返回结构化草稿字段（不是 action plan），便于直接灌进添加表单让用户确认。
 */
async function recognizeSubscriptionFromImage(blob, options = {}) {
    const base64 = await (0, image_1.fileToBase64)(blob);
    const mediaType = blob.type || 'image/jpeg';
    const prompt = `你是订阅识别助手。请看这张图片（可能是 App Store 应用页、订阅管理页、扣款短信/邮件、银行账单），识别出**一条**最主要的周期性订阅 / 会员 / 定期账单。

只输出一个 JSON 代码块，不要多余文字：
\`\`\`json
{
  "name": "服务/应用名（必填，如 Netflix、iCloud+、爱奇艺）",
  "planName": "套餐名，如 高级版 / 家庭版（没有则省略）",
  "category": "software|loan|utility|rent|membership|insurance|telecom|other",
  "amount": 数字金额（人民币，没有则 0）,
  "cycle": "weekly|monthly|quarterly|yearly|custom",
  "nextDueAt": "yyyy-mm-dd（下次扣款日，不确定则省略）",
  "paymentMethod": "支付方式，如 Apple Pay / 招行信用卡（没有则省略）",
  "confidence": 0~1 的把握度,
  "evidenceText": "图片里支撑判断的关键文字"
}
\`\`\`
只识别一条最主要的订阅；金额识别不到时填 0；信息缺失的字段直接省略，不要编造。`;
    const provider = pickVisionProvider(options.apiKey);
    const effectiveKey = options.apiKey || (0, apiBase_1.getUserApiKey)(provider) || undefined;
    const res = await fetch(effectiveKey ? providerUrl(provider) : (0, apiBase_1.apiUrl)(`/api/ai/${provider}`), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : (0, apiBase_1.apiAuthHeaders)()),
        },
        body: JSON.stringify({
            model: options.model || providerDefaultModel(provider),
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
                    ],
                },
            ],
            ...(provider === 'minimax'
                ? { max_completion_tokens: 1024, thinking: { type: 'disabled' } }
                : { max_tokens: 1024 }),
            temperature: 0.2,
        }),
        signal: options.signal,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`图片识别失败 (${res.status})：${err.slice(0, 160)}`);
    }
    const data = await res.json();
    if (data.error)
        throw new Error(data.error.message || '图片识别返回错误');
    if (data.base_resp?.status_code) {
        throw new Error(data.base_resp.status_msg || `MiniMax 返回错误 ${data.base_resp.status_code}`);
    }
    const text = String(data.choices?.[0]?.message?.content || data.raw || '');
    return parseDraftJson(text, 'ai_vision');
}
function parseDraftJson(text, source) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i) || text.match(/(\{[\s\S]*\})/);
    if (!match)
        return null;
    try {
        const raw = JSON.parse(match[1].trim());
        const name = String(raw?.name || '').trim();
        if (!name)
            return null;
        const categoryOk = models_1.SUB_CATEGORIES.some((c) => c.id === raw?.category);
        const cycleOk = ['weekly', 'monthly', 'quarterly', 'yearly', 'custom'].includes(raw?.cycle);
        return {
            name: name.slice(0, 80),
            planName: raw?.planName ? String(raw.planName).slice(0, 80) : undefined,
            category: categoryOk ? raw.category : categoryFromText(`${name} ${raw?.evidenceText || ''}`),
            amount: parseAmount(String(raw?.amount ?? '')) || 0,
            cycle: cycleOk ? raw.cycle : cycleFromText(`${name} ${raw?.evidenceText || ''}`),
            nextDueAt: parseDate(String(raw?.nextDueAt || '')),
            paymentMethod: raw?.paymentMethod ? String(raw.paymentMethod).slice(0, 80) : undefined,
            source,
            confidence: typeof raw?.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.75,
            evidenceText: raw?.evidenceText ? String(raw.evidenceText).slice(0, 1200) : undefined,
        };
    }
    catch {
        return null;
    }
}
/* ===================== 单条订阅：语音描述解析 ===================== */
/**
 * 把 iOS 实时语音转写出来的整句订阅描述，先做一轮本地规则解析（离线、零延迟），
 * 抽出名称、金额、周期、日期、支付方式。识别不全时上层可再交给 LLM 补全。
 *
 * 例："我开了爱奇艺黄金会员，每个月 25 块，下个月 8 号扣费，用微信付的"
 */
function buildVoiceSubscriptionDraft(transcript) {
    const text = transcript.trim();
    if (!text)
        return null;
    const amount = extractAmountFromText(text);
    const cycle = cycleFromText(text);
    const nextDueAt = parseDate(text) || parseSpokenRelativeDate(text);
    const paymentMethod = extractSpokenPayment(text);
    const name = extractSpokenName(text);
    if (!name)
        return null;
    return {
        name,
        category: categoryFromText(text),
        amount,
        cycle,
        nextDueAt,
        paymentMethod,
        source: 'ai_text',
        confidence: amount > 0 && nextDueAt ? 0.8 : 0.6,
        evidenceText: text.slice(0, 600),
    };
}
/** 从口语里抽订阅名：去掉「我开了/我订了/订阅了」等前缀和金额/周期描述 */
function extractSpokenName(text) {
    const labelled = valueAfterLabel(text, ['订阅', '开通', '开了', '续费', '叫做', '名字是', '名称是', '服务是']);
    let candidate = labelled || text;
    candidate = candidate
        .replace(/^(我|帮我|记一下|记录|这是)?\s*(开通了?|订阅了?|开了|订了|续费了?|买了?)\s*/g, '')
        .split(/[，,。.；;\n]/)[0]
        .replace(/(每个?月|每周|每季度?|每年|月付|年付|包月|包年|月费|年费).*$/g, '')
        .replace(/[¥￥]?\s*\d+(?:\.\d+)?\s*(块钱?|元|块)?.*$/g, '')
        .replace(/(微信|支付宝|apple\s*pay|信用卡|储蓄卡|银行卡).*$/gi, '')
        .replace(/会员$/g, '会员')
        .trim();
    return candidate ? candidate.slice(0, 60) : undefined;
}
const SPOKEN_PAY_MAP = [
    [/微信/, '微信'],
    [/支付宝/, '支付宝'],
    [/apple\s*pay|苹果支付/i, 'Apple Pay'],
    [/招行|招商/i, '招商银行'],
    [/(信用卡)/, '信用卡'],
    [/(储蓄卡|借记卡)/, '储蓄卡'],
];
function extractSpokenPayment(text) {
    return SPOKEN_PAY_MAP.find(([re]) => re.test(text))?.[1];
}
/** 解析「下个月8号 / 这个月底 / 26号 / 每月15号」之类的口语日期 */
function parseSpokenRelativeDate(text) {
    const now = new Date();
    const dayMatch = text.match(/(?:每个?月|这个?月|下个?月)?\s*(\d{1,2})\s*[号日]/);
    if (dayMatch) {
        const day = Number(dayMatch[1]);
        if (day >= 1 && day <= 31) {
            let month = now.getMonth();
            let year = now.getFullYear();
            if (/下个?月/.test(text))
                month += 1;
            // 若是本月且日期已过，顺延到下月
            else if (day < now.getDate() && !/下个?月/.test(text))
                month += 1;
            const d = new Date(year, month, day);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    return undefined;
}
/**
 * 语音描述交给 LLM 做结构化补全（本地规则没抽全时用）。
 * 返回结构化草稿字段。
 */
async function recognizeSubscriptionFromVoice(transcript, today, options = {}) {
    const text = transcript.trim();
    if (!text)
        return null;
    const prompt = `今天是 ${today}。下面是用户用语音口述的一条订阅信息，请抽取成结构化数据。

只输出一个 JSON 代码块：
\`\`\`json
{
  "name": "服务/应用名（必填）",
  "planName": "套餐名（没有则省略）",
  "category": "software|loan|utility|rent|membership|insurance|telecom|other",
  "amount": 数字金额（人民币，识别不到填 0）,
  "cycle": "weekly|monthly|quarterly|yearly|custom",
  "nextDueAt": "yyyy-mm-dd（把『下个月8号』『这个月底』等相对说法换算成绝对日期；不确定则省略）",
  "paymentMethod": "支付方式（没有则省略）",
  "confidence": 0~1
}
\`\`\`
口述内容：${text.slice(0, 600)}`;
    const provider = options.apiKey
        ? 'minimax'
        : (0, apiBase_1.getUserApiKey)('minimax')
            ? 'minimax'
            : (0, apiBase_1.getUserApiKey)('deepseek')
                ? 'deepseek'
                : (0, apiBase_1.getUserApiKey)('openrouter')
                    ? 'openrouter'
                    : 'minimax';
    const effectiveKey = options.apiKey || (0, apiBase_1.getUserApiKey)(provider) || undefined;
    const res = await fetch(effectiveKey ? providerUrl(provider) : (0, apiBase_1.apiUrl)(`/api/ai/${provider}`), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : (0, apiBase_1.apiAuthHeaders)()),
        },
        body: JSON.stringify({
            model: options.model || providerDefaultModel(provider),
            messages: [{ role: 'user', content: prompt }],
            ...(provider === 'minimax'
                ? { max_completion_tokens: 512, thinking: { type: 'disabled' } }
                : { max_tokens: 512 }),
            temperature: 0.2,
        }),
        signal: options.signal,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`语音识别失败 (${res.status})：${err.slice(0, 160)}`);
    }
    const data = await res.json();
    if (data.error)
        throw new Error(data.error.message || '语音识别返回错误');
    if (data.base_resp?.status_code) {
        throw new Error(data.base_resp.status_msg || `MiniMax 返回错误 ${data.base_resp.status_code}`);
    }
    const out = String(data.choices?.[0]?.message?.content || data.raw || '');
    return parseDraftJson(out, 'ai_text');
}
