import { SUB_CATEGORIES, type SubCategory, type SubCycle, type SubscriptionSource } from '../models';
import { fileToBase64 } from '../utils/image';
import { uid } from '../utils/id';
import { extractSubscriptionActionPlan, type SubscriptionActionPlan } from './subscriptionActions';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

const CATEGORY_BY_NAME: Array<[RegExp, SubCategory]> = [
  [/chatgpt|cursor|notion|figma|github|vercel|icloud|dropbox|云|软件|工具|app|saas/i, 'software'],
  [/房贷|贷款|车贷|分期/i, 'loan'],
  [/电费|水费|燃气|煤气|宽带|物业/i, 'utility'],
  [/房租|租金/i, 'rent'],
  [/会员|自动续费|包月|netflix|spotify|youtube|bilibili|腾讯视频|爱奇艺|优酷|盒马|山姆|买菜|美团|饿了么/i, 'membership'],
  [/保险|医保|车险|寿险/i, 'insurance'],
  [/移动|联通|电信|话费|流量|手机|通讯/i, 'telecom'],
];

const CYCLE_BY_TEXT: Array<[RegExp, SubCycle]> = [
  [/每周|周付|weekly/i, 'weekly'],
  [/每季|季度|quarter/i, 'quarterly'],
  [/每年|年度|年费|包年|年卡|year/i, 'yearly'],
  [/自定义|custom/i, 'custom'],
  [/每月|月付|月费|包月|月卡|月度|按月|monthly|month/i, 'monthly'],
];

function categoryFromText(text: string): SubCategory {
  return CATEGORY_BY_NAME.find(([re]) => re.test(text))?.[1] || 'other';
}

function cycleFromText(text: string): SubCycle {
  return CYCLE_BY_TEXT.find(([re]) => re.test(text))?.[1] || 'monthly';
}

function cleanCell(value: string | undefined): string {
  return String(value || '').trim().replace(/^"|"$/g, '').replace(/""/g, '"');
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
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
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cleanCell(cell));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cleanCell(cell));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(header: string): string {
  const key = header.trim().toLowerCase();
  if (/名称|name|商户|项目|服务/.test(key)) return 'name';
  if (/套餐|plan/.test(key)) return 'planName';
  if (/金额|amount|price|扣款/.test(key)) return 'amount';
  if (/周期|cycle|频率/.test(key)) return 'cycle';
  if (/下次|next|due|扣款日/.test(key)) return 'nextDueAt';
  if (/开始|start/.test(key)) return 'startedAt';
  if (/结束|end/.test(key)) return 'endAt';
  if (/分类|类型|category/.test(key)) return 'category';
  if (/支付|payment|卡|账户/.test(key)) return 'paymentMethod';
  if (/链接|url|管理|退订/.test(key)) return 'url';
  if (/备注|note|说明/.test(key)) return 'note';
  if (/来源|source/.test(key)) return 'source';
  return key;
}

function parseAmount(text: string): number {
  const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Math.abs(Number(match[0])) : 0;
}

