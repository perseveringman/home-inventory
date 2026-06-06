"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLooseCabinet = isLooseCabinet;
exports.ensureLooseCabinet = ensureLooseCabinet;
exports.ensureGlobalLooseCabinet = ensureGlobalLooseCabinet;
const models_1 = require("../models");
const id_1 = require("../utils/id");
function isLooseCabinet(c) {
    return !!c && (c.type === 'loose' || c.type === 'loose-global');
}
async function ensureLooseCabinet(storage, roomId) {
    const list = await storage.byIndex('cabinets', 'roomId', roomId);
    let loose = list.find((c) => c.type === 'loose');
    if (loose)
        return loose;
    loose = {
        id: (0, id_1.uid)(),
        photoId: null,
        roomId,
        name: '自由物品收纳处',
        rect: { x: 0, y: 0, w: 0, h: 0 },
        type: 'loose',
        createdAt: Date.now(),
    };
    await storage.add('cabinets', loose);
    return loose;
}
async function ensureGlobalLooseCabinet(storage) {
    const all = await storage.all('cabinets');
    let loose = all.find((c) => c.type === 'loose-global');
    if (loose)
        return loose;
    loose = {
        id: (0, id_1.uid)(),
        photoId: null,
        roomId: models_1.GLOBAL_ROOM_ID,
        name: '全屋自由区',
        rect: { x: 0, y: 0, w: 0, h: 0 },
        type: 'loose-global',
        createdAt: Date.now(),
    };
    await storage.add('cabinets', loose);
    return loose;
}
