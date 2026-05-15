/**
 * 全局状态管理：内存镜像 + IndexedDB 持久化。
 * 所有数据读写都走这里，组件无需直接碰 storage。
 */
import { create } from 'zustand';
import {
  IndexedDBStorage,
  type Cabinet,
  type Item,
  type ActionLog,
  type Label,
  type Photo,
  type Room,
  type ScanSession,
  type Storage,
  type Subscription,
  type StoreName,
  type StoreSchema,
  scheduleAutoSync,
} from '@home-inventory/core';

const storage: Storage = new IndexedDBStorage();

interface StoreState {
  rooms: Room[];
  photos: Photo[];
  cabinets: Cabinet[];
  items: Item[];
  subscriptions: Subscription[];
  scanSessions: ScanSession[];
  labels: Label[];
  actionLogs: ActionLog[];
  ready: boolean;

  // 数据读写 —— 以 store 名称为维度
  put: <K extends StoreName>(s: K, obj: StoreSchema[K]) => Promise<void>;
  del: (s: StoreName, id: string) => Promise<void>;
  reloadAll: () => Promise<void>;
}

export const useStore = create<StoreState>((set, get) => ({
  rooms: [],
  photos: [],
  cabinets: [],
  items: [],
  subscriptions: [],
  scanSessions: [],
  labels: [],
  actionLogs: [],
  ready: false,

  put: async (storeName, obj) => {
    await storage.put(storeName as any, obj as any);
    if (storeName !== 'config') scheduleAutoSync(storage);
    // 重载对应集合（简单策略）
    await refreshCollection(storeName, set);
  },

  del: async (storeName, id) => {
    await storage.del(storeName, id);
    if (storeName !== 'config') scheduleAutoSync(storage);
    await refreshCollection(storeName, set);
  },

  reloadAll: async () => {
    const [
      rooms,
      photos,
      cabinets,
      items,
      subscriptions,
      scanSessions,
      labels,
      actionLogs,
    ] = await Promise.all([
      storage.all('rooms'),
      storage.all('photos'),
      storage.all('cabinets'),
      storage.all('items'),
      storage.all('subscriptions'),
      storage.all('scanSessions'),
      storage.all('labels'),
      storage.all('actionLogs'),
    ]);
    set({
      rooms,
      photos,
      cabinets,
      items,
      subscriptions,
      scanSessions,
      labels,
      actionLogs,
      ready: true,
    });
  },
}));

async function refreshCollection(
  storeName: StoreName,
  set: (partial: Partial<StoreState>) => void
) {
  switch (storeName) {
    case 'rooms':
      set({ rooms: await storage.all('rooms') });
      break;
    case 'photos':
      set({ photos: await storage.all('photos') });
      break;
    case 'cabinets':
      set({ cabinets: await storage.all('cabinets') });
      break;
    case 'items':
      set({ items: await storage.all('items') });
      break;
    case 'subscriptions':
      set({ subscriptions: await storage.all('subscriptions') });
      break;
    case 'scanSessions':
      set({ scanSessions: await storage.all('scanSessions') });
      break;
    case 'labels':
      set({ labels: await storage.all('labels') });
      break;
    case 'actionLogs':
      set({ actionLogs: await storage.all('actionLogs') });
      break;
    case 'config':
      break;
  }
}

/** 在 main.tsx 启动时调用 */
export async function initStore(): Promise<void> {
  await useStore.getState().reloadAll();
}

/** 暴露 storage 给需要直接访问的地方（AI 识别/配置等） */
export function getStorage(): Storage {
  return storage;
}
