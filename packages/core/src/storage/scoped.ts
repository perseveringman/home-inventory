import { DEFAULT_HOME_ID } from '../models';
import type { Storage, StoreInputSchema, StoreName, StoreSchema } from './types';
import { HOME_BOUND_STORES, isHomeBoundStore } from './types';

function recordHomeId(value: unknown): string {
  return String((value as any)?.homeId || DEFAULT_HOME_ID);
}

export class HomeScopedStorage implements Storage {
  constructor(
    private readonly base: Storage,
    private readonly getHomeId: () => string | undefined
  ) {}

  get homeId(): string {
    return this.requireHomeId();
  }

  private requireHomeId(): string {
    return this.getHomeId() || DEFAULT_HOME_ID;
  }

  private belongsToCurrentHome(value: unknown): boolean {
    return recordHomeId(value) === this.requireHomeId();
  }

  async all<K extends StoreName>(store: K): Promise<StoreSchema[K][]> {
    if (!isHomeBoundStore(store)) return this.base.all(store);
    const homeId = this.requireHomeId();
    const rows = await this.base.byIndex(store, 'homeId', homeId).catch(async () => this.base.all(store));
    return rows.filter((row) => recordHomeId(row) === homeId) as StoreSchema[K][];
  }

  async get<K extends StoreName>(
    store: K,
    id: string
  ): Promise<StoreSchema[K] | undefined> {
    const row = await this.base.get(store, id);
    if (!row || !isHomeBoundStore(store)) return row;
    return this.belongsToCurrentHome(row) ? row : undefined;
  }

  async byIndex<K extends StoreName>(
    store: K,
    index: string,
    value: string
  ): Promise<StoreSchema[K][]> {
    const rows = await this.base.byIndex(store, index, value);
    if (!isHomeBoundStore(store)) return rows;
    return rows.filter((row) => this.belongsToCurrentHome(row)) as StoreSchema[K][];
  }

  async put<K extends StoreName>(store: K, obj: StoreInputSchema[K]): Promise<void> {
    if (!isHomeBoundStore(store)) {
      await this.base.put(store, obj);
      return;
    }
    await this.base.put(store, { ...(obj as any), homeId: this.requireHomeId() });
  }

  async add<K extends StoreName>(store: K, obj: StoreInputSchema[K]): Promise<void> {
    await this.put(store, obj);
  }

  async del(store: StoreName, id: string): Promise<void> {
    if (!isHomeBoundStore(store)) {
      await this.base.del(store, id);
      return;
    }
    const row = await this.base.get(store, id);
    if (row && this.belongsToCurrentHome(row)) await this.base.del(store, id);
  }

  async clearAll(): Promise<void> {
    const homeId = this.requireHomeId();
    await Promise.all(
      HOME_BOUND_STORES.map(async (store) => {
        const rows = await this.base.all(store);
        await Promise.all(
          rows
            .filter((row) => recordHomeId(row) === homeId)
            .map((row) => this.base.del(store, row.id))
        );
      })
    );
  }
}
