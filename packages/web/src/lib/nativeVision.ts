import { Capacitor, registerPlugin } from '@capacitor/core';
import { fileToBase64, type Rect } from '@home-inventory/core';

export interface NativeVisionItem {
  id?: string;
  name: string;
  rect: Rect;
  confidence?: number;
  source?: 'subject' | 'foreground' | 'saliency' | 'ocr' | 'barcode';
  text?: string[];
  barcode?: string;
}

export interface NativeVisionResult {
  width: number;
  height: number;
  items: NativeVisionItem[];
  texts?: Array<{ value: string; rect: Rect; confidence?: number }>;
  barcodes?: Array<{ value: string; symbology?: string; rect: Rect; confidence?: number }>;
}

export interface NativeVisionRemoveBackgroundResult {
  base64: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

interface NativeVisionPlugin {
  analyzeImage(options: {
    base64: string;
    minArea?: number;
    maxItems?: number;
  }): Promise<NativeVisionResult>;
  removeBackground(options: {
    base64: string;
  }): Promise<NativeVisionRemoveBackgroundResult>;
}

const NativeVision = registerPlugin<NativeVisionPlugin>('NativeVision');

export function canUseNativeVision(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

export async function analyzeImageWithNativeVision(blob: Blob): Promise<NativeVisionResult | null> {
  if (!canUseNativeVision()) return null;
  try {
    const base64 = await fileToBase64(blob);
    const result = await NativeVision.analyzeImage({
      base64,
      minArea: 0.003,
      maxItems: 16,
    });
    return result?.items ? result : null;
  } catch (err) {
    console.warn('NativeVision analyze failed, keep manual item-box flow:', err);
    return null;
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function removeBackgroundWithNativeVision(blob: Blob): Promise<Blob | null> {
  if (!canUseNativeVision()) return null;
  try {
    const base64 = await fileToBase64(blob);
    const result = await NativeVision.removeBackground({ base64 });
    if (!result?.base64) return null;
    return base64ToBlob(result.base64, result.mimeType || 'image/png');
  } catch (err) {
    console.warn('NativeVision background removal failed, keep original item crop:', err);
    return null;
  }
}
