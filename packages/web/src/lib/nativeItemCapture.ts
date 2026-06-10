import {
  GLOBAL_ROOM_ID,
  PRESET_TAGS,
  ensureGlobalLooseCabinet,
  ensureLooseCabinet,
  logAction,
  uid,
  type Item,
  type Photo,
  type Rect,
} from '@home-inventory/core';
import { getStorage } from '../stores/useStore';
import {
  addNativeItemImagesReadyListener,
  applyNativeRecognizedItemLabels,
  base64ToBlob,
  canUseNativeVision,
  captureRecognizedItemsWithNativeVision,
  type NativeVisionRecognizedCapture,
} from './nativeVision';
import { recognizeNativeItemLabels } from './nativeItemLLM';

export interface NativeItemReviewDraft {
  sourceId: string;
  name: string;
  nativeCategory?: string;
  categoryConfidence?: number;
  image: Blob;
  rect?: Rect;
  confidence?: number;
  expiry?: string;
  rotation?: number;
}

let nativeItemLLMBridgeStarted = false;

function uniqueNativeItemTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const value = tag.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function getNativeItemAllowedTags(): Promise<string[]> {
  const storage = getStorage();
  const items = await storage.all('items').catch(() => [] as Item[]);
  return uniqueNativeItemTags([
    ...PRESET_TAGS.map((tag) => tag.name),
    ...items.flatMap((item) => item.tags || []),
  ]);
}

function ensureNativeItemLLMBridge(): void {
  if (!canUseNativeVision() || nativeItemLLMBridgeStarted) return;
  nativeItemLLMBridgeStarted = true;
  void addNativeItemImagesReadyListener((event) => {
    void (async () => {
      try {
        const allowedCategories = await getNativeItemAllowedTags();
        const labels = await recognizeNativeItemLabels(
          (event.items || []).map((item) => ({
            id: item.id,
            image: base64ToBlob(item.imageBase64, item.imageMimeType || 'image/png'),
          })),
          { allowedCategories }
        );
        if (labels.length) {
          await applyNativeRecognizedItemLabels(event.sessionId, labels);
        }
      } catch (err) {
        console.warn('Native item LLM bridge failed:', err);
      }
    })();
  }).catch((err) => {
    nativeItemLLMBridgeStarted = false;
    console.warn('Native item LLM listener failed:', err);
  });
}

export async function captureNativeItemsForReview(): Promise<NativeVisionRecognizedCapture | null> {
  ensureNativeItemLLMBridge();
  const capture = await captureRecognizedItemsWithNativeVision();
  if (!capture) return null;
  if (!capture.items.length) {
    throw new Error('没有识别到可生成贴纸的物品');
  }
  return capture;
}

export async function captureNativeItemsIntoInbox(roomId?: string): Promise<{ photo: Photo; items: Item[] } | null> {
  const capture = await captureNativeItemsForReview();
  if (!capture) return null;
  return saveNativeCaptureReviewToInbox({
    roomId,
    capture,
    drafts: capture.items.map((item, index) => ({
      sourceId: item.id,
      name: item.nameHint || item.nativeCategory || `物品 ${index + 1}`,
      nativeCategory: item.nativeCategory || item.nameHint,
      categoryConfidence: item.categoryConfidence,
      image: item.image,
      rect: item.rect,
      confidence: item.confidence,
      expiry: item.expiry,
      rotation: item.rotation,
    })),
  });
}

export async function saveNativeCaptureReviewToInbox(input: {
  roomId?: string;
  capture: NativeVisionRecognizedCapture;
  drafts: NativeItemReviewDraft[];
}): Promise<{ photo: Photo; items: Item[] }> {
  const storage = getStorage();
  const roomId = input.roomId || GLOBAL_ROOM_ID;
  const targetCabinet =
    roomId === GLOBAL_ROOM_ID
      ? await ensureGlobalLooseCabinet(storage)
      : await ensureLooseCabinet(storage, roomId);

  const photo: Photo = {
    id: uid(),
    roomId: targetCabinet.roomId,
    blob: input.capture.photo,
    width: input.capture.width,
    height: input.capture.height,
    createdAt: Date.now(),
  };
  await storage.put('photos', photo);

  const created: Item[] = [];
  for (let index = 0; index < input.drafts.length; index += 1) {
    const draft = input.drafts[index]!;
    const name = draft.name.trim() || draft.nativeCategory || `物品 ${index + 1}`;
    const nativeTag = draft.nativeCategory?.trim();
    const item: Item = {
      id: uid(),
      cabinetId: targetCabinet.id,
      roomId: targetCabinet.roomId,
      name,
      qty: 1,
      note: '',
      tags: nativeTag ? [nativeTag] : [],
      image: draft.image,
      expiry: draft.expiry || undefined,
      status: 'pending',
      source: 'manual',
      sourcePhotoId: photo.id,
      aiRect: draft.rect,
      confidence: draft.categoryConfidence || draft.confidence,
      aiReason: draft.nativeCategory
        ? `LLM 分类：${draft.nativeCategory}`
        : 'iOS 原生抠图生成，用户确认后放入收集箱',
      reviewStatus: 'edited',
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
    };
    await storage.put('items', item);
    created.push(item);
  }

  await logAction(storage, {
    source: 'system',
    type: 'native_capture_items_confirmed',
    summary: `本机贴纸已放入收集箱：${created.length} 件`,
    targetType: 'photo',
    targetId: photo.id,
    after: {
      roomId: targetCabinet.roomId,
      itemIds: created.map((item) => item.id),
    },
  });

  return {
    photo,
    items: created,
  };
}
