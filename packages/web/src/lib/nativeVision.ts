import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
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

export interface NativeVisionCapturePhotoResult {
  base64?: string;
  mimeType?: string;
  cancelled?: boolean;
}

export interface NativeVisionCapturedItemResult {
  id?: string;
  name?: string;
  nativeCategory?: string;
  categoryConfidence?: number;
  rect: Rect;
  confidence?: number;
  source?: NativeVisionItem['source'];
  imageBase64: string;
  imageMimeType?: string;
  cutoutBase64?: string;
  cutoutMimeType?: string;
  expiry?: string;
  rotation?: number;
}

export interface NativeVisionRecognizedCaptureResult {
  cancelled?: boolean;
  photoBase64?: string;
  photoMimeType?: string;
  width?: number;
  height?: number;
  items?: NativeVisionCapturedItemResult[];
}

export interface NativeVisionCapturedSticker {
  id: string;
  nameHint?: string;
  nativeCategory?: string;
  categoryConfidence?: number;
  rect: Rect;
  confidence?: number;
  image: Blob;
  cutout?: Blob;
  expiry?: string;
  rotation?: number;
}

export interface NativeVisionItemImagesReadyEvent {
  sessionId: string;
  items: Array<{
    id: string;
    imageBase64: string;
    imageMimeType?: string;
  }>;
}

export interface NativeVisionRecognizedItemLabel {
  id: string;
  name?: string;
  category?: string;
}

export interface NativeVisionRecognizedCapture {
  photo: Blob;
  width: number;
  height: number;
  items: NativeVisionCapturedSticker[];
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
  capturePhoto(): Promise<NativeVisionCapturePhotoResult>;
  captureRecognizedItems(): Promise<NativeVisionRecognizedCaptureResult>;
  applyRecognizedItemLabels(options: {
    sessionId: string;
    items: NativeVisionRecognizedItemLabel[];
  }): Promise<{ ok?: boolean }>;
  addListener(
    eventName: 'nativeItemImagesReady',
    listenerFunc: (event: NativeVisionItemImagesReadyEvent) => void
  ): Promise<PluginListenerHandle>;
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

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function addNativeItemImagesReadyListener(
  listener: (event: NativeVisionItemImagesReadyEvent) => void
): Promise<PluginListenerHandle> {
  return NativeVision.addListener('nativeItemImagesReady', listener);
}

export async function applyNativeRecognizedItemLabels(
  sessionId: string,
  items: NativeVisionRecognizedItemLabel[]
): Promise<void> {
  if (!canUseNativeVision() || !sessionId || !items.length) return;
  await NativeVision.applyRecognizedItemLabels({ sessionId, items });
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

export async function capturePhotoWithNativeVision(): Promise<Blob | null> {
  if (!canUseNativeVision()) return null;
  const result = await NativeVision.capturePhoto();
  if (result?.cancelled || !result?.base64) return null;
  return base64ToBlob(result.base64, result.mimeType || 'image/jpeg');
}

export async function captureRecognizedItemsWithNativeVision(): Promise<NativeVisionRecognizedCapture | null> {
  if (!canUseNativeVision()) return null;
  const result = await NativeVision.captureRecognizedItems();
  if (result?.cancelled || !result?.photoBase64) return null;
  const photo = base64ToBlob(result.photoBase64, result.photoMimeType || 'image/jpeg');
  const items = (result.items || [])
    .filter((item) => item.imageBase64 && item.rect)
    .map((item, index) => ({
      id: item.id || `native-item-${index + 1}`,
      nameHint: item.name && !/^物品\s*\d+$/i.test(item.name) ? item.name : undefined,
      nativeCategory: item.nativeCategory,
      categoryConfidence: item.categoryConfidence,
      rect: item.rect,
      confidence: item.confidence,
      image: base64ToBlob(item.imageBase64, item.imageMimeType || 'image/png'),
      cutout: item.cutoutBase64 ? base64ToBlob(item.cutoutBase64, item.cutoutMimeType || 'image/png') : undefined,
      expiry: item.expiry,
      rotation: item.rotation,
    }));
  return {
    photo,
    width: result.width || 0,
    height: result.height || 0,
    items,
  };
}
