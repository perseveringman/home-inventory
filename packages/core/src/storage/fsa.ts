import type { ArchiveFile } from '../services/archive';

const HANDLE_KEY = 'home-inventory:fsa-handle';

type DirectoryPickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };

type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickSyncDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) throw new Error('当前浏览器不支持文件夹同步');
  return (window as DirectoryPickerWindow).showDirectoryPicker({ mode: 'readwrite' });
}

export async function ensureDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const permissioned = handle as PermissionedDirectoryHandle;
  const readWrite = { mode: 'readwrite' } as const;
  if ((await permissioned.queryPermission(readWrite)) === 'granted') return true;
  return (await permissioned.requestPermission(readWrite)) === 'granted';
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const request = indexedDB.open('home-inventory-v2-fsa', 1);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction('handles', 'readwrite').objectStore('handles').put(handle, HANDLE_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const request = indexedDB.open('home-inventory-v2-fsa', 1);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const req = db.transaction('handles', 'readonly').objectStore('handles').get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearDirectoryHandle(): Promise<void> {
  const request = indexedDB.open('home-inventory-v2-fsa', 1);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction('handles', 'readwrite').objectStore('handles').delete(HANDLE_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function writeOneFile(root: FileSystemDirectoryHandle, file: ArchiveFile): Promise<void> {
  const parts = file.path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file.content);
  await writable.close();
}

export async function writeTreeToDirectory(
  handle: FileSystemDirectoryHandle,
  files: ArchiveFile[]
): Promise<void> {
  if (!(await ensureDirectoryPermission(handle))) throw new Error('未获得文件夹写入权限');
  for (const file of files) await writeOneFile(handle, file);
}
