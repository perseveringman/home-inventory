/**
 * 跨平台"导出文件"：原生（Capacitor iOS/Android）走 Filesystem 写文件 + Share 弹系统分享面板，
 * Web 回退到 a[download] 直接触发浏览器下载。
 *
 * 之所以分两套：
 * - WKWebView 对 a[download] 的 blob URL 几乎不响应，用户在 iOS app 里点"导出"会无反应。
 * - 走 Filesystem.Documents + Share.share 后，可以让用户存到"文件" app、AirDrop、微信等。
 */

import { Capacitor } from '@capacitor/core';

/** 把 Blob 转 base64（不含 data: 前缀） */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Web 浏览器下走 a[download] */
function downloadInBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * 把 blob 以指定文件名"交付"给用户。
 * - 浏览器：触发下载到默认下载目录
 * - 原生壳：先写入 Documents/，再调起系统分享面板
 *
 * mimeType 可选；不传时尝试用 blob.type，再不行就 application/octet-stream。
 */
export async function shareOrDownloadBlob(
  blob: Blob,
  filename: string,
  options: { dialogTitle?: string; mimeType?: string } = {}
): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(blob, filename);
    return;
  }

  // 动态 import 避免纯 web 构建拉进原生插件
  const { Filesystem, Directory, Encoding: _Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  void _Encoding;

  const data = await blobToBase64(blob);
  // Documents 目录在 iOS 上对应 app 沙盒内的 Documents/，可被"文件" app 看到
  const written = await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Documents,
  });

  try {
    await Share.share({
      title: options.dialogTitle || filename,
      url: written.uri,
      dialogTitle: options.dialogTitle || '导出文件',
    });
  } catch (err: any) {
    // 用户在分享面板上点取消会抛 error，吞掉
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('cancel') || msg.includes('canceled') || msg.includes('cancelled')) return;
    throw err;
  }
}

/** 文件已经持久化在 Documents/，调用方仅想再次唤起分享面板 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}
