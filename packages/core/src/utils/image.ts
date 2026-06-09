/**
 * 图片处理：压缩、裁剪、生成缩略图、Blob ↔ base64。
 * 依赖浏览器 API（Canvas / createImageBitmap），在 Expo 端需另行实现。
 */

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface ImageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropItemOptions {
  maxSize?: number;
  paddingRatio?: number;
  contain?: boolean;
  background?: string;
}

export async function compressImage(
  file: Blob,
  maxSide = 1600,
  quality = 0.82
): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    const blob = await new Promise<Blob>((r) => {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      c.toBlob((b) => r(b!), 'image/png');
    });
    return { blob, width: 1, height: 1 };
  }
  let { width, height } = bitmap;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob>((res) =>
    canvas.toBlob((b) => res(b!), 'image/jpeg', quality)
  );
  bitmap.close?.();
  return { blob, width, height };
}

export async function cropItemFromPhoto(
  photoBlob: Blob,
  rect: ImageRect,
  maxSizeOrOptions: number | CropItemOptions = 280
): Promise<Blob | null> {
  try {
    const options: CropItemOptions =
      typeof maxSizeOrOptions === 'number'
        ? { maxSize: maxSizeOrOptions }
        : maxSizeOrOptions || {};
    const maxSize = Math.max(1, Math.round(options.maxSize || 280));
    const paddingRatio = Math.max(0, Math.min(1, options.paddingRatio || 0));
    const bmp = await createImageBitmap(photoBlob);
    let sx = Math.max(0, rect.x * bmp.width);
    let sy = Math.max(0, rect.y * bmp.height);
    let sw = Math.min(bmp.width - sx, rect.w * bmp.width);
    let sh = Math.min(bmp.height - sy, rect.h * bmp.height);
    if (paddingRatio > 0) {
      const padX = sw * paddingRatio;
      const padY = sh * paddingRatio;
      const x2 = Math.min(bmp.width, sx + sw + padX);
      const y2 = Math.min(bmp.height, sy + sh + padY);
      sx = Math.max(0, sx - padX);
      sy = Math.max(0, sy - padY);
      sw = x2 - sx;
      sh = y2 - sy;
    }
    if (sw < 24 || sh < 24) {
      bmp.close();
      return null;
    }
    const c = document.createElement('canvas');
    if (options.contain) {
      c.width = maxSize;
      c.height = maxSize;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = options.background || '#ffffff';
      ctx.fillRect(0, 0, maxSize, maxSize);
      const scale = Math.min(maxSize / sw, maxSize / sh);
      const dw = Math.max(1, Math.round(sw * scale));
      const dh = Math.max(1, Math.round(sh * scale));
      ctx.drawImage(
        bmp,
        sx,
        sy,
        sw,
        sh,
        Math.round((maxSize - dw) / 2),
        Math.round((maxSize - dh) / 2),
        dw,
        dh
      );
    } else {
      const scale = Math.min(1, maxSize / Math.max(sw, sh));
      const dw = Math.max(1, Math.round(sw * scale));
      const dh = Math.max(1, Math.round(sh * scale));
      c.width = dw;
      c.height = dh;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
    }
    bmp.close();
    return await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.82));
  } catch {
    return null;
  }
}

function nameToHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

function drawStickerGlyph(ctx: CanvasRenderingContext2D, size: number, hue: number) {
  const cx = size / 2;
  const cy = size / 2 - 14;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const body = ctx.createLinearGradient(cx - 36, cy - 34, cx + 34, cy + 36);
  body.addColorStop(0, '#fff7d6');
  body.addColorStop(1, `hsl(${(hue + 70) % 360}, 95%, 66%)`);
  ctx.fillStyle = body;
  ctx.strokeStyle = '#171717';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy - 20);
  ctx.quadraticCurveTo(cx - 34, cy - 42, cx - 12, cy - 42);
  ctx.lineTo(cx + 18, cy - 42);
  ctx.quadraticCurveTo(cx + 38, cy - 42, cx + 38, cy - 20);
  ctx.lineTo(cx + 34, cy + 34);
  ctx.quadraticCurveTo(cx + 32, cy + 46, cx + 18, cy + 46);
  ctx.lineTo(cx - 20, cy + 46);
  ctx.quadraticCurveTo(cx - 34, cy + 46, cx - 36, cy + 34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = `hsl(${hue}, 92%, 62%)`;
  ctx.strokeStyle = '#171717';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy - 22);
  ctx.lineTo(cx + 30, cy - 28);
  ctx.lineTo(cx + 34, cy - 8);
  ctx.lineTo(cx - 30, cy - 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.ellipse(cx - 12, cy - 26, 12, 5, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#171717';
  ctx.beginPath();
  ctx.arc(cx - 11, cy + 15, 4, 0, Math.PI * 2);
  ctx.arc(cx + 12, cy + 15, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#171717';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy + 20, 12, 0.15, Math.PI - 0.15);
  ctx.stroke();
  ctx.restore();
}

export async function generateItemThumb(name: string, _symbol = ''): Promise<Blob> {
  const S = 160;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const hue = nameToHue(name);
  ctx.clearRect(0, 0, S, S);
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 6;
  const grad = ctx.createLinearGradient(12, 12, S - 12, S - 12);
  grad.addColorStop(0, `hsl(${hue}, 92%, 68%)`);
  grad.addColorStop(1, `hsl(${(hue + 34) % 360}, 92%, 55%)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  (ctx as any).roundRect?.(10, 10, S - 20, S - 20, 34);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#171717';
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(62, 38, 34, Math.PI * 1.05, Math.PI * 1.72);
  ctx.stroke();
  drawStickerGlyph(ctx, S, hue);
  ctx.shadowColor = 'transparent';
  ctx.font = '900 14px -apple-system, "PingFang SC", sans-serif';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#171717';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = name.length > 5 ? name.slice(0, 5) + '…' : name;
  ctx.strokeText(label, S / 2, S - 17);
  ctx.fillText(label, S / 2, S - 14);
  return new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png'));
}

export async function fileToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export { nameToHue };
