/**
 * AI 识别服务：用 Vision 模型识别柜子 + 物品。
 * 提供 MiniMax M3、OpenRouter (Gemini) 和 Claude 实现，自动回退到启发式占位。
 */
import { fileToBase64 } from '../utils/image';
import { apiAuthHeaders, apiUrl, getUserApiKey } from './apiBase';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';
const DEFAULT_DETECTION_REPAIR_ROUNDS = 2;
const MAX_DETECTION_REPAIR_ROUNDS = 3;

const CABINET_DETECT_PROMPT = `你是一个严谨的家居收纳视觉识别助手。请基于照片同时完成两类识别：储物单元 cabinets 和可见物品 items。

【总体目标】
1. 帮用户建立家中"房间照片 → 柜子/开放格 → 单个物品"的档案。
2. 识别必须可落地：边界框可用于用户点击、拖拽和裁剪。
3. 宁可多识别清晰可见的物品，也不要只给泛泛分类。

【A. 储物单元 cabinets】
1. 识别所有可用于收纳或放置物品的独立空间：
   - 柜门、抽屉、开放格、置物架、电视柜、床头柜、书柜、冰箱格、橱柜、吊柜。
   - 桌面、台面、洗手台、窗台、地台等可作为放置区的平面。
   - 收纳箱、篮子、盒子、工具箱等明显容器。
2. 独立空间要拆开，不要合并：
   - 多扇并排柜门按每扇门拆。
   - 多个开放格按每格拆。
   - 上下层、左右层、抽屉组尽量按可独立取放的单位拆。
3. 命名要具体、中文、简短：
   - "白色吊柜左格"、"电视柜右抽屉"、"书桌台面"、"冰箱上层"。
   - 避免只写"柜子"、"区域"、"物品区"。
4. 不要把墙面、地面、人、宠物、门窗、屏幕内容当作储物单元。

【B. 单个物品 items】
1. 识别照片里肉眼可见、能区分轮廓、值得记录的单个物品。
2. 覆盖类别包括但不限于：
   - 食品/药品/保健品/饮料/调料。
   - 数码/家电/线缆/遥控器/工具。
   - 衣物/鞋帽/包/床品。
   - 书籍/文件/文具/玩具。
   - 洗护/美妆/清洁/厨具/餐具。
3. 同类多件如果明显分散，尽量分别识别；如果紧密堆叠且无法逐个区分，可合并为一个合理名称，如"一叠盘子"。
4. 只看到局部也可以识别，但名称要表达不确定性时保持通用，如"白色瓶子"。
5. 不要识别过小、严重模糊、无法命名的噪声。
6. 每个物品给一个 emoji，尽量贴合物品；不确定用 "📦"。

【边界框规则】
1. rect 使用相对于整张上传图片的归一化坐标，格式为 {"x":0~1,"y":0~1,"w":0~1,"h":0~1}。
2. 原点在图片左上角，x 向右，y 向下；x/y 是左上角，不是中心点；w/h 是宽高，不是右下角坐标。
3. 不要输出像素值、百分号、屏幕可见区域坐标或局部柜子坐标；所有 rect 都必须按整张原图宽高换算。
4. 边界框要紧贴目标主体，尽量不要包含大量背景、墙面、文字标签或相邻物品。
5. 必须保证 x+w ≤ 1 且 y+h ≤ 1，建议保留 2-3 位小数。
6. cabinets 的框可略大，覆盖完整可点击区域；items 的框要尽量适合裁剪缩略图。
7. 输出前逐项自检：rect 中心点必须落在对应目标上；如果框到空白、只框到局部边缘、跨到相邻物品，必须调整或删除该项。
8. 对过小、遮挡严重、无法可靠框定的物品，不要输出 rect，也不要为了凑数量猜测坐标。

【去重与归属】
1. cabinets 与 items 可以重叠：一个柜子内可以包含很多 items。
2. 不要把同一个物品重复输出多次。
3. 不需要声明物品属于哪个柜子，系统会用边界框的包含/重叠关系自动推断归属。
4. 因为会用几何关系推断归属，cabinet 的框要覆盖它能容纳或承载的物品，不要只框一条边或一个把手。

【输出格式】
只输出一个 JSON 对象，不要 Markdown，不要解释，不要前后缀：
{
  "cabinets": [
    {"name":"白色吊柜左格","rect":{"x":0.05,"y":0.10,"w":0.20,"h":0.35}}
  ],
  "items": [
    {"name":"苹果键盘","emoji":"⌨️","rect":{"x":0.42,"y":0.61,"w":0.15,"h":0.05}}
  ]
}

如果某一类没有识别结果，对应字段返回 []。`;

