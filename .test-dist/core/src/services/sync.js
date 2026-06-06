"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindSyncDirectory = bindSyncDirectory;
exports.unbindSyncDirectory = unbindSyncDirectory;
exports.doSyncNow = doSyncNow;
exports.scheduleAutoSync = scheduleAutoSync;
exports.getLastSyncedAt = getLastSyncedAt;
const fsa_1 = require("../storage/fsa");
const archive_1 = require("./archive");
let syncTimer;
let syncing = false;
let lastSyncedAt = '';
async function bindSyncDirectory() {
    const handle = await (0, fsa_1.pickSyncDirectory)();
    await (0, fsa_1.saveDirectoryHandle)(handle);
}
async function unbindSyncDirectory() {
    await (0, fsa_1.clearDirectoryHandle)();
    lastSyncedAt = '';
}
async function doSyncNow(storage) {
    const handle = await (0, fsa_1.loadDirectoryHandle)();
    if (!handle)
        throw new Error('尚未绑定同步文件夹');
    if (syncing)
        return lastSyncedAt;
    syncing = true;
    try {
        await (0, fsa_1.writeTreeToDirectory)(handle, await (0, archive_1.buildFileTree)(storage));
        lastSyncedAt = new Date().toLocaleString();
        return lastSyncedAt;
    }
    finally {
        syncing = false;
    }
}
function scheduleAutoSync(storage) {
    if (syncTimer)
        clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        doSyncNow(storage).catch((err) => console.warn('auto sync failed:', err));
    }, 600);
}
function getLastSyncedAt() {
    return lastSyncedAt;
}
