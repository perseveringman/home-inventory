import {
  GLOBAL_ROOM_ID,
  type Item,
  type Photo,
  type RecognitionTask,
  type RecognitionTaskNativeItem,
  type RecognitionTaskSource,
} from '../models';
import type { Storage } from '../storage/types';
import { uid } from '../utils/id';
import { detectCabinetsAndItems } from './ai';
import { logAction } from './actionLog';
import { ensureGlobalLooseCabinet, ensureLooseCabinet } from './cabinet';
import { suggestItemDraft, type ItemDraftSuggestion } from './itemSuggestion';
import { createScanSessionFromDetection } from './scanReview';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err || 'unknown');
}

export async function createRecognitionTask(
  storage: Storage,
  photo: Photo,
  source: RecognitionTaskSource
): Promise<RecognitionTask> {
  const task: RecognitionTask = {
    id: uid(),
    photoId: photo.id,
    roomId: photo.roomId,
    source,
    status: 'queued',
    createdAt: Date.now(),
  };
  await storage.put('recognitionTasks', task);
  await logAction(storage, {
    source: 'system',
    type: 'recognition_task_queued',
    summary: '照片已进入 AI 识别队列',
    targetType: 'recognitionTask',
    targetId: task.id,
    after: { photoId: photo.id, roomId: photo.roomId, source },
  });
  return task;
}

export async function createNativeItemRecognitionTask(
  storage: Storage,
  input: {
    photo: Photo;
    items: RecognitionTaskNativeItem[];
  }
): Promise<RecognitionTask> {
  const task: RecognitionTask = {
    id: uid(),
    photoId: input.photo.id,
    roomId: input.photo.roomId,
    source: 'native-items',
    status: 'queued',
    createdAt: Date.now(),
    nativeItems: input.items,
    candidateCounts: {
      cabinets: 0,
      items: input.items.length,
    },
  };
  await storage.put('recognitionTasks', task);
  await logAction(storage, {
    source: 'system',
    type: 'native_item_task_queued',
    summary: `本机物品已提交后台识别：${input.items.length} 件`,
    targetType: 'recognitionTask',
    targetId: task.id,
    after: { photoId: input.photo.id, roomId: input.photo.roomId, count: input.items.length },
  });
  return task;
}

export async function resetRecognitionTask(storage: Storage, taskId: string): Promise<RecognitionTask> {
  const task = await storage.get('recognitionTasks', taskId);
  if (!task) throw new Error('识别任务不存在');
  const next: RecognitionTask = {
    ...task,
    status: 'queued',
    startedAt: undefined,
    completedAt: undefined,
    scanSessionId: undefined,
    candidateCounts: undefined,
    errorMessage: undefined,
  };
  await storage.put('recognitionTasks', next);
  return next;
}

function applySuggestion(base: Item, suggestion: ItemDraftSuggestion | null): Item {
  if (!suggestion) return base;
  return {
    ...base,
    name: suggestion.name || base.name,
    qty: suggestion.qty || base.qty,
    note: suggestion.note || base.note,
    tags: suggestion.tags || base.tags,
    expiry: suggestion.expiry || base.expiry,
    openedShelfDays:
      suggestion.openedShelfDays !== undefined ? suggestion.openedShelfDays : base.openedShelfDays,
    warrantyMonths:
      suggestion.warrantyMonths !== undefined ? suggestion.warrantyMonths : base.warrantyMonths,
    minStock: suggestion.minStock !== undefined ? suggestion.minStock : base.minStock,
    season: suggestion.season !== undefined ? suggestion.season : base.season,
    brand: suggestion.brand || base.brand,
    modelNumber: suggestion.modelNumber || base.modelNumber,
    serialNumber: suggestion.serialNumber || base.serialNumber,
    purchasePrice:
      suggestion.purchasePrice !== undefined ? suggestion.purchasePrice : base.purchasePrice,
    manualUrl: suggestion.manualUrl || base.manualUrl,
    receiptNote: suggestion.receiptNote || base.receiptNote,
    aiReason: suggestion.reason || base.aiReason,
  };
}