export interface DetectedBox {
  name: string;
  rect: { x: number; y: number; w: number; h: number };
  emoji?: string;
}

export interface DetectionResult {
  cabinets: DetectedBox[];
  items: DetectedBox[];
}

function clampRect(r: any): DetectedBox['rect'] {
  let x = +r?.x || 0;
  let y = +r?.y || 0;
  let w = +r?.w || 0.1;
  let h = +r?.h || 0.1;
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  w = Math.max(0.02, Math.min(1, w));
  h = Math.max(0.02, Math.min(1, h));
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x, y, w, h };
}

export function parseDetection(text: string): DetectionResult {
  const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  let payload: any;
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (objMatch) {
    try {
      payload = JSON.parse(objMatch[0]);
    } catch {
      /* ignore */
    }
  }
  if (!payload && arrMatch) {
    try {
      payload = JSON.parse(arrMatch[0]);
    } catch (e) {
      throw new Error('JSON 解析失败');
    }
  }
  if (!payload) throw new Error('AI 返回格式异常');

  let rawCabinets: any[];
  let rawItems: any[];
  if (Array.isArray(payload)) {
    rawCabinets = payload;
    rawItems = [];
  } else {
    rawCabinets = Array.isArray(payload.cabinets) ? payload.cabinets : [];
    rawItems = Array.isArray(payload.items) ? payload.items : [];
  }

  const cabinets: DetectedBox[] = rawCabinets
    .map((b: any, i: number) => ({
      name: (b.name || `柜子${i + 1}`).toString().slice(0, 30),
      rect: clampRect(b.rect || {}),
    }))
    .filter((b) => b.rect.w > 0.02 && b.rect.h > 0.02);

  const items: DetectedBox[] = rawItems
    .map((b: any, i: number) => ({
      name: (b.name || `物品${i + 1}`).toString().slice(0, 30),
      emoji: (b.emoji || '').toString().slice(0, 4),
      rect: clampRect(b.rect || {}),
    }))
    .filter((b) => b.rect.w > 0.01 && b.rect.h > 0.01);

  return { cabinets, items };
}

function normalizeRepairRounds(value?: number): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_DETECTION_REPAIR_ROUNDS;
  return Math.max(0, Math.min(MAX_DETECTION_REPAIR_ROUNDS, Math.floor(value)));
}

