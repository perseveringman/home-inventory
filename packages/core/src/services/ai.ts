/**
 * AI 识别服务：用 Vision 模型识别柜子 + 物品。
 * 提供 OpenRouter (Gemini) 和 Claude 两种实现，自动回退到启发式占位。
 */
import { fileToBase64 } from '../utils/image';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

const CABINET_DETECT_PROMPT = `你是家居收纳整理助手。请仔细分析这张房间照片，同时完成两件事：
A) 识别所有可用于存放物品的"独立储物单元"（柜子/开放格/桌面等）及其边界框
B) 识别照片中肉眼可见的、值得记录的"单个物品"及其边界框

====== A. 储物单元 ======
1. 每一个独立可存取的储物空间都单独识别，不要合并：
   - 多扇并排柜门 → 每扇算一个
   - 多个并排开放格 → 每个算一个
   - 桌面收纳盒、抽屉柜 → 每个独立
2. 桌面/工作台面本身算一个"放置单元"
3. 不识别：墙面/地面/门窗/显示器/人和宠物

====== B. 单个物品 ======
请尽可能穷尽地识别照片里所有能看见、能区分出轮廓的物品，不要遗漏。
电子/日用/厨房/卫浴/工具/玩具/衣物/书本/食物等所有类别。
即使只能看到一部分也要识别，用合理的中文名。

====== 边界框 ======
归一化坐标 [x, y, w, h]，0~1，原点左上角；紧贴物体边缘，确保 x+w ≤ 1, y+h ≤ 1。

====== 输出 ======
只输出一个 JSON 对象（不要解释、Markdown）：
{"cabinets":[{"name":"白色吊柜1","rect":{"x":0.05,"y":0.10,"w":0.20,"h":0.35}}],"items":[{"name":"苹果键盘","emoji":"⌨️","rect":{"x":0.42,"y":0.61,"w":0.15,"h":0.05}}]}

如果某类没有，对应字段给 []。`;

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
