/**
 * 存储抽象 —— 三端都要实现这个接口。
 * web 用 IndexedDB，Expo 用 SQLite/AsyncStorage，Electron 用文件系统等。
 */
import type { Cabinet, Home, HomeScopedRecord, Item, Photo, Room, Subscription } from '../models';
import type { ActionLog, Label, ScanSession } from '../models';

export type StoreName =
  | 'homes'
  | 'rooms'
  | 'photos'
  | 'cabinets'
  | 'items'
  | 'subscriptions'
  | 'scanSessions'
  | 'labels'
  | 'actionLogs'
  | 'config';

/** 各 store 的 record 类型映射 */
export interface StoreSchema {
  homes: Home;
  rooms: Room;
  photos: Photo;
  cabinets: Cabinet;
  items: Item;
  subscriptions: Subscription;
  scanSessions: ScanSession;
  labels: Label;
  actionLogs: ActionLog;
  config: { id: string; value: unknown };
}

type WriteHomeScoped<T extends HomeScopedRecord> = Omit<T, 'homeId'> & Partial<Pick<T, 'homeId'>>;

/** 写入时 homeId 可以由 scoped storage 注入；读取结果始终带 homeId。 */
export type StoreInputSchema = {
  [K in keyof StoreSchema]: StoreSchema[K] extends HomeScopedRecord
    ? WriteHomeScoped<StoreSchema[K]>
    : StoreSchema[K];
};

export const HOME_BOUND_STORES = [
  'rooms',
  'photos',
  'cabinets',
  'items',
  'subscriptions',
  'scanSessions',
  'labels',
  'actionLogs',
] as const satisfies readonly StoreName[];

export type HomeBoundStoreName = (typeof HOME_BOUND_STORES)[number];

export function isHomeBoundStore(store: StoreName): store is HomeBoundStoreName {
  return (HOME_BOUND_STORES as readonly string[]).includes(store);
}

export interface Storage {
  readonly homeId?: string;
  all<K extends StoreName>(store: K): Promise<StoreSchema[K][]>;
  get<K extends StoreName>(store: K, id: string): Promise<StoreSchema[K] | undefined>;
  byIndex<K extends StoreName>(
    store: K,
    index: string,
    value: string
  ): Promise<StoreSchema[K][]>;
  put<K extends StoreName>(store: K, obj: StoreInputSchema[K]): Promise<void>;
  add<K extends StoreName>(store: K, obj: StoreInputSchema[K]): Promise<void>;
  del(store: StoreName, id: string): Promise<void>;
  clearAll(): Promise<void>;
}
