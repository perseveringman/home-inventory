/**
 * 全局状态管理：内存镜像 + IndexedDB 持久化。
 * 业务层拿到的 storage 永远按当前 home 隔离，避免服务层漏过滤。
 */
import { create } from 'zustand';
import {
  DEFAULT_HOME_ID,
  DEMO_HOME_ID,
  HOME_BOUND_STORES,
  HomeScopedStorage,
  IndexedDBStorage,
  getConfig,
  loadDemoData,
  setConfig,
  type ActionLog,
  type Cabinet,
  type Home,
  type Item,
  type Label,
  type Photo,
  type Room,
  type ScanSession,
  type Storage,
  type StoreInputSchema,
  type StoreName,
  type StoreSchema,
  type Subscription,
  scheduleAutoSync,
  uid,
} from '@home-inventory/core';

const CURRENT_HOME_KEY = 'current-home-id';
const rawStorage: Storage = new IndexedDBStorage();

let activeHomeId = DEFAULT_HOME_ID;
const storage: Storage = new HomeScopedStorage(rawStorage, () => activeHomeId);

interface StoreState {
  homes: Home[];
  currentHomeId: string;
  currentHome?: Home;

  rooms: Room[];
  photos: Photo[];
  cabinets: Cabinet[];
  items: Item[];
  subscriptions: Subscription[];
  scanSessions: ScanSession[];
  labels: Label[];
  actionLogs: ActionLog[];
  ready: boolean;

  // 数据读写 —— 以 store 名称为维度，自动落到当前 home
  put: <K extends StoreName>(s: K, obj: StoreInputSchema[K]) => Promise<void>;
  del: (s: StoreName, id: string) => Promise<void>;
  reloadAll: () => Promise<void>;
  switchHome: (homeId: string) => Promise<void>;
  createHome: (name?: string) => Promise<Home>;
  adoptHome: (home: Home) => Promise<Home>;
  migrateCurrentHome: (nextHome: Home) => Promise<Home>;
  resetDemoHome: () => Promise<void>;
}

export const useStore = create<StoreState>((set, get) => ({
  homes: [],
  currentHomeId: DEFAULT_HOME_ID,
  currentHome: undefined,

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
    const targetStorage = storeName === 'homes' || storeName === 'config' ? rawStorage : storage;
    await targetStorage.put(storeName as any, obj as any);
    if (storeName !== 'config' && storeName !== 'homes') scheduleAutoSync(storage);
    await refreshCollection(storeName, set);
  },

  del: async (storeName, id) => {
    const targetStorage = storeName === 'homes' || storeName === 'config' ? rawStorage : storage;
    await targetStorage.del(storeName, id);
    if (storeName !== 'config' && storeName !== 'homes') scheduleAutoSync(storage);
    await refreshCollection(storeName, set);
  },

  reloadAll: async () => {
    await reloadAllCollections(set);
  },

  switchHome: async (homeId) => {
    const homes = await rawStorage.all('homes');
    const next = homes.find((home) => home.id === homeId);
    if (!next) throw new Error('home 不存在');
    activeHomeId = homeId;
    await setConfig(rawStorage, CURRENT_HOME_KEY, homeId);
    await rawStorage.put('homes', { ...next, lastOpenedAt: Date.now() });
    await reloadAllCollections(set);
  },

  createHome: async (name = '我的家') => {
    const home: Home = {
      id: uid(),
      name,
      kind: 'user',
      icon: '🏠',
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    };
    await rawStorage.put('homes', home);
    await get().switchHome(home.id);
    return home;
  },

  adoptHome: async (home) => {
    const next: Home = {
      ...home,
      kind: home.kind || 'user',
      createdAt: home.createdAt || Date.now(),
      lastOpenedAt: Date.now(),
    };
    await rawStorage.put('homes', next);
    await get().switchHome(next.id);
    return next;
  },

  migrateCurrentHome: async (home) => {
    const oldHomeId = activeHomeId;
    if (oldHomeId === DEMO_HOME_ID) throw new Error('示例 home 不能迁移为共享 home');
    const next: Home = {
      ...home,
      id: home.id,
      kind: 'user',
      createdAt: home.createdAt || Date.now(),
      lastOpenedAt: Date.now(),
    };
    if (!next.id || next.id === oldHomeId) {
      await rawStorage.put('homes', next);
      await get().switchHome(next.id || oldHomeId);
      return next;
    }

    const existing = await rawStorage.get('homes', next.id);
    if (existing && existing.id !== oldHomeId) {
      throw new Error('本机已经存在这个共享 home');
    }

    for (const storeName of HOME_BOUND_STORES) {
      const rows = await rawStorage.all(storeName);
      await Promise.all(
        rows
          .filter((row) => row.homeId === oldHomeId)
          .map((row) => rawStorage.put(storeName, { ...(row as any), homeId: next.id } as any))
      );
    }
    await rawStorage.del('homes', oldHomeId);
    await rawStorage.put('homes', next);
    activeHomeId = next.id;
    await setConfig(rawStorage, CURRENT_HOME_KEY, next.id);
    await reloadAllCollections(set);
    return next;
  },

  resetDemoHome: async () => {
    const demo = (await rawStorage.get('homes', DEMO_HOME_ID)) || createDemoHome();
    await rawStorage.put('homes', { ...demo, lastOpenedAt: Date.now() });
    activeHomeId = DEMO_HOME_ID;
    await setConfig(rawStorage, CURRENT_HOME_KEY, DEMO_HOME_ID);
    await loadDemoData(storage, true);
    await reloadAllCollections(set);
  },
}));

