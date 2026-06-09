import {
  compressImage,
  type Rect,
} from '@home-inventory/core';
import { analyzeImageWithNativeVision, type NativeVisionItem, type NativeVisionResult } from './nativeVision';

export interface NativeDiscoveredBox {
  id: string;
  rect: Rect;
  confidence?: number;
  source?: NativeVisionItem['source'];
  nameHint?: string;
}

export interface NativeDiscoveryDraft {
  blob: Blob;
  width: number;
  height: number;
  boxes: NativeDiscoveredBox[];
}

export async function prepareNativeItemDiscovery(file: Blob): Promise<NativeDiscoveryDraft> {
  const compressed = await compressImage(file);
  const native = await analyzeImageWithNativeVision(compressed.blob);
  const nativeItems = normalizeNativeItems(native?.items || []);
  const evidenceItems = nativeItems.length ? nativeItems : inferBoxesFromVisionEvidence(native);
  const contrastItems = evidenceItems.length ? evidenceItems : await inferBoxesFromContrast(compressed.blob);
  return {
    blob: compressed.blob,
    width: compressed.width,
    height: compressed.height,
    boxes: contrastItems.map((item, index) => ({
      id: item.id || `native-${index + 1}`,
      rect: item.rect,
      confidence: item.confidence,
      source: item.source,
      nameHint: isGenericName(item.name) ? undefined : item.name,
    })),
  };
}

function normalizeNativeItems(items: NativeVisionItem[]): NativeVisionItem[] {
  return items
    .map((item, index) => ({
      ...item,
      name: cleanName(item.name) || `物品 ${index + 1}`,
      rect: clampRect(item.rect),
    }))
    .filter((item) => item.rect.w >= 0.025 && item.rect.h >= 0.025)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

function cleanName(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[|｜]+/g, ' ')
    .trim()
    .slice(0, 30);
}

function isGenericName(name: string): boolean {
  return /^物品\s*\d+$/i.test(name) || /^(未知|瓶子|盒子|物品)$/i.test(name.trim());
}

function clampRect(rect: Rect): Rect {
  let x = Number(rect?.x) || 0;
  let y = Number(rect?.y) || 0;
  let w = Number(rect?.w) || 0;
  let h = Number(rect?.h) || 0;
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  w = Math.max(0, Math.min(1, w));
  h = Math.max(0, Math.min(1, h));
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x, y, w, h };
}

interface EvidenceRect {
  rect: Rect;
  value: string;
  confidence: number;
  source: NativeVisionItem['source'];
}

interface EvidenceCluster {
  rect: Rect;
  values: string[];
  confidence: number;
  count: number;
  source: NativeVisionItem['source'];
}

function inferBoxesFromVisionEvidence(native: NativeVisionResult | null | undefined): NativeVisionItem[] {
  if (!native) return [];
  const evidence: EvidenceRect[] = [
    ...(native.barcodes || []).map((barcode) => ({
      rect: clampRect(barcode.rect),
      value: barcode.value,
      confidence: barcode.confidence || 0.8,
      source: 'barcode' as const,
    })),
    ...(native.texts || [])
      .filter((text) => text.value.trim().length >= 2)
      .map((text) => ({
        rect: clampRect(text.rect),
        value: text.value,
        confidence: text.confidence || 0.45,
        source: 'ocr' as const,
      })),
  ].filter((entry) => entry.rect.w > 0.002 && entry.rect.h > 0.002);

  if (!evidence.length) return [];

  const clusters: EvidenceCluster[] = [];
  evidence
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .forEach((entry) => {
      const match = clusters.find((cluster) => shouldJoinCluster(cluster.rect, entry.rect));
      if (!match) {
        clusters.push({
          rect: entry.rect,
          values: [entry.value],
          confidence: entry.confidence,
          count: 1,
          source: entry.source,
        });
        return;
      }
      match.rect = unionRect(match.rect, entry.rect);
      match.values.push(entry.value);
      match.confidence = Math.max(match.confidence, entry.confidence);
      match.count += 1;
      if (entry.source === 'barcode') match.source = 'barcode';
    });

  const expanded = clusters
    .filter((cluster) => cluster.count >= 1)
    .map((cluster, index) => {
      const rect = expandLikelyItemRect(cluster.rect, cluster.count);
      return {
        id: `vision-evidence-${index + 1}`,
        name: cleanName(cluster.values.find((value) => value.trim().length >= 3) || `物品 ${index + 1}`),
        rect,
        confidence: Math.min(0.82, Math.max(0.42, cluster.confidence)),
        source: cluster.source,
        text: cluster.values.slice(0, 5),
      };
    })
    .filter((item) => item.rect.w * item.rect.h >= 0.025)
    .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);

  return dedupeItems(expanded)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .slice(0, 8);
}

