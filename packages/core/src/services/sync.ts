import type { Storage } from '../storage/types';
import {
  clearDirectoryHandle,
  loadDirectoryHandle,
  pickSyncDirectory,
  saveDirectoryHandle,
  writeTreeToDirectory,
} from '../storage/fsa';
import { buildFileTree } from './archive';

let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncing = false;
let lastSyncedAt = '';

export async function bindSyncDirectory(): Promise<void> {
  const handle = await pickSyncDirectory();
  await saveDirectoryHandle(handle);
}

export async function unbindSyncDirectory(): Promise<void> {
  await clearDirectoryHandle();
  lastSyncedAt = '';
}

export async function doSyncNow(storage: Storage): Promise<string> {
  const handle = await loadDirectoryHandle();
  if (!handle) throw new Error('尚未绑定同步文件夹');
  if (syncing) return lastSyncedAt;
  syncing = true;
  try {
    await writeTreeToDirectory(handle, await buildFileTree(storage));
    lastSyncedAt = new Date().toLocaleString();
    return lastSyncedAt;
  } finally {
    syncing = false;
  }
}

export function scheduleAutoSync(storage: Storage): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    doSyncNow(storage).catch((err) => console.warn('auto sync failed:', err));
  }, 600);
}

export function getLastSyncedAt(): string {
  return lastSyncedAt;
}
