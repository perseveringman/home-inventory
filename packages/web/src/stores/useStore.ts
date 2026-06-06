/**
 * 全局状态管理：内存镜像 + IndexedDB 持久化。
 * 所有数据读写都走这里，组件无需直接碰 storage。
 */
import { create } from 'zustand';
import {
  IndexedDBStorage,
  applyTagView,
  migrateTagViewsToItemLists,
  type Cabinet,
  type Item,
  type ActionLog,
  type Label,
  type Photo,
  type RecognitionTask,
  type Room,
  type ScanSession,
  type Storage,
  type Subscription,
  type StoreName,
  type StoreSchema,
  scheduleAutoSync,
} from '@home-inventory/core';
import { syncSubscriptionRenewalReminders } from '../lib/subscriptionReminders';

const storage: Storage = new IndexedDBStorage();

interface StoreState {
  rooms: Room[];
  photos: Photo[];
  cabinets: Cabinet[];
  items: Item[];
  subscriptions: Subscription[];
  recognitionTasks: RecognitionTask[];
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
  recognitionTasks: [],
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
      recognitionTasks,
      scanSessions,
      labels,
      actionLogs,
    ] = await Promise.all([
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
    set({
      rooms,
      photos,
      cabinets,
      items,
      subscriptions,
      recognitionTasks,
      scanSessions,
      labels,
      actionLogs,
      ready: true,
    });
    syncSubscriptionRemindersSoon(subscriptions);
  },
}));

function syncSubscriptionRemindersSoon(subscriptions: Subscription[]) {
  void syncSubscriptionRenewalReminders(subscriptions).catch((err) => {
    console.warn('订阅系统提醒同步失败，已跳过：', err);
  });
}

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
      {
        const subscriptions = await storage.all('subscriptions');
        set({ subscriptions });
        syncSubscriptionRemindersSoon(subscriptions);
      }
      break;
    case 'recognitionTasks':
      set({ recognitionTasks: await storage.all('recognitionTasks') });
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
  // 一次性迁移旧 TagView → ItemList。幂等，已迁移过会自动跳过。
  try {
    const items = useStore.getState().items;
    await migrateTagViewsToItemLists(storage, items, applyTagView);
  } catch (err) {
    console.warn('TagView → ItemList 迁移失败，已跳过：', err);
  }
}

/** 暴露 storage 给需要直接访问的地方（AI 识别/配置等） */
export function getStorage(): Storage {
  return storage;
}
