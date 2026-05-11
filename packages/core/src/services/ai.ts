/**
 * AI 识别服务：用 Vision 模型识别柜子 + 物品。
 * 提供 OpenRouter (Gemini) 和 Claude 两种实现，自动回退到启发式占位。
 */
import { fileToBase64 } from '../utils/image';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

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
1. rect 使用归一化坐标，格式为 {"x":0~1,"y":0~1,"w":0~1,"h":0~1}。
2. 原点在图片左上角，x 向右，y 向下。
3. 边界框要紧贴目标主体，尽量不要包含大量背景。
4. 必须保证 x+w ≤ 1 且 y+h ≤ 1。
5. cabinets 的框可略大，覆盖完整可点击区域；items 的框要尽量适合裁剪缩略图。

【去重与归属】
1. cabinets 与 items 可以重叠：一个柜子内可以包含很多 items。
2. 不要把同一个物品重复输出多次。
3. 不需要声明物品属于哪个柜子，系统会让用户后续归位。

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

/* ---------- OpenRouter (Gemini Vision) ---------- */

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: any[]
): Promise<string> {
  const res = await fetch(OPENROUTER_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens: 4096 }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter API (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'OpenRouter 返回错误');
  return data.choices?.[0]?.message?.content || '';
}

async function detectWithGemini(
  apiKey: string,
  model: string,
  blob: Blob
): Promise<DetectionResult> {
  const base64 = await fileToBase64(blob);
  const text = await callOpenRouter(apiKey, model, [
    {
      role: 'user',
      content: [
        { type: 'text', text: CABINET_DETECT_PROMPT },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64}` },
        },
      ],
    },
  ]);
  return parseDetection(text);
}

/* ---------- Claude Vision ---------- */

async function detectWithClaude(
  apiKey: string,
  blob: Blob,
  size: { width: number; height: number }
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
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
            },
            { type: 'text', text: CABINET_DETECT_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  return parseDetection(text);
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
  openrouterKey?: string;
  openrouterModel?: string;
  claudeKey?: string;
}

export async function detectCabinetsAndItems(
  blob: Blob,
  size: { width: number; height: number },
  cfg: DetectConfig
): Promise<DetectionResult> {
  if (cfg.openrouterKey) {
    try {
      return await detectWithGemini(
        cfg.openrouterKey,
        cfg.openrouterModel || 'google/gemini-2.5-flash',
        blob
      );
    } catch (e) {
      console.warn('Gemini detect failed, fallback:', e);
    }
  }
  if (cfg.claudeKey) {
    try {
      return await detectWithClaude(cfg.claudeKey, blob, size);
    } catch (e) {
      console.warn('Claude detect failed, fallback:', e);
    }
  }
  // 占位
  await new Promise((r) => setTimeout(r, 400));
  return heuristicDetection(size);
}
