import type { Photo, RecognitionTask, RecognitionTaskSource } from '../models';
import type { Storage } from '../storage/types';
import { uid } from '../utils/id';
import { detectCabinetsAndItems } from './ai';
import { logAction } from './actionLog';
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
