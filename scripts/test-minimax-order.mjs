#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_IMAGE = '/Users/ryanbzhou/Downloads/Picsew_20260606170004.JPEG';
const OUT_DIR = join(ROOT, '.tmp', 'minimax-order');

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = {
    image: DEFAULT_IMAGE,
    appCompress: false,
    chunked: false,
    chunkHeight: 1000,
    overlap: 220,
    prompt: 'simple',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--app-compress') args.appCompress = true;
    else if (arg === '--chunked') args.chunked = true;
    else if (arg === '--chunk-height') args.chunkHeight = Number(argv[++i]) || args.chunkHeight;
    else if (arg === '--overlap') args.overlap = Number(argv[++i]) || args.overlap;
    else if (arg === '--image') args.image = argv[++i] || args.image;
    else if (arg === '--prompt') args.prompt = argv[++i] || args.prompt;
    else if (!arg.startsWith('--')) args.image = arg;
  }
  return args;
}

function imageMime(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function dimensions(file) {
  try {
    const output = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]);
    const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

function appCompressedImage(file) {
  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${basename(file).replace(/\W+/g, '_')}.max1800.jpg`);
  execFileSync('sips', ['-Z', '1800', '-s', 'format', 'jpeg', file, '--out', out], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out;
}

const PROMPTS = {
  simple: `识别图片里的订单商品。

请按从上到下的顺序，找出所有商品图，并把每个商品图和旁边的商品名、数量、实付价格对应起来。

只返回这些字段：
- name：商品名
- qty：数量，没有看到就填 1
- paidPrice：实付价格，没有看到就省略
- pixelRect：商品图本身的像素框，不要框文字、价格、按钮、空白或整行
- imageRect：商品图本身的归一化框
- confidence：0 到 1

pixelRect 和 imageRect 的 x/y 都是左上角，w/h 都是宽高。
pixelRect 相对于当前输入图片的像素坐标。
imageRect 相对于当前输入图片归一化。

只返回 JSON：
{
  "items": [
    {
      "name": "潭牛冷鲜文昌鸡半只切块 450g",
      "qty": 1,
      "paidPrice": 36.51,
      "pixelRect": {"x":57,"y":241,"w":140,"h":140},
      "imageRect": {"x":0.07,"y":0.30,"w":0.13,"h":0.06},
      "confidence": 0.82
    }
  ]
}`,
  visualFirst: `你只做订单截图里的商品缩略图识别。

步骤：
1. 先找出每一个商品缩略图，从上到下排序。
2. 对每个缩略图，读取同一行的商品名、数量、实付价格。
3. imageRect 必须只包住缩略图本身。

不要输出解释。只输出 JSON：
{"items":[{"name":"商品名","qty":1,"paidPrice":0,"imageRect":{"x":0,"y":0,"w":0,"h":0},"confidence":0.8}]}`,
  pixelFirst: `识别这张订单长截图里的所有商品缩略图。

先在整张图片上定位每个商品缩略图的像素框，再换算成归一化 imageRect。

坐标定义：
- pixelRect: {"x":左上角像素x,"y":左上角像素y,"w":像素宽,"h":像素高}
- imageRect.x = pixelRect.x / 图片宽度
- imageRect.y = pixelRect.y / 图片高度
- imageRect.w = pixelRect.w / 图片宽度
- imageRect.h = pixelRect.h / 图片高度

注意：这是很长的竖图，所以商品缩略图如果视觉上是正方形，imageRect.h 会明显小于 imageRect.w。

每个商品只返回：name、qty、paidPrice、pixelRect、imageRect、confidence。
imageRect 和 pixelRect 都只框商品图片本身，不框文字、价格、按钮、空白或整行。

只输出 JSON：
{"items":[{"name":"商品名","qty":1,"paidPrice":0,"pixelRect":{"x":0,"y":0,"w":0,"h":0},"imageRect":{"x":0,"y":0,"w":0,"h":0},"confidence":0.8}]}`,
};

function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('MiniMax did not return a JSON object');
  return JSON.parse(match[0]);
}

function expectedFor(file) {
  if (!basename(file).includes('Picsew_20260606170004')) return [];
  return [
    { name: '香蕉', price: 7.42 },
    { name: '荔枝', price: 9.26 },
    { name: '文昌鸡', price: 36.51 },
    { name: '椰子水', price: 8.92 },
    { name: '巨峰', price: 13.99 },
    { name: '苹果干', price: 3 },
    { name: '大蒜', price: 0 },
  ];
}

function validate(parsed, file, dim) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const expected = expectedFor(file);
  const issues = [];
  if (expected.length && items.length !== expected.length) {
    issues.push(`expected ${expected.length} items, got ${items.length}`);
  }
  for (const exp of expected) {
    const hit = items.find((item) => String(item.name || '').includes(exp.name));
    if (!hit) {
      issues.push(`missing item name containing "${exp.name}"`);
      continue;
    }
    const price = Number(hit.paidPrice);
    if (Number.isFinite(price) && Math.abs(price - exp.price) > 0.03) {
      issues.push(`price mismatch for ${exp.name}: expected ${exp.price}, got ${price}`);
    }
  }
  items.forEach((item, index) => {
    const rect = normalizedRect(item, dim);
    if (!rect) {
      issues.push(`#${index + 1} ${item.name || ''}: missing imageRect/pixelRect`);
      return;
    }
    const values = [rect.x, rect.y, rect.w, rect.h].map(Number);
    if (!values.every(Number.isFinite)) {
      issues.push(`#${index + 1} ${item.name || ''}: invalid rect numbers`);
      return;
    }
    const [x, y, w, h] = values;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.002 || y + h > 1.002) {
      issues.push(`#${index + 1} ${item.name || ''}: rect out of bounds ${JSON.stringify(rect)}`);
    }
    if (dim.width && dim.height) {
      const px = {
        x: Math.round(x * dim.width),
        y: Math.round(y * dim.height),
        w: Math.round(w * dim.width),
        h: Math.round(h * dim.height),
      };
      if (px.h > px.w * 1.35) {
        issues.push(`#${index + 1} ${item.name || ''}: rect too tall for order thumbnail ${px.w}x${px.h}`);
      }
      if (px.w < 18 || px.h < 18) {
        issues.push(`#${index + 1} ${item.name || ''}: rect too small ${px.w}x${px.h}`);
      }
    }
  });
  return issues;
}

