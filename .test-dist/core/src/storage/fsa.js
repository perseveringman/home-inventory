"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFileSystemAccessSupported = isFileSystemAccessSupported;
exports.pickSyncDirectory = pickSyncDirectory;
exports.ensureDirectoryPermission = ensureDirectoryPermission;
exports.saveDirectoryHandle = saveDirectoryHandle;
exports.loadDirectoryHandle = loadDirectoryHandle;
exports.clearDirectoryHandle = clearDirectoryHandle;
exports.writeTreeToDirectory = writeTreeToDirectory;
const HANDLE_KEY = 'home-inventory:fsa-handle';
function isFileSystemAccessSupported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
async function pickSyncDirectory() {
    if (!isFileSystemAccessSupported())
        throw new Error('当前浏览器不支持文件夹同步');
    return window.showDirectoryPicker({ mode: 'readwrite' });
}
async function ensureDirectoryPermission(handle) {
    const permissioned = handle;
    const readWrite = { mode: 'readwrite' };
    if ((await permissioned.queryPermission(readWrite)) === 'granted')
        return true;
    return (await permissioned.requestPermission(readWrite)) === 'granted';
}
async function saveDirectoryHandle(handle) {
    const request = indexedDB.open('home-inventory-v2-fsa', 1);
    const db = await new Promise((resolve, reject) => {
        request.onupgradeneeded = () => request.result.createObjectStore('handles');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
        const req = db.transaction('handles', 'readwrite').objectStore('handles').put(handle, HANDLE_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
async function loadDirectoryHandle() {
    const request = indexedDB.open('home-inventory-v2-fsa', 1);
    const db = await new Promise((resolve, reject) => {
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
async function clearDirectoryHandle() {
    const request = indexedDB.open('home-inventory-v2-fsa', 1);
    const db = await new Promise((resolve, reject) => {
        request.onupgradeneeded = () => request.result.createObjectStore('handles');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
        const req = db.transaction('handles', 'readwrite').objectStore('handles').delete(HANDLE_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
async function writeOneFile(root, file) {
    const parts = file.path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name)
        return;
    let dir = root;
    for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.content);
    await writable.close();
}
async function writeTreeToDirectory(handle, files) {
    if (!(await ensureDirectoryPermission(handle)))
        throw new Error('未获得文件夹写入权限');
    for (const file of files)
        await writeOneFile(handle, file);
}
