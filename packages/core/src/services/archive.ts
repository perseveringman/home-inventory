import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type {
  ActionLog,
  Cabinet,
  Item,
  Label,
  Photo,
  RecognitionTask,
  Room,
  ScanSession,
  Subscription,
} from '../models';
import type { Storage } from '../storage/types';

interface ExportPayload {
  version: 2;
  exportedAt: string;
  rooms: Room[];
  photos: Array<Omit<Photo, 'blob'> & { blob: string }>;
  cabinets: Cabinet[];
  items: Array<Omit<Item, 'image'> & { image?: string }>;
  subscriptions: Subscription[];
  recognitionTasks?: RecognitionTask[];
  scanSessions?: ScanSession[];
  labels?: Label[];
  actionLogs?: ActionLog[];
}

export interface ArchiveFile {
  path: string;
  content: string | Blob;
}

async function blobToDataUrl(blob?: Blob): Promise<string | undefined> {
  if (!blob) return undefined;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

function slug(raw: string, fallback: string) {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[\s_/\\]+/g, '-')
      .replace(/[^\p{L}\p{N}-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || fallback
  );
}

export async function buildFileTree(storage: Storage): Promise<ArchiveFile[]> {
  const [rooms, photos, cabinets, items, subscriptions, recognitionTasks, scanSessions, labels, actionLogs] =
    await Promise.all([
    storage.all('rooms'),
    storage.all('photos'),
    storage.all('cabinets'),
    storage.all('items'),
    storage.all('subscriptions'),
    storage.all('recognitionTasks'),
    storage.all('scanSessions'),
    storage.all('labels'),
    storage.all('actionLogs'),
  ]);
  const files: ArchiveFile[] = [
    {
      path: 'inventory.json',
      content: JSON.stringify(
        {
          version: '2.0',
          generated_at: new Date().toISOString(),
          stats: {
            rooms: rooms.length,
            photos: photos.length,
            cabinets: cabinets.length,
            items: items.length,
            subscriptions: subscriptions.length,
            recognitionTasks: recognitionTasks.length,
            scanSessions: scanSessions.length,
            labels: labels.length,
            total_qty: items.reduce((sum, item) => sum + (item.qty || 1), 0),
          },
        },
        null,
        2
      ),
    },
    {
      path: 'README.md',
      content:
        '# Home Inventory Export\n\n此归档由家居收纳应用导出，包含 inventory.json、完整 JSON 数据和照片/物品图片资源。\n',
    },
  ];
  const payload: ExportPayload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    rooms,
    photos: [],
    cabinets,
    items: [],
    subscriptions,
    recognitionTasks,
    scanSessions,
    labels,
    actionLogs,
  };
  for (const photo of photos) {
    payload.photos.push({ ...photo, blob: (await blobToDataUrl(photo.blob)) || '' });
    const room = rooms.find((r) => r.id === photo.roomId);
    files.push({
      path: `rooms/${slug(room?.name || photo.roomId, 'room')}/photos/${photo.id}.jpg`,
      content: photo.blob,
    });
  }
  for (const item of items) {
    payload.items.push({ ...item, image: await blobToDataUrl(item.image) });
  }
  files.push({ path: 'data/home-inventory-v2.json', content: JSON.stringify(payload, null, 2) });
  return files;
}

export async function filesToZipBlob(files: ArchiveFile[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    if (typeof file.content === 'string') {
      entries[file.path] = strToU8(file.content);
    } else {
      entries[file.path] = new Uint8Array(await file.content.arrayBuffer());
    }
  }
  const zipped = zipSync(entries, { level: 6 });
  const copy = new Uint8Array(zipped.length);
  copy.set(zipped);
  return new Blob([copy.buffer], { type: 'application/zip' });
}

export async function exportZip(storage: Storage): Promise<Blob> {
  return filesToZipBlob(await buildFileTree(storage));
}

export async function zipBlobToFiles(zipBlob: Blob): Promise<ArchiveFile[]> {
  const unzipped = unzipSync(new Uint8Array(await zipBlob.arrayBuffer()));
  return Object.entries(unzipped).map(([path, bytes]) => {
    const isText = /\.(json|md|txt)$/i.test(path);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return {
      path,
      content: isText ? strFromU8(bytes) : new Blob([copy.buffer]),
    };
  });
}

export async function parseFileTree(files: ArchiveFile[]): Promise<ExportPayload> {
  const dataFile = files.find((file) => file.path === 'data/home-inventory-v2.json');
  if (!dataFile || typeof dataFile.content !== 'string') {
    throw new Error('未找到 data/home-inventory-v2.json，无法导入');
  }
  const payload = JSON.parse(dataFile.content) as ExportPayload;
  if (payload.version !== 2) throw new Error('不支持的导入文件版本');
  return payload;
}

export async function importZip(storage: Storage, zipBlob: Blob, replace = true): Promise<void> {
  const payload = await parseFileTree(await zipBlobToFiles(zipBlob));
  if (replace) await storage.clearAll();
  for (const room of payload.rooms) await storage.put('rooms', room);
  for (const photo of payload.photos) {
    await storage.put('photos', { ...photo, blob: await dataUrlToBlob(photo.blob) });
  }
  for (const cabinet of payload.cabinets) await storage.put('cabinets', cabinet);
  for (const item of payload.items) {
    await storage.put('items', {
      ...item,
      image: item.image ? await dataUrlToBlob(item.image) : undefined,
    });
  }
  for (const sub of payload.subscriptions) await storage.put('subscriptions', sub);
  for (const task of payload.recognitionTasks || []) await storage.put('recognitionTasks', task);
  for (const session of payload.scanSessions || []) await storage.put('scanSessions', session);
  for (const label of payload.labels || []) await storage.put('labels', label);
  for (const log of payload.actionLogs || []) await storage.put('actionLogs', log);
}
