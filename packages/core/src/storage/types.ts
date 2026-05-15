/**
 * 存储抽象 —— 三端都要实现这个接口。
 * web 用 IndexedDB，Expo 用 SQLite/AsyncStorage，Electron 用文件系统等。
 */
import type { Cabinet, Item, Photo, Room, Subscription } from '../models';
import type { ActionLog, Label, ScanSession } from '../models';

export type StoreName =
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

export interface Storage {
  all<K extends StoreName>(store: K): Promise<StoreSchema[K][]>;
  get<K extends StoreName>(store: K, id: string): Promise<StoreSchema[K] | undefined>;
  byIndex<K extends StoreName>(
    store: K,
    index: string,
    value: string
  ): Promise<StoreSchema[K][]>;
  put<K extends StoreName>(store: K, obj: StoreSchema[K]): Promise<void>;
  add<K extends StoreName>(store: K, obj: StoreSchema[K]): Promise<void>;
  del(store: StoreName, id: string): Promise<void>;
  clearAll(): Promise<void>;
}