function parseDate(text: string): string | undefined {
  const iso = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/);
  if (iso) {
    const [y, m, d] = iso[0]!.split(/[-/]/).map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const md = text.match(/(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*日?/);
  if (md) {
    const year = new Date().getFullYear();
    return `${year}-${String(Number(md[1])).padStart(2, '0')}-${String(Number(md[2])).padStart(2, '0')}`;
  }
  return undefined;
}

function detectSourceFromText(text: string): SubscriptionSource {
  if (/短信|验证码|【[^】]+】/.test(text)) return 'sms';
  if (/邮件|发件人|收件人|subject|from:/i.test(text)) return 'email';
  if (/银行|信用卡|储蓄卡|账单|交易|扣款|入账|支出|零钱|微信支付|支付宝/i.test(text)) return 'bank';
  return 'ai_text';
}

function valueAfterLabel(text: string, labels: string[]): string | undefined {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*[:：]?\\s*([^\\n\\r]+)`, 'i'));
  return cleanCell(match?.[1]);
}

function extractNameFromText(text: string): string | undefined {
  const labelled = valueAfterLabel(text, ['续费项目', '订阅项目', '扣款项目', '项目名称', '商品名称', '服务名称', '会员名称', '项目']);
  if (labelled) return labelled.replace(/微信自动续费|自动续费|续费成功|续费凭证/g, '').trim() || labelled;

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) =>
    !/^(续费凭证|续费金额|金额|支付方式|付款方式|续费方式)$/i.test(line) &&
    !/^[-+]?¥?\s*\d+(?:\.\d+)?$/.test(line) &&
    /(会员|订阅|自动续费|包月|包年|月卡|年卡|续费)/.test(line)
  );
  if (candidate) {
    return candidate
      .replace(/^(续费项目|订阅项目|扣款项目|项目名称|商品名称|服务名称)\s*[:：]?\s*/i, '')
      .replace(/微信自动续费|自动续费|续费成功|续费凭证/g, '')
      .trim() || candidate;
  }

  return undefined;
}

function extractAmountFromText(text: string): number {
  const labelled = valueAfterLabel(text, ['续费金额', '扣款金额', '支付金额', '金额', '合计', '实付']);
  const amount = parseAmount(labelled || '');
  if (amount > 0) return amount;
  const money = text.match(/[¥￥]\s*-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:,\d{3})*(?:\.\d+)?\s*元/);
  return money ? parseAmount(money[0]!) : 0;
}

function extractPaymentMethodFromText(text: string): string | undefined {
  return valueAfterLabel(text, ['续费方式', '支付方式', '付款方式', '扣款方式', '支付账户', '付款账户']);
}

export function buildSubscriptionImportPlanFromText(
  text: string,
  source: SubscriptionSource = detectSourceFromText(text)
): SubscriptionActionPlan | null {
  const normalized = text.trim();
  if (!normalized) return null;
  const amount = extractAmountFromText(normalized);
  const name = extractNameFromText(normalized);
  if (!name || amount <= 0) return null;

  const nextDueAt = parseDate(normalized);
  const importBatchId = uid();
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

export function buildSubscriptionImportPlanFromCsv(
  text: string,
  source: SubscriptionSource = 'csv'
): SubscriptionActionPlan | null {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return null;
  const headers = rows[0]!.map(normalizeHeader);
  const importBatchId = uid();
  const actions = rows.slice(1).map((row) => {
    const record = Object.fromEntries(headers.map((h, i) => [h, cleanCell(row[i])]));
    const name = record.name || record['0'];
    if (!name) return null;
    const amount = parseAmount(record.amount || '');
    const nextDueAt = parseDate(record.nextDueAt || record.note || '');
    const category = SUB_CATEGORIES.some((cat) => cat.id === record.category)
      ? (record.category as SubCategory)
      : categoryFromText(`${name} ${record.category || ''} ${record.note || ''}`);
    const cycle = cycleFromText(`${record.cycle || ''} ${record.note || ''}`);
    return {
      type: 'createSubscription' as const,
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
  }).filter(Boolean) as SubscriptionActionPlan['actions'];

  if (!actions.length) return null;
  return {
    summary: `从 ${source === 'csv' ? 'CSV' : source} 导入 ${actions.length} 条订阅草稿`,
    actions,
  };
}

export function buildSubscriptionImportPrompt(text: string, source: SubscriptionSource = 'ai_text'): string {
  return `请从下面的${source === 'sms' ? '短信' : source === 'email' ? '邮件' : source === 'bank' ? '银行账单' : '账单文本'}中识别订阅/周期性扣款，生成可确认执行的 subscription_actions。

要求：
1. 只把明确的周期性订阅、会员、房租、贷款、水电、保险、通讯账单建成 createSubscription。
2. 如果疑似与已有订阅重复，请优先输出 mergeSubscriptions 或 updateSubscription，不要重复创建。
3. draft.source 设为 "${source}"，confidence 用 0~1 表示把握，evidenceText 保存原文关键证据。
4. 不确定下次扣款日时可以省略 nextDueAt，但要在正文里说明缺失。

账单文本：
${text.slice(0, 12000)}`;
}

export async function recognizeSubscriptionBillImage(
  blob: Blob,
  options: { model?: string; apiKey?: string } = {}
): Promise<SubscriptionActionPlan | null> {
  const base64 = await fileToBase64(blob);
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

  const res = await fetch(options.apiKey ? OPENROUTER_API : '/api/ai/openrouter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: options.model || 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`截图识别失败 (${res.status})：${err.slice(0, 160)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || data.raw || '';
  return extractSubscriptionActionPlan(String(text));
}