function createDemoHome(): Home {
  return {
    id: DEMO_HOME_ID,
    name: '示例家',
    kind: 'demo',
    icon: '✨',
    createdAt: Date.now(),
  };
}

function createDefaultHome(hasExistingData: boolean): Home {
  return {
    id: DEFAULT_HOME_ID,
    name: hasExistingData ? '我的家' : '新家',
    kind: 'user',
    icon: '🏠',
    createdAt: Date.now(),
  };
}

async function hasExistingHomeData(): Promise<boolean> {
  const [rooms, photos, cabinets, items, subscriptions, scanSessions, labels] = await Promise.all([
    rawStorage.all('rooms'),
    rawStorage.all('photos'),
    rawStorage.all('cabinets'),
    rawStorage.all('items'),
    rawStorage.all('subscriptions'),
    rawStorage.all('scanSessions'),
    rawStorage.all('labels'),
  ]);
  return [rooms, photos, cabinets, items, subscriptions, scanSessions, labels].some(
    (rows) => rows.length > 0
  );
}

async function ensureHomeSetup(): Promise<void> {
  const hasData = await hasExistingHomeData();
  const homes = await rawStorage.all('homes');
  const homeIds = new Set(homes.map((home) => home.id));

  if (!homeIds.has(DEMO_HOME_ID)) {
    await rawStorage.put('homes', createDemoHome());
  }
  const hasUserHome = homes.some((home) => home.kind === 'user' && home.id !== DEMO_HOME_ID);
  if (!homeIds.has(DEFAULT_HOME_ID) && !hasUserHome) {
    await rawStorage.put('homes', createDefaultHome(hasData));
  }

  const demoStorage = new HomeScopedStorage(rawStorage, () => DEMO_HOME_ID);
  const demoRooms = await demoStorage.all('rooms');
  if (!demoRooms.length) {
    await loadDemoData(demoStorage, true);
  }

  const savedHomeId = await getConfig(rawStorage, CURRENT_HOME_KEY, '');
  const nextHomeId =
    savedHomeId && (await rawStorage.get('homes', savedHomeId))
      ? savedHomeId
      : hasData
        ? DEFAULT_HOME_ID
        : DEMO_HOME_ID;
  activeHomeId = nextHomeId;
  await setConfig(rawStorage, CURRENT_HOME_KEY, nextHomeId);
}

async function reloadAllCollections(
  set: (partial: Partial<StoreState>) => void
): Promise<void> {
  const [
    homes,
    rooms,
    photos,
    cabinets,
    items,
    subscriptions,
    scanSessions,
    labels,
    actionLogs,
  ] = await Promise.all([
    rawStorage.all('homes'),
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
    homes,
    currentHomeId: activeHomeId,
    currentHome: homes.find((home) => home.id === activeHomeId),
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
}

async function refreshCollection(
  storeName: StoreName,
  set: (partial: Partial<StoreState>) => void
) {
  switch (storeName) {
    case 'homes': {
      const homes = await rawStorage.all('homes');
      set({
        homes,
        currentHome: homes.find((home) => home.id === activeHomeId),
      });
      break;
    }
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
  await ensureHomeSetup();
  await useStore.getState().reloadAll();
}

/** 暴露当前 home 作用域 storage 给需要直接访问的地方（AI 识别/配置等） */
export function getStorage(): Storage {
  return storage;
}
