import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type {
  ActionLog,
  Cabinet,
  Home,
  Item,
  Label,
  Photo,
  Room,
  ScanSession,
  Subscription,
} from '../models';
import { DEFAULT_HOME_ID, GLOBAL_ROOM_ID } from '../models';
import type { Storage, StoreName } from '../storage/types';
import { uid } from '../utils/id';

export interface ExportPayload {
  version: 2 | 3;
  exportedAt: string;
  home?: Home;
  rooms: Room[];
  photos: Array<Omit<Photo, 'blob'> & { blob: string }>;
  cabinets: Cabinet[];
  items: Array<Omit<Item, 'image'> & { image?: string }>;
  subscriptions: Subscription[];
  scanSessions?: ScanSession[];
  labels?: Label[];
  actionLogs?: ActionLog[];
}

export interface ArchiveFile {
  path: string;
  content: string | Blob;
}

export interface ExportPayloadOptions {
  /**
   * inline: preserve photos and item images as data URLs for ZIP backup.
   * none: keep only structured records for cloud sync; media can be synced later
   * through object storage without bloating the JSON snapshot.
   */
  media?: 'inline' | 'none';
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
  const [homes, rooms, photos, cabinets, items, subscriptions, scanSessions, labels, actionLogs] =
    await Promise.all([
    storage.all('homes'),
    storage.all('rooms'),
    storage.all('photos'),
    storage.all('cabinets'),
    storage.all('items'),
    storage.all('subscriptions'),
    storage.all('scanSessions'),
    storage.all('labels'),
    storage.all('actionLogs'),
  ]);
  const currentHome = homes.find((home) => home.id === storage.homeId);
  const files: ArchiveFile[] = [
    {
      path: 'inventory.json',
      content: JSON.stringify(
        {
          version: '3.0',
          generated_at: new Date().toISOString(),
          home: currentHome
            ? {
                id: currentHome.id,
                name: currentHome.name,
                kind: currentHome.kind,
              }
            : undefined,
          stats: {
            rooms: rooms.length,
            photos: photos.length,
            cabinets: cabinets.length,
            items: items.length,
            subscriptions: subscriptions.length,
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
    version: 3,
    exportedAt: new Date().toISOString(),
    home: currentHome,
    rooms,
    photos: [],
    cabinets,
    items: [],
    subscriptions,
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

export async function exportPayload(
  storage: Storage,
  options: ExportPayloadOptions = {}
): Promise<ExportPayload> {
  const media = options.media || 'inline';
  const [homes, rooms, photos, cabinets, items, subscriptions, scanSessions, labels, actionLogs] =
    await Promise.all([
      storage.all('homes'),
      storage.all('rooms'),
      storage.all('photos'),
      storage.all('cabinets'),
      storage.all('items'),
      storage.all('subscriptions'),
      storage.all('scanSessions'),
      storage.all('labels'),
      storage.all('actionLogs'),
    ]);
  const currentHome = homes.find((home) => home.id === storage.homeId);
  const payload: ExportPayload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    home: currentHome,
    rooms,
    photos: [],
    cabinets: media === 'none' ? cabinets.map((cabinet) => ({ ...cabinet, photoId: null })) : cabinets,
    items: [],
    subscriptions,
    scanSessions: media === 'none' ? [] : scanSessions,
    labels,
    actionLogs,
  };

  if (media === 'inline') {
    for (const photo of photos) {
      payload.photos.push({ ...photo, blob: (await blobToDataUrl(photo.blob)) || '' });
    }
    for (const item of items) {
      payload.items.push({ ...item, image: await blobToDataUrl(item.image) });
    }
  } else {
    payload.items = items.map(({ image: _image, ...item }) => ({
      ...item,
      sourcePhotoId: null,
    }));
  }
  return payload;
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
  if (payload.version !== 2 && payload.version !== 3) throw new Error('不支持的导入文件版本');
  return payload;
}

function remapPayloadForCurrentHome(payload: ExportPayload, homeId: string): ExportPayload {
  const roomIds = new Map<string, string>();
  const photoIds = new Map<string, string>();
  const cabinetIds = new Map<string, string>();
  const itemIds = new Map<string, string>();
  const subIds = new Map<string, string>();
  const sessionIds = new Map<string, string>();
  const labelIds = new Map<string, string>();
  const logIds = new Map<string, string>();

  const mapId = (map: Map<string, string>, id?: string | null): string | null => {
    if (!id) return null;
    if (!map.has(id)) map.set(id, uid());
    return map.get(id)!;
  };
  const mapTargetId = (targetType: string | undefined, targetId: string | undefined) => {
    if (!targetId) return undefined;
    if (targetType === 'room') return mapId(roomIds, targetId)!;
    if (targetType === 'cabinet') return mapId(cabinetIds, targetId)!;
    if (targetType === 'item') return mapId(itemIds, targetId)!;
    if (targetType === 'subscription') return mapId(subIds, targetId)!;
    if (targetType === 'scanSession') return mapId(sessionIds, targetId)!;
    if (targetType === 'label') return mapId(labelIds, targetId)!;
    return targetId;
  };

  const rooms = payload.rooms.map((room) => ({
    ...room,
    id: mapId(roomIds, room.id)!,
    homeId,
  }));
  const photos = payload.photos.map((photo) => ({
    ...photo,
    id: mapId(photoIds, photo.id)!,
    homeId,
    roomId: mapId(roomIds, photo.roomId)!,
  }));
  const cabinets = payload.cabinets.map((cabinet) => ({
    ...cabinet,
    id: mapId(cabinetIds, cabinet.id)!,
    homeId,
    roomId: cabinet.roomId === GLOBAL_ROOM_ID ? cabinet.roomId : mapId(roomIds, cabinet.roomId)!,
    photoId: mapId(photoIds, cabinet.photoId),
  }));
  const items = payload.items.map((item) => ({
    ...item,
    id: mapId(itemIds, item.id)!,
    homeId,
    cabinetId: mapId(cabinetIds, item.cabinetId)!,
    roomId: item.roomId === GLOBAL_ROOM_ID ? item.roomId : mapId(roomIds, item.roomId)!,
    sourcePhotoId: mapId(photoIds, item.sourcePhotoId),
  }));
  const subscriptions = payload.subscriptions.map((sub) => ({
    ...sub,
    id: mapId(subIds, sub.id)!,
    homeId,
  }));
  const scanSessions = (payload.scanSessions || []).map((session) => {
    const candidateIds = new Map<string, string>();
    const mapCandidateId = (id?: string) => {
      if (!id) return undefined;
      if (!candidateIds.has(id)) candidateIds.set(id, uid());
      return candidateIds.get(id)!;
    };
    return {
      ...session,
      id: mapId(sessionIds, session.id)!,
      homeId,
      photoId: mapId(photoIds, session.photoId)!,
      roomId: mapId(roomIds, session.roomId)!,
      candidates: session.candidates.map((candidate) => ({
        ...candidate,
        id: mapCandidateId(candidate.id)!,
        suggestedCabinetCandidateId: mapCandidateId(candidate.suggestedCabinetCandidateId),
      })),
    };
  });
  const labels = (payload.labels || []).map((label) => ({
    ...label,
    id: mapId(labelIds, label.id)!,
    homeId,
    targetId: mapTargetId(label.targetType, label.targetId),
  }));
  const actionLogs = (payload.actionLogs || []).map((log) => ({
    ...log,
    id: mapId(logIds, log.id)!,
    homeId,
    targetId: mapTargetId(log.targetType, log.targetId),
  }));

  return {
    ...payload,
    home: payload.home ? { ...payload.home, id: homeId } : undefined,
    rooms,
    photos,
    cabinets,
    items,
    subscriptions,
    scanSessions,
    labels,
    actionLogs,
  };
}

function preservePayloadIdsForCurrentHome(payload: ExportPayload, homeId: string): ExportPayload {
  return {
    ...payload,
    home: payload.home ? { ...payload.home, id: homeId } : undefined,
    rooms: payload.rooms.map((room) => ({ ...room, homeId })),
    photos: payload.photos.map((photo) => ({ ...photo, homeId })),
    cabinets: payload.cabinets.map((cabinet) => ({ ...cabinet, homeId })),
    items: payload.items.map((item) => ({ ...item, homeId })),
    subscriptions: payload.subscriptions.map((sub) => ({ ...sub, homeId })),
    scanSessions: (payload.scanSessions || []).map((session) => ({ ...session, homeId })),
    labels: (payload.labels || []).map((label) => ({ ...label, homeId })),
    actionLogs: (payload.actionLogs || []).map((log) => ({ ...log, homeId })),
  };
}

export interface ImportPayloadOptions {
  replace?: boolean;
  preserveIds?: boolean;
  preserveMedia?: boolean;
}

async function replaceStore<K extends StoreName>(
  storage: Storage,
  store: K,
  rows: Array<{ id: string }>
): Promise<void> {
  const keep = new Set(rows.map((row) => row.id));
  const current = await storage.all(store);
  await Promise.all(
    current
      .filter((row) => !keep.has(row.id))
      .map((row) => storage.del(store, row.id))
  );
}

export async function importPayload(
  storage: Storage,
  payload: ExportPayload,
  options: ImportPayloadOptions = {}
): Promise<void> {
  const targetHomeId = storage.homeId || DEFAULT_HOME_ID;
  const normalized = options.preserveIds
    ? preservePayloadIdsForCurrentHome(payload, targetHomeId)
    : remapPayloadForCurrentHome(payload, targetHomeId);
  const preserveMedia = Boolean(options.preserveMedia);
  const existingItems = preserveMedia
    ? new Map((await storage.all('items')).map((item) => [item.id, item]))
    : new Map();
  const existingCabinets = preserveMedia
    ? new Map((await storage.all('cabinets')).map((cabinet) => [cabinet.id, cabinet]))
    : new Map();

  if (options.replace ?? true) {
    if (preserveMedia) {
      await replaceStore(storage, 'rooms', normalized.rooms);
      await replaceStore(storage, 'cabinets', normalized.cabinets);
      await replaceStore(storage, 'items', normalized.items);
      await replaceStore(storage, 'subscriptions', normalized.subscriptions);
      if (normalized.photos.length) await replaceStore(storage, 'photos', normalized.photos);
      if ((normalized.scanSessions || []).length) {
        await replaceStore(storage, 'scanSessions', normalized.scanSessions || []);
      }
      await replaceStore(storage, 'labels', normalized.labels || []);
      await replaceStore(storage, 'actionLogs', normalized.actionLogs || []);
    } else {
      await storage.clearAll();
    }
  }
  for (const room of normalized.rooms) await storage.put('rooms', room);
  if (!preserveMedia || normalized.photos.length) {
    for (const photo of normalized.photos) {
      await storage.put('photos', {
        ...photo,
        blob: photo.blob ? await dataUrlToBlob(photo.blob) : new Blob(),
      });
    }
  }
  for (const cabinet of normalized.cabinets) {
    const existing = existingCabinets.get(cabinet.id);
    await storage.put('cabinets', {
      ...cabinet,
      photoId: preserveMedia && cabinet.photoId === null && existing?.photoId
        ? existing.photoId
        : cabinet.photoId,
    });
  }
  for (const item of normalized.items) {
    const existing = existingItems.get(item.id);
    await storage.put('items', {
      ...item,
      image: item.image ? await dataUrlToBlob(item.image) : preserveMedia ? existing?.image : undefined,
      sourcePhotoId:
        preserveMedia && item.sourcePhotoId === null && existing?.sourcePhotoId
          ? existing.sourcePhotoId
          : item.sourcePhotoId,
    });
  }
  for (const sub of normalized.subscriptions) await storage.put('subscriptions', sub);
  for (const session of normalized.scanSessions || []) await storage.put('scanSessions', session);
  for (const label of normalized.labels || []) await storage.put('labels', label);
  for (const log of normalized.actionLogs || []) await storage.put('actionLogs', log);
}

export async function importZip(storage: Storage, zipBlob: Blob, replace = true): Promise<void> {
  const targetHomeId = storage.homeId || DEFAULT_HOME_ID;
  const payload = remapPayloadForCurrentHome(await parseFileTree(await zipBlobToFiles(zipBlob)), targetHomeId);
  if (replace) await storage.clearAll();
  for (const room of payload.rooms) await storage.put('rooms', room);
  for (const photo of payload.photos) {
    await storage.put('photos', { ...photo, blob: photo.blob ? await dataUrlToBlob(photo.blob) : new Blob() });
  }
  for (const cabinet of payload.cabinets) await storage.put('cabinets', cabinet);
  for (const item of payload.items) {
    await storage.put('items', {
      ...item,
      image: item.image ? await dataUrlToBlob(item.image) : undefined,
    });
  }
  for (const sub of payload.subscriptions) await storage.put('subscriptions', sub);
  for (const session of payload.scanSessions || []) await storage.put('scanSessions', session);
  for (const label of payload.labels || []) await storage.put('labels', label);
  for (const log of payload.actionLogs || []) await storage.put('actionLogs', log);
}
