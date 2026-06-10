/**
 * 跨平台图片选择：原生（Capacitor）下走系统相机/相册，Web 下回退到 <input type="file">。
 *
 * 用法：
 *   const file = await pickImage({ source: 'camera' });   // 拍照
 *   const file = await pickImage({ source: 'gallery' });  // 相册
 *   const file = await pickImage({ source: 'prompt' });   // 让系统弹出选项
 *   if (!file) return;  // 用户取消
 *
 * 返回 File（取消时为 null），上层逻辑可以继续走 compressImage()。
 */

import { Capacitor } from '@capacitor/core';
import { canUseNativeVision, capturePhotoWithNativeVision } from './nativeVision';

export type PickSource = 'camera' | 'gallery' | 'prompt';

export interface PickOptions {
  source?: PickSource;
  /** 仅 Web fallback 用：传入或不传都不影响原生路径 */
  accept?: string;
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/** 通过隐藏 <input type="file"> 选一张图（Web fallback） */
function pickViaInput(opts: { accept: string; capture?: 'environment' | 'user' }): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = opts.accept;
    if (opts.capture) input.setAttribute('capture', opts.capture);
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      // 延迟移除，避免某些浏览器在 change 事件中过早回收输入
      setTimeout(() => input.remove(), 0);
      resolve(file);
    };
    input.addEventListener('change', () => {
      const f = input.files?.[0] || null;
      finish(f);
    });
    // 用户取消选择不会触发 change；监听 window.focus 兜底（部分浏览器可用）
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      // 给 change 事件让一会儿先行
      setTimeout(() => finish(null), 500);
    };
    window.addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

/** 把 dataUrl 转成 File（带文件名 / mimetype） */
async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

/** 把 webPath（capacitor:// 或 file://）转成 File */
async function webPathToFile(webPath: string, filename: string, mime: string): Promise<File> {
  const res = await fetch(webPath);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || mime || 'image/jpeg' });
}

/**
 * 选一张图片。原生用 @capacitor/camera，Web 用 <input>。
 */
export async function pickImage(options: PickOptions = {}): Promise<File | null> {
  const source = options.source || 'prompt';

  if (isNativePlatform()) {
    if (source === 'camera' && canUseNativeVision()) {
      const blob = await capturePhotoWithNativeVision();
      if (!blob) return null;
      return new File([blob], `photo-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
    }

    // 动态 import 避免在纯 web 构建里引入原生插件代码
    const { Camera, CameraSource, CameraResultType } = await import('@capacitor/camera');
    const sourceMap: Record<PickSource, any> = {
      camera: CameraSource.Camera,
      gallery: CameraSource.Photos,
      prompt: CameraSource.Prompt,
    };
    try {
      const photo = await Camera.getPhoto({
        source: sourceMap[source],
        resultType: CameraResultType.DataUrl,
        // 不让插件提前压缩，交给业务层 compressImage 统一处理
        quality: 92,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (!photo?.dataUrl) return null;
      const ext = photo.format || 'jpeg';
      const filename = `photo-${Date.now()}.${ext === 'jpg' ? 'jpg' : ext}`;
      return dataUrlToFile(photo.dataUrl, filename);
    } catch (err: any) {
      // 用户取消会抛 "User cancelled photos app"，当作正常 null 返回
      const msg = String(err?.message || err || '').toLowerCase();
      if (msg.includes('cancel')) return null;
      throw err;
    }
    void webPathToFile; // keep helper for future use
  }

  // Web fallback
  const accept = options.accept || 'image/*';
  if (source === 'camera') return pickViaInput({ accept, capture: 'environment' });
  return pickViaInput({ accept });
}
