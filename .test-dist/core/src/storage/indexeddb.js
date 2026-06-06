"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IndexedDBStorage = void 0;
exports.getConfig = getConfig;
exports.setConfig = setConfig;
const DB_NAME = 'home-inventory-v2';
const DB_VERSION = 3;
const STORES = [
    'rooms',
    'photos',
    'cabinets',
    'items',
    'subscriptions',
    'recognitionTasks',
    'scanSessions',
    'labels',
    'actionLogs',
    'config',
];
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
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
                    if (name === 'scanSessions') {
                        store.createIndex('roomId', 'roomId', { unique: false });
                        store.createIndex('photoId', 'photoId', { unique: false });
                        store.createIndex('status', 'status', { unique: false });
                    }
                    if (name === 'recognitionTasks') {
                        store.createIndex('roomId', 'roomId', { unique: false });
                        store.createIndex('photoId', 'photoId', { unique: false });
                        store.createIndex('status', 'status', { unique: false });
                    }
                    if (name === 'labels') {
                        store.createIndex('code', 'code', { unique: true });
                        store.createIndex('targetId', 'targetId', { unique: false });
                        store.createIndex('status', 'status', { unique: false });
                    }
                    if (name === 'actionLogs') {
                        store.createIndex('createdAt', 'createdAt', { unique: false });
                    }
                }
            });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function run(store, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const ret = fn(s);
        if (ret && 'onsuccess' in ret) {
            const req = ret;
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }
        else {
            t.oncomplete = () => resolve(ret);
            t.onerror = () => reject(t.error);
        }
    });
}
class IndexedDBStorage {
    async all(store) {
        return run(store, 'readonly', (s) => s.getAll());
    }
    async get(store, id) {
        return run(store, 'readonly', (s) => s.get(id));
    }
    async byIndex(store, index, value) {
        return run(store, 'readonly', (s) => s.index(index).getAll(value));
    }
    async put(store, obj) {
        await run(store, 'readwrite', (s) => s.put(obj));
    }
    async add(store, obj) {
        await run(store, 'readwrite', (s) => s.put(obj));
    }
    async del(store, id) {
        await run(store, 'readwrite', (s) => s.delete(id));
    }
    async clearAll() {
        const db = await openDB();
        const toClear = STORES.filter((n) => n !== 'config');
        await Promise.all(toClear.map((n) => new Promise((res, rej) => {
            const r = db.transaction(n, 'readwrite').objectStore(n).clear();
            r.onsuccess = () => res();
            r.onerror = () => rej(r.error);
        })));
    }
}
exports.IndexedDBStorage = IndexedDBStorage;
/* ---------- 本地配置（模型名、偏好等非敏感值） ---------- */
async function getConfig(storage, key, fallback) {
    try {
        const r = await storage.get('config', key);
        return r ? r.value : fallback;
    }
    catch {
        return fallback;
    }
}
async function setConfig(storage, key, value) {
    await storage.put('config', { id: key, value });
}
