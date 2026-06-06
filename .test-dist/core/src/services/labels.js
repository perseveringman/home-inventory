"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeLabelCode = makeLabelCode;
exports.labelToQrText = labelToQrText;
exports.parseLabelCode = parseLabelCode;
exports.createLabel = createLabel;
exports.linkLabel = linkLabel;
exports.resolveLabel = resolveLabel;
const id_1 = require("../utils/id");
const actionLog_1 = require("./actionLog");
const LABEL_URL_PREFIX = 'https://home-inventory.local/l/';
const LABEL_SCHEME_PREFIX = 'home-inventory://label/';
function normalizeCode(raw) {
    return raw.trim().replace(/^.*\/l\//, '').replace(/^home-inventory:\/\/label\//, '');
}
function makeLabelCode() {
    return `hi_${(0, id_1.uid)().replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
}
function labelToQrText(label, mode = 'url') {
    return mode === 'scheme' ? `${LABEL_SCHEME_PREFIX}${label.code}` : `${LABEL_URL_PREFIX}${label.code}`;
}
function parseLabelCode(input) {
    const text = input.trim();
    if (!text)
        return '';
    if (text.startsWith('{')) {
        try {
            const parsed = JSON.parse(text);
            return normalizeCode(String(parsed.code || parsed.labelId || parsed.id || ''));
        }
        catch {
            return '';
        }
    }
    return normalizeCode(text);
}
async function createLabel(storage, input = {}) {
    const label = {
        id: (0, id_1.uid)(),
        code: makeLabelCode(),
        targetType: input.targetType,
        targetId: input.targetId,
        labelNo: input.labelNo,
        status: input.targetId ? 'linked' : 'unclaimed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    await storage.put('labels', label);
    await (0, actionLog_1.logAction)(storage, {
        source: 'user',
        type: 'label_created',
        summary: input.targetId ? '创建并绑定二维码标签' : '创建未绑定二维码标签',
        targetType: 'label',
        targetId: label.id,
        after: label,
    });
    return label;
}
async function linkLabel(storage, labelIdOrCode, targetType, targetId) {
    const labels = await storage.all('labels');
    const code = parseLabelCode(labelIdOrCode);
    const label = labels.find((item) => item.id === labelIdOrCode || item.code === code);
    if (!label)
        throw new Error('标签不存在');
    const next = {
        ...label,
        targetType,
        targetId,
        status: 'linked',
        updatedAt: Date.now(),
    };
    await storage.put('labels', next);
    await (0, actionLog_1.logAction)(storage, {
        source: 'user',
        type: 'label_linked',
        summary: '绑定二维码标签',
        targetType,
        targetId,
        before: label,
        after: next,
    });
    return next;
}
async function resolveLabel(storage, scannedText) {
    const code = parseLabelCode(scannedText);
    if (!code)
        return undefined;
    const labels = await storage.byIndex('labels', 'code', code).catch(async () => []);
    return labels[0] || (await storage.all('labels')).find((label) => label.code === code);
}
