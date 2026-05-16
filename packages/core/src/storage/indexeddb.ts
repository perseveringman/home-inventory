/**
 * IndexedDB 实现。用户选 B（新 DB 重头走），所以用独立的 DB 名。
 */
import { DEFAULT_HOME_ID } from '../models';
import type { Storage, StoreInputSchema, StoreName, StoreSchema } from './types';
import { isHomeBoundStore } from './types';

const DB_NAME = 'home-inventory-v2';
const DB_VERSION = 3;
const STORES: StoreName[] = [
  'homes',
  'rooms',
  'photos',
  'cabinets',
  'items',
  'subscriptions',
  'scanSessions',
  'labels',
  'actionLogs',
  'config',
];

function createStoreIndexes(name: StoreName, store: IDBObjectStore) {
  if (isHomeBoundStore(name) && !store.indexNames.contains('homeId')) {
    store.createIndex('homeId', 'homeId', { unique: false });
  }
  if ((name === 'photos' || name === 'cabinets' || name === 'items') && !store.indexNames.contains('roomId')) {
    store.createIndex('roomId', 'roomId', { unique: false });
  }
  if (name === 'cabinets' && !store.indexNames.contains('photoId')) {
    store.createIndex('photoId', 'photoId', { unique: false });
  }
  if (name === 'items') {
    if (!store.indexNames.contains('cabinetId')) {
      store.createIndex('cabinetId', 'cabinetId', { unique: false });
    }
  }
  if (name === 'scanSessions') {
    if (!store.indexNames.contains('roomId')) {
      store.createIndex('roomId', 'roomId', { unique: false });
    }
    if (!store.indexNames.contains('photoId')) {
      store.createIndex('photoId', 'photoId', { unique: false });
    }
    if (!store.indexNames.contains('status')) {
      store.createIndex('status', 'status', { unique: false });
    }
  }
  if (name === 'labels') {
    if (store.indexNames.contains('code')) {
      store.deleteIndex('code');
    }
    store.createIndex('code', 'code', { unique: false });
    if (!store.indexNames.contains('targetId')) {
      store.createIndex('targetId', 'targetId', { unique: false });
    }
    if (!store.indexNames.contains('status')) {
      store.createIndex('status', 'status', { unique: false });
    }
  }
  if (name === 'actionLogs' && !store.indexNames.contains('createdAt')) {
    store.createIndex('createdAt', 'createdAt', { unique: false });
  }
}

function backfillHomeId(store: IDBObjectStore) {
  const req = store.openCursor();
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    const value = cursor.value;
    if (value && !value.homeId) {
      cursor.update({ ...value, homeId: DEFAULT_HOME_ID });
    }
    cursor.continue();
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const tx = (e.target as IDBOpenDBRequest).transaction!;
      STORES.forEach((name) => {
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: 'id' });
        } else {
          store = tx.objectStore(name);
        }
        createStoreIndexes(name, store);
        if (isHomeBoundStore(name)) {
          backfillHomeId(store);
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | T
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const ret = fn(s);
    if (ret && 'onsuccess' in (ret as any)) {
      const req = ret as IDBRequest<T>;
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } else {
      t.oncomplete = () => resolve(ret as T);
      t.onerror = () => reject(t.error);
    }
  });
}

function withFallbackHomeId<K extends StoreName>(
  store: K,
  obj: StoreInputSchema[K]
): StoreSchema[K] {
  if (isHomeBoundStore(store)) {
    return { ...(obj as any), homeId: (obj as any).homeId || DEFAULT_HOME_ID };
  }
  return obj as StoreSchema[K];
}

export class IndexedDBStorage implements Storage {
  async all<K extends StoreName>(store: K): Promise<StoreSchema[K][]> {
    return run(store, 'readonly', (s) => s.getAll() as IDBRequest<StoreSchema[K][]>);
  }

  async get<K extends StoreName>(
    store: K,
    id: string
  ): Promise<StoreSchema[K] | undefined> {
    return run(store, 'readonly', (s) => s.get(id) as IDBRequest<StoreSchema[K] | undefined>);
  }

  async byIndex<K extends StoreName>(
    store: K,
    index: string,
    value: string
  ): Promise<StoreSchema[K][]> {
    return run(
      store,
      'readonly',
      (s) => s.index(index).getAll(value) as IDBRequest<StoreSchema[K][]>
    );
  }

  async put<K extends StoreName>(store: K, obj: StoreInputSchema[K]): Promise<void> {
    await run(store, 'readwrite', (s) => s.put(withFallbackHomeId(store, obj) as any));
  }

  async add<K extends StoreName>(store: K, obj: StoreInputSchema[K]): Promise<void> {
    await run(store, 'readwrite', (s) => s.put(withFallbackHomeId(store, obj) as any));
  }

  async del(store: StoreName, id: string): Promise<void> {
    await run(store, 'readwrite', (s) => s.delete(id));
  }

  async clearAll(): Promise<void> {
    const db = await openDB();
    const toClear = STORES.filter((n) => n !== 'config');
    await Promise.all(
      toClear.map(
        (n) =>
          new Promise<void>((res, rej) => {
            const r = db.transaction(n, 'readwrite').objectStore(n).clear();
            r.onsuccess = () => res();
            r.onerror = () => rej(r.error);
          })
      )
    );
  }
}

/* ---------- 本地配置（模型名、偏好等非敏感值） ---------- */
export async function getConfig<T = string>(
  storage: Storage,
  key: string,
  fallback: T
): Promise<T> {
  try {
    const r = await storage.get('config', key);
    return r ? (r.value as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function setConfig(storage: Storage, key: string, value: unknown): Promise<void> {
  await storage.put('config', { id: key, value });
}