function renderOverlay(imagePath, parsed, dim, outFile) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const img = readFileSync(imagePath).toString('base64');
  const mime = imageMime(imagePath);
  const boxes = items
    .map((item, index) => {
      const r = normalizedRect(item, dim) || {};
      const x = Number(r.x) * 100;
      const y = Number(r.y) * 100;
      const w = Number(r.w) * 100;
      const h = Number(r.h) * 100;
      if (![x, y, w, h].every(Number.isFinite)) return '';
      return `<div class="box" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"><span>${index + 1}</span></div>`;
    })
    .join('\n');
  const rows = items
    .map(
      (item, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(item.name || '')}</td><td>${item.qty ?? ''}</td><td>${item.paidPrice ?? ''}</td><td><code>${escapeHtml(JSON.stringify(item.imageRect || null))}</code></td></tr>`
    )
    .join('\n');
  const html = `<!doctype html>
<meta charset="utf-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:24px;background:#f6f3ec;color:#171411}
.wrap{position:relative;max-width:520px}
img{display:block;width:100%;height:auto;border-radius:10px}
.box{position:absolute;border:2px solid #c44b32;background:rgba(196,75,50,.12);box-sizing:border-box}
.box span{position:absolute;left:-2px;top:-22px;background:#c44b32;color:white;font-weight:700;border-radius:6px;padding:2px 6px;font-size:12px}
table{border-collapse:collapse;margin-top:20px;background:white}
td,th{border:1px solid #ddd;padding:6px 8px;font-size:13px}
code{font-size:12px}
</style>
<h1>MiniMax order debug</h1>
<p>${escapeHtml(basename(imagePath))} · ${dim.width}×${dim.height}</p>
<div class="wrap"><img src="data:${mime};base64,${img}">${boxes}</div>
<table><thead><tr><th>#</th><th>name</th><th>qty</th><th>paidPrice</th><th>imageRect</th></tr></thead><tbody>${rows}</tbody></table>`;
  writeFileSync(outFile, html);
}

function normalizedRect(item, dim) {
  const pixel = item?.pixelRect;
  if (
    dim.width &&
    dim.height &&
    pixel &&
    [pixel.x, pixel.y, pixel.w, pixel.h].map(Number).every(Number.isFinite)
  ) {
    return {
      x: Number(pixel.x) / dim.width,
      y: Number(pixel.y) / dim.height,
      w: Number(pixel.w) / dim.width,
      h: Number(pixel.h) / dim.height,
    };
  }
  return item?.imageRect;
}

function renderPngOverlay(imagePath, parsed, outFile) {
  const payload = JSON.stringify(parsed).replace(/'/g, "\\'");
  const script = `
from PIL import Image, ImageDraw, ImageFont
import json
img=Image.open(${JSON.stringify(imagePath)}).convert('RGB')
data=json.loads('''${payload}''')
draw=ImageDraw.Draw(img)
for idx,item in enumerate(data.get('items', []), start=1):
    r=item.get('pixelRect')
    if not r:
        nr=item.get('imageRect') or {}
        r={'x':nr.get('x',0)*img.width,'y':nr.get('y',0)*img.height,'w':nr.get('w',0)*img.width,'h':nr.get('h',0)*img.height}
    x,y,w,h=[int(round(float(r.get(k,0)))) for k in ('x','y','w','h')]
    draw.rectangle([x,y,x+w,y+h], outline=(196,75,50), width=4)
    draw.rounded_rectangle([x,y-34,x+38,y], radius=8, fill=(196,75,50))
    draw.text((x+9,y-29), str(idx), fill=(255,255,255))
img.save(${JSON.stringify(outFile)}, quality=92)
`;
  execFileSync('python3', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitImageIntoChunks(file, chunkHeight, overlap) {
  mkdirSync(OUT_DIR, { recursive: true });
  const script = `
from PIL import Image
from pathlib import Path
import json, math
src=Image.open(${JSON.stringify(file)}).convert('RGB')
out_dir=Path(${JSON.stringify(OUT_DIR)})
out_dir.mkdir(parents=True, exist_ok=True)
chunk_h=${Math.max(200, Math.round(chunkHeight))}
overlap=${Math.max(0, Math.round(overlap))}
step=max(1, chunk_h-overlap)
chunks=[]
y=0
i=0
while y < src.height:
    y2=min(src.height, y+chunk_h)
    out=out_dir / f"chunk-{i:02d}-{y}-{y2}.jpg"
    src.crop((0,y,src.width,y2)).save(out, quality=92)
    chunks.append({"path": str(out), "y": y, "height": y2-y})
    if y2 >= src.height:
        break
    y += step
    i += 1
print(json.dumps({"width":src.width,"height":src.height,"chunks":chunks}, ensure_ascii=False))
`;
  const output = execFileSync('python3', ['-c', script], { encoding: 'utf8' });
  return JSON.parse(output);
}

async function callMiniMaxImage({ apiKey, model, prompt, imagePath }) {
  const base64 = readFileSync(imagePath).toString('base64');
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${imageMime(imagePath)};base64,${base64}`, detail: 'high' } },
        ],
      },
    ],
    max_completion_tokens: 2048,
    thinking: { type: 'disabled' },
    temperature: 0.1,
  };
  const res = await fetch('https://api.minimaxi.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`MiniMax HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  const data = JSON.parse(raw);
  if (data.base_resp?.status_code) {
    throw new Error(`MiniMax error ${data.base_resp.status_code}: ${data.base_resp.status_msg}`);
  }
  const text = data.choices?.[0]?.message?.content || '';
  return { text, parsed: extractJson(text), raw };
}

function normalizeKey(item) {
  const name = String(item.name || '')
    .replace(/[【】\[\]\s]/g, '')
    .replace(/秒杀|免费菜|赠品|空运直达|放心/g, '')
    .slice(0, 20);
  const price = Number(item.paidPrice);
  return `${name}|${Number.isFinite(price) ? price.toFixed(2) : ''}`;
}

function mergeChunkItems(chunkResults, fullDim) {
  const byKey = new Map();
  for (const result of chunkResults) {
    const items = Array.isArray(result.parsed?.items) ? result.parsed.items : [];
    for (const rawItem of items) {
      const item = { ...rawItem };
      const p = item.pixelRect;
      if (!p || ![p.x, p.y, p.w, p.h].map(Number).every(Number.isFinite)) continue;
      const localY = Number(p.y);
      const localH = Number(p.h);
      item.pixelRect = {
        x: Number(p.x),
        y: localY + result.offsetY,
        w: Number(p.w),
        h: localH,
      };
      item.imageRect = {
        x: item.pixelRect.x / fullDim.width,
        y: item.pixelRect.y / fullDim.height,
        w: item.pixelRect.w / fullDim.width,
        h: item.pixelRect.h / fullDim.height,
      };
      const edgePenalty =
        localY < 40 || localY + localH > result.chunkHeight - 40
          ? 0.15
          : 0;
      const score = Number(item.confidence || 0.7) - edgePenalty;
      const key = normalizeKey(item);
      const prev = byKey.get(key);
      if (!prev || score > prev.score) byKey.set(key, { item, score });
    }
  }
  const items = suppressOverlaps(
    Array.from(byKey.values()).map((entry) => entry.item)
  )
    .sort((a, b) => a.pixelRect.y - b.pixelRect.y);
  return { items };
}

function rectIoU(a, b) {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

function suppressOverlaps(items) {
  const sorted = [...items].sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  const kept = [];
  for (const item of sorted) {
    if (!item.pixelRect) continue;
    const duplicate = kept.some((entry) => rectIoU(item.pixelRect, entry.pixelRect) > 0.1 || sameNearbyName(item, entry));
    if (!duplicate) kept.push(item);
  }
  return kept;
}

function sameNearbyName(a, b) {
  const an = String(a.name || '').replace(/\s/g, '');
  const bn = String(b.name || '').replace(/\s/g, '');
  if (!an || !bn || !(an.includes(bn) || bn.includes(an))) return false;
  const ar = a.pixelRect;
  const br = b.pixelRect;
  if (!ar || !br) return false;
  const ay = ar.y + ar.h / 2;
  const by = br.y + br.h / 2;
  return Math.abs(ay - by) < Math.max(ar.h, br.h) * 1.2;
}

async function main() {
  loadEnvFile(join(ROOT, '.env.local'));
  loadEnvFile(join(ROOT, '.env'));
  const args = parseArgs(process.argv.slice(2));
  const apiKey =
    process.env.MINIMAX_API_KEY ||
    process.env.MINIMAX_TOKEN_PLAN_KEY ||
    process.env.MINIMAX_TOKEN_PLAN_API_KEY;
  if (!apiKey) {
    console.error('Missing MINIMAX_API_KEY / MINIMAX_TOKEN_PLAN_KEY. Add it to .env.local or export it before running.');
    process.exit(2);
  }

  const sourceImage = resolve(args.image);
  if (!existsSync(sourceImage)) {
    console.error(`Image not found: ${sourceImage}`);
    process.exit(2);
  }
  const imagePath = args.appCompress ? appCompressedImage(sourceImage) : sourceImage;
  const prompt = PROMPTS[args.prompt];
  if (!prompt) {
    console.error(`Unknown prompt "${args.prompt}". Available: ${Object.keys(PROMPTS).join(', ')}`);
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const dim = dimensions(imagePath);
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';

  console.log(`Calling MiniMax ${model}`);
  console.log(`Image: ${imagePath} (${dim.width}x${dim.height})`);
  console.log(`Prompt: ${args.prompt}${args.chunked ? `, chunked ${args.chunkHeight}/${args.overlap}` : ''}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawFile = join(OUT_DIR, `raw-${stamp}.txt`);

  let text = '';
  let parsed;
  let raw = '';
  if (args.chunked) {
    const split = splitImageIntoChunks(imagePath, args.chunkHeight, args.overlap);
    const chunkResults = [];
    for (const [index, chunk] of split.chunks.entries()) {
      console.log(`Chunk ${index + 1}/${split.chunks.length}: y=${chunk.y}, h=${chunk.height}`);
      const result = await callMiniMaxImage({ apiKey, model, prompt, imagePath: chunk.path });
      chunkResults.push({ ...result, offsetY: chunk.y, chunkHeight: chunk.height });
      raw += `\n\n===== chunk ${index + 1} y=${chunk.y} =====\n${result.raw}\n`;
    }
    parsed = mergeChunkItems(chunkResults, { width: split.width, height: split.height });
    text = JSON.stringify(parsed, null, 2);
  } else {
    const result = await callMiniMaxImage({ apiKey, model, prompt, imagePath });
    text = result.text;
    parsed = result.parsed;
    raw = result.raw;
  }
  writeFileSync(rawFile, raw);
  const resultFile = join(OUT_DIR, `result-${stamp}.json`);
  const htmlFile = join(OUT_DIR, `overlay-${stamp}.html`);
  const pngFile = join(OUT_DIR, `overlay-${stamp}.jpg`);
  writeFileSync(resultFile, JSON.stringify(parsed, null, 2));
  renderOverlay(imagePath, parsed, dim, htmlFile);
  renderPngOverlay(imagePath, parsed, pngFile);
  const issues = validate(parsed, sourceImage, dim);
  console.log('\n--- MiniMax content ---');
  console.log(text);
  console.log('\n--- Parsed JSON ---');
  console.log(JSON.stringify(parsed, null, 2));
  console.log('\n--- Validation ---');
  if (issues.length) {
    console.log(issues.map((issue) => `- ${issue}`).join('\n'));
  } else {
    console.log('OK');
  }
  console.log(`\nSaved:\n- ${resultFile}\n- ${htmlFile}\n- ${pngFile}\n- ${rawFile}`);
  process.exit(issues.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
