"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRecognitionTask = createRecognitionTask;
exports.resetRecognitionTask = resetRecognitionTask;
exports.markRecognitionTaskProcessing = markRecognitionTaskProcessing;
exports.runRecognitionTask = runRecognitionTask;
const id_1 = require("../utils/id");
const ai_1 = require("./ai");
const actionLog_1 = require("./actionLog");
const scanReview_1 = require("./scanReview");
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err || 'unknown');
}
async function createRecognitionTask(storage, photo, source) {
    const task = {
        id: (0, id_1.uid)(),
        photoId: photo.id,
        roomId: photo.roomId,
        source,
        status: 'queued',
        createdAt: Date.now(),
    };
    await storage.put('recognitionTasks', task);
    await (0, actionLog_1.logAction)(storage, {
        source: 'system',
        type: 'recognition_task_queued',
        summary: '照片已进入 AI 识别队列',
        targetType: 'recognitionTask',
        targetId: task.id,
        after: { photoId: photo.id, roomId: photo.roomId, source },
    });
    return task;
}
async function resetRecognitionTask(storage, taskId) {
    const task = await storage.get('recognitionTasks', taskId);
    if (!task)
        throw new Error('识别任务不存在');
    const next = {
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
async function markRecognitionTaskProcessing(storage, taskId) {
    const task = await storage.get('recognitionTasks', taskId);
    if (!task)
        throw new Error('识别任务不存在');
    const next = {
        ...task,
        status: 'processing',
        startedAt: Date.now(),
        completedAt: undefined,
        errorMessage: undefined,
    };
    await storage.put('recognitionTasks', next);
    return next;
}
async function runRecognitionTask(storage, taskId) {
    const processingTask = await markRecognitionTaskProcessing(storage, taskId);
    const photo = await storage.get('photos', processingTask.photoId);
    if (!photo) {
        const failed = {
            ...processingTask,
            status: 'failed',
            completedAt: Date.now(),
            errorMessage: '来源照片不存在',
        };
        await storage.put('recognitionTasks', failed);
        return failed;
    }
    try {
        const result = await (0, ai_1.detectCabinetsAndItems)(photo.blob, { width: photo.width, height: photo.height }, {});
        const session = await (0, scanReview_1.createScanSessionFromDetection)(storage, photo, result);
        const completed = {
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
        await (0, actionLog_1.logAction)(storage, {
            source: 'ai',
            type: 'recognition_task_completed',
            summary: `识别任务完成：${result.cabinets.length} 个柜子 · ${result.items.length} 件物品`,
            targetType: 'recognitionTask',
            targetId: completed.id,
            after: { scanSessionId: session.id },
        });
        return completed;
    }
    catch (err) {
        const failed = {
            ...processingTask,
            status: 'failed',
            completedAt: Date.now(),
            errorMessage: errorMessage(err),
        };
        await storage.put('recognitionTasks', failed);
        await (0, actionLog_1.logAction)(storage, {
            source: 'ai',
            type: 'recognition_task_failed',
            summary: `识别任务失败：${failed.errorMessage}`,
            targetType: 'recognitionTask',
            targetId: failed.id,
        });
        throw err;
    }
}