async function runNativeItemRecognitionTask(
  storage: Storage,
  processingTask: RecognitionTask,
  photo: Photo
): Promise<RecognitionTask> {
  const nativeItems = processingTask.nativeItems || [];
  if (!nativeItems.length) throw new Error('没有可识别的本机物品图');

  const targetCabinet =
    processingTask.roomId === GLOBAL_ROOM_ID
      ? await ensureGlobalLooseCabinet(storage)
      : await ensureLooseCabinet(storage, processingTask.roomId);
  await storage.put('cabinets', targetCabinet);

  const rooms = await storage.all('rooms');
  const cabinets = await storage.all('cabinets');
  let existingItems = await storage.all('items');
  const created: Item[] = [];

  for (let index = 0; index < nativeItems.length; index += 1) {
    const draft = nativeItems[index]!;
    const base: Item = {
      id: uid(),
      cabinetId: targetCabinet.id,
      roomId: targetCabinet.roomId,
      name: draft.nameHint || `待识别物品 ${index + 1}`,
      qty: 1,
      note: '',
      tags: [],
      image: draft.image,
      status: 'pending',
      source: 'ai',
      sourcePhotoId: photo.id,
      aiRect: draft.rect,
      confidence: draft.confidence,
      aiReason: '本机框选裁图，AI 后台识别物品资料',
      reviewStatus: 'pending',
      createdAt: Date.now(),
    };

    let suggestion: ItemDraftSuggestion | null = null;
    try {
      suggestion = await suggestItemDraft(storage, {
        item: base,
        rooms,
        cabinets,
        items: existingItems,
      });
    } catch (err) {
      console.warn('Native item detail recognition failed, keep draft item:', err);
    }

    const item = applySuggestion(base, suggestion);
    await storage.put('items', item);
    created.push(item);
    existingItems = [...existingItems, item];
  }

  const completed: RecognitionTask = {
    ...processingTask,
    status: 'completed',
    completedAt: Date.now(),
    nativeItems: undefined,
    candidateCounts: {
      cabinets: 0,
      items: created.length,
    },
    errorMessage: undefined,
  };
  await storage.put('recognitionTasks', completed);
  await logAction(storage, {
    source: 'ai',
    type: 'native_item_task_completed',
    summary: `本机物品资料识别完成：${created.length} 件进入收集箱`,
    targetType: 'recognitionTask',
    targetId: completed.id,
    after: { itemIds: created.map((item) => item.id), photoId: photo.id },
  });
  return completed;
}

export async function markRecognitionTaskProcessing(
  storage: Storage,
  taskId: string
): Promise<RecognitionTask> {
  const task = await storage.get('recognitionTasks', taskId);
  if (!task) throw new Error('识别任务不存在');
  const next: RecognitionTask = {
    ...task,
    status: 'processing',
    startedAt: Date.now(),
    completedAt: undefined,
    errorMessage: undefined,
  };
  await storage.put('recognitionTasks', next);
  return next;
}

export async function runRecognitionTask(
  storage: Storage,
  taskId: string
): Promise<RecognitionTask> {
  const processingTask = await markRecognitionTaskProcessing(storage, taskId);
  const photo = await storage.get('photos', processingTask.photoId);
  if (!photo) {
    const failed: RecognitionTask = {
      ...processingTask,
      status: 'failed',
      completedAt: Date.now(),
      errorMessage: '来源照片不存在',
    };
    await storage.put('recognitionTasks', failed);
    return failed;
  }

  try {
    if (processingTask.source === 'native-items') {
      return await runNativeItemRecognitionTask(storage, processingTask, photo);
    }

    const result = await detectCabinetsAndItems(photo.blob, { width: photo.width, height: photo.height }, {});
    const session = await createScanSessionFromDetection(storage, photo, result);
    const completed: RecognitionTask = {
      ...processingTask,
      status: 'completed',
      completedAt: Date.now(),
      scanSessionId: session.id,
      candidateCounts: {
        cabinets: result.cabinets.length,
        items: result.items.length,
      },
      errorMessage: undefined,
    };
    await storage.put('recognitionTasks', completed);
    await logAction(storage, {
      source: 'ai',
      type: 'recognition_task_completed',
      summary: `识别任务完成：${result.cabinets.length} 个柜子 · ${result.items.length} 件物品`,
      targetType: 'recognitionTask',
      targetId: completed.id,
      after: { scanSessionId: session.id },
    });
    return completed;
  } catch (err) {
    const failed: RecognitionTask = {
      ...processingTask,
      status: 'failed',
      completedAt: Date.now(),
      errorMessage: errorMessage(err),
    };
    await storage.put('recognitionTasks', failed);
    await logAction(storage, {
      source: 'ai',
      type: 'recognition_task_failed',
      summary: `识别任务失败：${failed.errorMessage}`,
      targetType: 'recognitionTask',
      targetId: failed.id,
    });
    throw err;
  }
}
