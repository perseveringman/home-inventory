/**
 * IndexedDB 实现。用户选 B（新 DB 重头走），所以用独立的 DB 名。
 */
import type { Storage, StoreName, StoreSchema } from './types';

const DB_NAME = 'home-inventory-v2';
const DB_VERSION = 1;
const STORES: StoreName[] = [
  'rooms',
  'photos',
  'cabinets',
  'items',
  'subscriptions',
  'config',
];

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (name === 'photos' || name === 'cabinets' || name === 'items') {
            store.createIndex('roomId', 'roomId', { unique: false });
          }
          if (name === 'cabinets') {
            store.createIndex('photoId', 'photoId', { unique: false });
          }
          if (name === 'items') {
            store.createIndex('cabinetId', 'cabinetId', { unique: false });
          }
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

  async put<K extends StoreName>(store: K, obj: StoreSchema[K]): Promise<void> {
    await run(store, 'readwrite', (s) => s.put(obj as any));
  }

  async add<K extends StoreName>(store: K, obj: StoreSchema[K]): Promise<void> {
    await run(store, 'readwrite', (s) => s.put(obj as any));
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

/* ---------- 配置（API Key 等） ---------- */
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
