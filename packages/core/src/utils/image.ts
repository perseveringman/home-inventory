/**
 * 图片处理：压缩、裁剪、生成缩略图、Blob ↔ base64。
 * 依赖浏览器 API（Canvas / createImageBitmap），在 Expo 端需另行实现。
 */

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
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
  rect: { x: number; y: number; w: number; h: number },
  maxSize = 280
): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(photoBlob);
    const sx = Math.max(0, rect.x * bmp.width);
    const sy = Math.max(0, rect.y * bmp.height);
    const sw = Math.min(bmp.width - sx, rect.w * bmp.width);
    const sh = Math.min(bmp.height - sy, rect.h * bmp.height);
    if (sw < 24 || sh < 24) {
      bmp.close();
      return null;
    }
    const scale = Math.min(1, maxSize / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const c = document.createElement('canvas');
    c.width = dw;
    c.height = dh;
    c.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
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

export async function generateItemThumb(name: string, emoji = ''): Promise<Blob> {
  const S = 160;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const hue = nameToHue(name);
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, `hsl(${hue}, 65%, 88%)`);
  grad.addColorStop(1, `hsl(${(hue + 30) % 360}, 55%, 78%)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  (ctx as any).roundRect?.(0, 0, S, S, 20);
  ctx.fill();
  if (emoji) {
    ctx.font = '48px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, S / 2, S / 2 - 14);
  }
  ctx.font = 'bold 13px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = '#1e293b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = name.length > 5 ? name.slice(0, 5) + '…' : name;
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