function truncateForRepair(text: string): string {
  const max = 12000;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[内容过长，已截断 ${text.length - max} 字符]`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function ensureUsefulDetection(result: DetectionResult): DetectionResult {
  if (result.cabinets.length === 0 && result.items.length === 0) {
    throw new Error('AI 返回了空识别结果：cabinets 和 items 都为空');
  }
  return result;
}

function buildDetectionRepairPrompt(err: unknown, rawText: string, round: number, maxRounds: number): string {
  return `上一次房间图片识别结果没有通过系统解析/校验。请根据原始照片、错误信息和上一次返回数据，修复为严格合法的 JSON。

修复轮次：${round}/${maxRounds}
错误信息：${errorMessage(err)}

上一次返回数据：
${truncateForRepair(rawText)}

必须只输出一个 JSON 对象，不要 Markdown，不要解释，不要前后缀。schema 如下：
{
  "cabinets": [
    {"name":"白色吊柜左格","rect":{"x":0.05,"y":0.10,"w":0.20,"h":0.35}}
  ],
  "items": [
    {"name":"苹果键盘","emoji":"⌨️","rect":{"x":0.42,"y":0.61,"w":0.15,"h":0.05}}
  ]
}

要求：
1. cabinets 和 items 必须是数组，没有结果时才返回 []。
2. rect 必须是相对于整张原图的 0~1 归一化数字，x/y 是左上角，w/h 是宽高，且 x+w ≤ 1、y+h ≤ 1。
3. 不要丢弃上一次已经可信的识别项；只修复格式、字段、越界坐标、空结果或明显错误。
4. 每个 rect 的中心点必须落在对应目标上，不能只框空白、文字、边缘或相邻物品。
5. 如果上一次数据无法复用，请重新基于原始照片识别。`;
}

async function parseDetectionWithRepair({
  provider,
  initialMessages,
  callModel,
  maxRepairRounds,
}: {
  provider: string;
  initialMessages: any[];
  callModel: (messages: any[]) => Promise<string>;
  maxRepairRounds: number;
}): Promise<DetectionResult> {
  let text = await callModel(initialMessages);
  let lastError: unknown;

  for (let round = 0; round <= maxRepairRounds; round += 1) {
    try {
      return ensureUsefulDetection(parseDetection(text));
    } catch (err) {
      lastError = err;
      if (round >= maxRepairRounds) break;
      console.warn(`${provider} detect output invalid, repairing ${round + 1}/${maxRepairRounds}:`, err);
      text = await callModel([
        ...initialMessages,
        { role: 'assistant', content: truncateForRepair(text) },
        { role: 'user', content: buildDetectionRepairPrompt(err, text, round + 1, maxRepairRounds) },
      ]);
    }
  }

  throw new Error(
    `${provider} 识别结果修复失败（已尝试 ${maxRepairRounds} 轮）：${errorMessage(lastError)}`
  );
}

function imageDataUrl(blob: Blob, base64: string): string {
  return `data:${blob.type || 'image/jpeg'};base64,${base64}`;
}

/* ---------- MiniMax M3 Vision ---------- */

async function callMiniMax(
  apiKey: string | undefined,
  model: string,
  messages: any[]
): Promise<string> {
  const effectiveKey = apiKey || getUserApiKey('minimax') || undefined;
  if (!effectiveKey) {
    throw new Error('MiniMax 官方 API Key 未配置，跳过 MiniMax 直连');
  }
  const res = await fetch(MINIMAX_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 4096,
      thinking: { type: 'disabled' },
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax API (${res.status}): ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'MiniMax 返回错误');
  if (data.base_resp?.status_code) {
    throw new Error(data.base_resp.status_msg || `MiniMax 返回错误 ${data.base_resp.status_code}`);
  }
  return data.choices?.[0]?.message?.content || '';
}

async function detectWithMiniMax(
  apiKey: string | undefined,
  model: string,
  blob: Blob,
  maxRepairRounds: number
): Promise<DetectionResult> {
  const base64 = await fileToBase64(blob);
  const initialMessages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: CABINET_DETECT_PROMPT },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl(blob, base64) },
        },
      ],
    },
  ];
  return parseDetectionWithRepair({
    provider: 'MiniMax',
    initialMessages,
    callModel: (messages) => callMiniMax(apiKey, model, messages),
    maxRepairRounds,
  });
}

/* ---------- OpenRouter (Gemini Vision, legacy fallback) ---------- */

async function callOpenRouter(
  apiKey: string | undefined,
  model: string,
  messages: any[]
): Promise<string> {
  const effectiveKey = apiKey || getUserApiKey('openrouter') || undefined;
  const res = await fetch(effectiveKey ? OPENROUTER_API : apiUrl('/api/ai/openrouter'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : apiAuthHeaders()),
    },
    body: JSON.stringify({ model, messages, max_tokens: 4096 }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter API (${res.status}): ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'OpenRouter 返回错误');
  return data.choices?.[0]?.message?.content || '';
}

async function detectWithGemini(
  apiKey: string | undefined,
  model: string,
  blob: Blob,
  maxRepairRounds: number
): Promise<DetectionResult> {
  const base64 = await fileToBase64(blob);
  const initialMessages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: CABINET_DETECT_PROMPT },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl(blob, base64) },
        },
      ],
    },
  ];
  return parseDetectionWithRepair({
    provider: 'Gemini',
    initialMessages,
    callModel: (messages) => callOpenRouter(apiKey, model, messages),
    maxRepairRounds,
  });
}

/* ---------- Claude Vision ---------- */

async function detectWithClaude(
  apiKey: string | undefined,
  blob: Blob,
  size: { width: number; height: number },
  maxRepairRounds: number
): Promise<DetectionResult> {
  const maxSide = 1568;
  let imgBlob = blob;
  if (blob.size > 100 && Math.max(size.width, size.height) > maxSide) {
    const ratio = maxSide / Math.max(size.width, size.height);
    const nw = Math.round(size.width * ratio);
    const nh = Math.round(size.height * ratio);
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (bmp) {
      const c = document.createElement('canvas');
      c.width = nw;
      c.height = nh;
      c.getContext('2d')!.drawImage(bmp, 0, 0, nw, nh);
      imgBlob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85));
      bmp.close();
    }
  }
  const base64 = await fileToBase64(imgBlob);
  const mediaType = imgBlob.type || 'image/jpeg';
  const initialMessages = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        { type: 'text', text: CABINET_DETECT_PROMPT },
      ],
    },
  ];
  return parseDetectionWithRepair({
    provider: 'Claude',
    initialMessages,
    callModel: (messages) => callClaude(apiKey, messages),
    maxRepairRounds,
  });
}

async function callClaude(apiKey: string | undefined, messages: any[]): Promise<string> {
  const effectiveKey = apiKey || getUserApiKey('claude') || undefined;
  const res = await fetch(effectiveKey ? ANTHROPIC_API : apiUrl('/api/ai/claude'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(effectiveKey
        ? {
            'x-api-key': effectiveKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          }
        : apiAuthHeaders()),
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  return text;
}

/* ---------- 启发式占位 ---------- */

function heuristicDetection(size: { width: number; height: number }): DetectionResult {
  const ratio = size.width / size.height;
  const cabinets: DetectedBox[] = [];
  if (ratio > 1.1) {
    cabinets.push({ name: '柜子 1', rect: { x: 0.04, y: 0.18, w: 0.28, h: 0.70 } });
    cabinets.push({ name: '柜子 2', rect: { x: 0.36, y: 0.15, w: 0.28, h: 0.72 } });
    cabinets.push({ name: '柜子 3', rect: { x: 0.68, y: 0.18, w: 0.28, h: 0.70 } });
  } else {
    cabinets.push({ name: '柜子 1', rect: { x: 0.1, y: 0.2, w: 0.8, h: 0.35 } });
    cabinets.push({ name: '柜子 2', rect: { x: 0.12, y: 0.58, w: 0.76, h: 0.35 } });
  }
  return { cabinets, items: [] };
}

/* ---------- 总入口 ---------- */

export interface DetectConfig {
  minimaxKey?: string;
  minimaxModel?: string;
  openrouterKey?: string;
  openrouterModel?: string;
  claudeKey?: string;
  maxRepairRounds?: number;
}

export async function detectCabinetsAndItems(
  blob: Blob,
  size: { width: number; height: number },
  cfg: DetectConfig
): Promise<DetectionResult> {
  const maxRepairRounds = normalizeRepairRounds(cfg.maxRepairRounds);
  try {
    return await detectWithMiniMax(
      cfg.minimaxKey,
      cfg.minimaxModel || DEFAULT_MINIMAX_MODEL,
      blob,
      maxRepairRounds
    );
  } catch (e) {
    console.warn('MiniMax detect failed after repair, try next provider/fallback:', e);
  }

  try {
    return await detectWithGemini(
      cfg.openrouterKey,
      cfg.openrouterModel || 'google/gemini-2.5-flash',
      blob,
      maxRepairRounds
    );
  } catch (e) {
    console.warn('Gemini detect failed after repair, try next provider/fallback:', e);
  }

  try {
    return await detectWithClaude(cfg.claudeKey, blob, size, maxRepairRounds);
  } catch (e) {
    console.warn('Claude detect failed after repair, fallback:', e);
  }
  // 占位
  await new Promise((r) => setTimeout(r, 400));
  return heuristicDetection(size);
}
