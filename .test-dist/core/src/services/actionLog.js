"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAction = logAction;
const id_1 = require("../utils/id");
async function logAction(storage, input) {
    const entry = {
        id: (0, id_1.uid)(),
        createdAt: Date.now(),
        ...input,
    };
    await storage.put('actionLogs', entry);
    return entry;
}