async function inferBoxesFromContrast(blob: Blob): Promise<NativeVisionItem[]> {
  try {
    const bitmap = await createImageBitmap(blob);
    const maxSide = 260;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      bitmap.close?.();
      return [];
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const image = ctx.getImageData(0, 0, width, height);
    const bg = estimateBorderColor(image.data, width, height);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const dr = image.data[i]! - bg.r;
        const dg = image.data[i + 1]! - bg.g;
        const db = image.data[i + 2]! - bg.b;
        const distance = Math.sqrt(dr * dr + dg * dg + db * db);
        const lum = 0.2126 * image.data[i]! + 0.7152 * image.data[i + 1]! + 0.0722 * image.data[i + 2]!;
        const bgLum = 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b;
        if (distance > 34 || Math.abs(lum - bgLum) > 30) mask[y * width + x] = 1;
      }
    }

    const components = connectedComponents(mask, width, height)
      .filter((rect) => rect.w * rect.h >= 0.0015 && rect.w >= 0.02 && rect.h >= 0.02)
      .map((rect) => ({ rect, value: '', confidence: 0.4, source: 'foreground' as const }));

    if (!components.length) return [];

    const clusters: EvidenceCluster[] = [];
    components
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
      .forEach((entry) => {
        const match = clusters.find((cluster) => shouldJoinCluster(cluster.rect, entry.rect, 0.12, 0.1));
        if (!match) {
          clusters.push({
            rect: entry.rect,
            values: [],
            confidence: entry.confidence,
            count: 1,
            source: entry.source,
          });
          return;
        }
        match.rect = unionRect(match.rect, entry.rect);
        match.count += 1;
      });

    return dedupeItems(
      clusters
        .map((cluster, index) => ({
          id: `contrast-${index + 1}`,
          name: `物品 ${index + 1}`,
          rect: expandLikelyItemRect(cluster.rect, cluster.count),
          confidence: 0.4,
          source: 'foreground' as const,
        }))
        .filter((item) => item.rect.w * item.rect.h >= 0.035 && item.rect.w * item.rect.h <= 0.88)
    )
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function shouldJoinCluster(a: Rect, b: Rect, xPad = 0.1, yPad = 0.075): boolean {
  const ax1 = Math.max(0, a.x - xPad);
  const ax2 = Math.min(1, a.x + a.w + xPad);
  const ay1 = Math.max(0, a.y - yPad);
  const ay2 = Math.min(1, a.y + a.h + yPad);
  const bx1 = b.x;
  const bx2 = b.x + b.w;
  const by1 = b.y;
  const by2 = b.y + b.h;
  const paddedOverlap = ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1;
  if (paddedOverlap) return true;
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  return Math.abs(acx - bcx) < 0.22 && Math.abs(acy - bcy) < 0.16;
}

function unionRect(a: Rect, b: Rect): Rect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return clampRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
}

function expandLikelyItemRect(rect: Rect, evidenceCount: number): Rect {
  const single = evidenceCount <= 1;
  const padX = Math.max(single ? 0.16 : 0.1, Math.min(0.22, rect.w * 0.58));
  const padY = Math.max(single ? 0.12 : 0.08, Math.min(0.2, rect.h * 0.76));
  return clampRect({
    x: rect.x - padX,
    y: rect.y - padY,
    w: rect.w + padX * 2,
    h: rect.h + padY * 2,
  });
}

function dedupeItems(items: NativeVisionItem[]): NativeVisionItem[] {
  const result: NativeVisionItem[] = [];
  items.forEach((item) => {
    if (result.some((existing) => overlapRatio(existing.rect, item.rect) > 0.58)) return;
    result.push(item);
  });
  return result;
}

function overlapRatio(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? intersection / smaller : 0;
}

function estimateBorderColor(data: Uint8ClampedArray, width: number, height: number) {
  const samples: Array<{ r: number; g: number; b: number }> = [];
  const step = Math.max(1, Math.floor(Math.max(width, height) / 80));
  for (let x = 0; x < width; x += step) {
    samples.push(pixelAt(data, width, x, 0), pixelAt(data, width, x, height - 1));
  }
  for (let y = 0; y < height; y += step) {
    samples.push(pixelAt(data, width, 0, y), pixelAt(data, width, width - 1, y));
  }
  return {
    r: median(samples.map((sample) => sample.r)),
    g: median(samples.map((sample) => sample.g)),
    b: median(samples.map((sample) => sample.b)),
  };
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function connectedComponents(mask: Uint8Array, width: number, height: number): Rect[] {
  const visited = new Uint8Array(mask.length);
  const rects: Rect[] = [];
  const queue: number[] = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || visited[i]) continue;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    visited[i] = 1;
    queue.push(i);
    while (queue.length) {
      const current = queue.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        const nx = next % width;
        const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (count >= Math.max(8, width * height * 0.0004)) {
      rects.push(
        clampRect({
          x: minX / width,
          y: minY / height,
          w: Math.max(1, maxX - minX + 1) / width,
          h: Math.max(1, maxY - minY + 1) / height,
        })
      );
    }
  }
  return rects;
}
