"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseQuickAddLine = parseQuickAddLine;
exports.parseQuickAddText = parseQuickAddText;
exports.parseQuickAddDraft = parseQuickAddDraft;
exports.formatQuickAddLines = formatQuickAddLines;
exports.resolveTargetCabinet = resolveTargetCabinet;
exports.addQuickItems = addQuickItems;
exports.scanLooseItemsFromPhoto = scanLooseItemsFromPhoto;
const models_1 = require("../models");
const image_1 = require("../utils/image");
const id_1 = require("../utils/id");
const ai_1 = require("./ai");
const cabinet_1 = require("./cabinet");
const CHINESE_NUMBER_CHARS = '零〇一二两俩三四五六七八九十百千万';
const QUANTITY_UNITS = [
    '个',
    '件',
    '台',
    '只',
    '本',
    '支',
    '枝',
    '条',
    '盒',
    '包',
    '瓶',
    '罐',
    '袋',
    '块',
    '片',
    '根',
    '把',
    '张',
    '卷',
    '副',
    '枚',
    '组',
    '束',
    '颗',
    '粒',
    '杯',
    '份',
    '套',
    '对',
    '双',
    '打',
];
const QUANTITY_UNIT_PATTERN = QUANTITY_UNITS.join('|');
const PAIR_UNITS = new Set(['对', '双']);
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function cleanText(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/[：:]/g, ',')
        .replace(/[。！？!?]/g, '，')
        .trim();
}
function tidyItemName(name) {
    return name
        .replace(/^(?:有|还有|以及|和|跟|与|另外|再加上|加上|新增|添加|录入|记录|记一下|买了|放了|放着)\s*/u, '')
        .replace(/^(?:了|的)\s*/u, '')
        .replace(/\s*([a-zA-Z])\s+(\d)\s*/g, '$1$2')
        .replace(/\s*(\d)\s+([a-zA-Z])\s*/g, '$1$2')
        .replace(/([\u4e00-\u9fff])\s+([a-zA-Z0-9])/g, '$1$2')
        .replace(/([a-zA-Z0-9])\s+([\u4e00-\u9fff])/g, '$1$2')
        .trim();
}
function parseQuantityText(text) {
    const value = text.trim();
    if (!value)
        return null;
    if (/^\d+$/.test(value))
        return Number.parseInt(value, 10);
    const digitMap = {
        零: 0,
        〇: 0,
        一: 1,
        二: 2,
        两: 2,
        俩: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
    };
    const unitMap = {
        十: 10,
        百: 100,
        千: 1000,
        万: 10000,
    };
    let total = 0;
    let section = 0;
    let number = 0;
    let seen = false;
    for (const char of value) {
        if (char in digitMap) {
            number = digitMap[char];
            seen = true;
            continue;
        }
        const unit = unitMap[char];
        if (!unit)
            return null;
        seen = true;
        if (unit === 10000) {
            total += (section + number) * unit;
            section = 0;
            number = 0;
        }
        else {
            section += (number || 1) * unit;
            number = 0;
        }
    }
    const parsed = total + section + number;
    return seen && parsed > 0 ? parsed : null;
}
function parseNaturalItemPhrase(phrase) {
    let value = phrase
        .trim()
        .replace(/^[,，、;；\s]+|[,，、;；\s]+$/g, '')
        .replace(/^(?:有|还有|以及|和|跟|与|另外|并且|再加上|加上|新增|添加|录入|记录|记一下|买了|放了|放着)\s*/u, '')
        .trim();
    if (!value)
        return null;
    const manual = parseManualQuickAddLine(value);
    if (manual && /[×xX*]/.test(value))
        return manual;
    const leading = value.match(new RegExp(`^(\\d+|[${CHINESE_NUMBER_CHARS}]+)\\s*(${QUANTITY_UNIT_PATTERN})\\s*(.+)$`, 'u'));
    if (leading) {
        const count = parseQuantityText(leading[1]);
        const unit = leading[2] || '';
        const name = tidyItemName(leading[3] || '');
        if (count && name) {
            const qty = unit && PAIR_UNITS.has(unit) ? count * 2 : unit === '打' ? count * 12 : count;
            return { name, qty: Math.max(1, qty), note: '' };
        }
    }
    const trailing = value.match(new RegExp(`^(.+?)\\s*(\\d+|[${CHINESE_NUMBER_CHARS}]+)\\s*(${QUANTITY_UNIT_PATTERN})$`, 'u'));
    if (trailing) {
        const name = tidyItemName(trailing[1] || '');
        const count = parseQuantityText(trailing[2]);
        const unit = trailing[3] || '';
        if (name && count) {
            const qty = unit && PAIR_UNITS.has(unit) ? count * 2 : unit === '打' ? count * 12 : count;
            return { name, qty: Math.max(1, qty), note: '' };
        }
    }
    value = tidyItemName(value);
    return value ? { name: value, qty: 1, note: '' } : null;
}
function inferRoom(text, rooms = []) {
    const source = text.toLowerCase();
    return rooms
        .filter((room) => room.id !== models_1.GLOBAL_ROOM_ID && room.name.trim())
        .sort((a, b) => b.name.length - a.name.length)
        .find((room) => source.includes(room.name.toLowerCase()));
}
function stripNaturalPrefix(text, roomName) {
    let value = cleanText(text);
    if (roomName) {
        const roomPattern = escapeRegExp(roomName);
        value = value.replace(new RegExp(`^.*?${roomPattern}\\s*(?:里|裏|里面|裡面|内|中|这边|那里)?\\s*(?:有|放着|放了|新增|添加|加上|加了|录入|记录|买了)?\\s*`, 'u'), '');
    }
    else {
        value = value.replace(/^(?:我|我们|家里|这边|这里|那个|嗯|呃|请帮我|帮我|帮我记一下)?\s*[^,，、;；\n]{0,30}?(?:里|裏|里面|裡面|内|中)\s*(?:有|放着|放了|新增|添加|加上|加了|录入|记录|买了)\s*/u, '');
    }
    return value
        .replace(/^(?:我|我们|家里|这边|这里|那个|嗯|呃|请帮我|帮我|帮我记一下)?\s*(?:有|新增|添加|加上|加了|录入|记录|记一下|买了|放着|放了)\s*/u, '')
        .trim();
}
function splitNaturalItems(text) {
    const conjunctionPattern = new RegExp(`(还有|以及|另外|并且|再加上|加上|再有|\\s和\\s|\\s跟\\s|\\s与\\s|和(?=\\s*(?:\\d+|[${CHINESE_NUMBER_CHARS}]+)))`, 'gu');
    return cleanText(text)
        .replace(conjunctionPattern, '，')
        .split(/[\n,，、;；]+/u)
        .map((part) => part.trim())
        .filter(Boolean);
}
function looksLikeNaturalQuickAdd(text, roomName) {
    const value = cleanText(text);
    if (!value)
        return false;
    if (roomName && new RegExp(`${escapeRegExp(roomName)}\\s*(?:里|裏|里面|裡面|内|中|有)`, 'u').test(value)) {
        return true;
    }
    if (/(?:里|裏|里面|裡面|内|中)\s*(?:有|放着|放了|新增|添加|加上|加了|录入|记录|买了)/u.test(value)) {
        return true;
    }
    if (/(?:^|[，,。；;\s])(有|还有|新增|添加|录入|记录|记一下|买了|放着|放了)/u.test(value)) {
        return true;
    }
    if (/(还有|以及|另外|并且|再加上|再有)/u.test(value))
        return true;
    return new RegExp(`(^|[,，、;；\\s])(?:\\d+|[${CHINESE_NUMBER_CHARS}]+)\\s*(?:${QUANTITY_UNIT_PATTERN})?\\S+`, 'u').test(value);
}
function parseManualQuickAddLine(line) {
    let name = line.trim();
    if (!name)
        return null;
    let note = '';
    let qty = 1;
    const commaIdx = name.search(/[,，]/);
    if (commaIdx >= 0) {
        note = name.slice(commaIdx + 1).trim();
        name = name.slice(0, commaIdx).trim();
    }
    const qtyMatch = name.match(/^(.+?)\s*[×xX*]\s*(\d+)\s*$/);
    if (qtyMatch) {
        name = qtyMatch[1].trim();
        qty = Math.max(1, Number.parseInt(qtyMatch[2], 10) || 1);
    }
    return name ? { name: tidyItemName(name), qty, note } : null;
}
function parseQuickAddLine(line) {
    const manual = parseManualQuickAddLine(line);
    if (!manual)
        return null;
    if (manual.qty === 1 && !/[×xX*]/.test(line)) {
        const natural = parseNaturalItemPhrase(manual.name);
        if (natural && natural.qty > 1) {
            return { ...natural, note: manual.note };
        }
    }
    return manual;
}
function parseQuickAddText(text) {
    return text
        .split('\n')
        .map(parseQuickAddLine)
        .filter((line) => !!line);
}
function parseQuickAddDraft(text, options = {}) {
    const source = text.trim();
    const room = inferRoom(source, options.rooms);
    if (!source)
        return { lines: [], roomId: room?.id, inferredRoomName: room?.name, mode: 'lines' };
    const natural = looksLikeNaturalQuickAdd(source, room?.name);
    if (!natural) {
        return {
            lines: parseQuickAddText(source),
            roomId: room?.id,
            inferredRoomName: room?.name,
            mode: 'lines',
        };
    }
    const body = stripNaturalPrefix(source, room?.name);
    const lines = splitNaturalItems(body)
        .map(parseNaturalItemPhrase)
        .filter((line) => !!line);
    return {
        lines,
        roomId: room?.id,
        inferredRoomName: room?.name,
        mode: 'natural',
    };
}
function formatQuickAddLines(lines) {
    return lines
        .map((line) => {
        const base = line.qty > 1 ? `${line.name}×${line.qty}` : line.name;
        return line.note ? `${base}, ${line.note}` : base;
    })
        .join('\n');
}
async function resolveTargetCabinet(storage, choice, roomId) {
    if (choice === '__global_loose__' || roomId === models_1.GLOBAL_ROOM_ID) {
        return (0, cabinet_1.ensureGlobalLooseCabinet)(storage);
    }
    if (choice === '__room_loose__' && roomId) {
        return (0, cabinet_1.ensureLooseCabinet)(storage, roomId);
    }
    return choice ? storage.get('cabinets', choice) : undefined;
}
async function addQuickItems(storage, lines, targetCabinet, expiry = '', options = {}) {
    const added = [];
    for (const line of lines) {
        const image = await (0, image_1.generateItemThumb)(line.name);
        const status = options.status || 'placed';
        const item = {
            id: (0, id_1.uid)(),
            cabinetId: targetCabinet.id,
            roomId: targetCabinet.roomId,
            name: line.name,
            qty: line.qty,
            note: line.note,
            tags: [],
            image,
            expiry: expiry || undefined,
            status,
            source: 'manual',
            createdAt: Date.now(),
            lastTouchedAt: Date.now(),
        };
        await storage.add('items', item);
        added.push(item);
    }
    return added;
}
async function scanLooseItemsFromPhoto(storage, photoBlob, size, cfg, targetRoomId, sourcePhoto) {
    const targetCabinet = targetRoomId
        ? await (0, cabinet_1.ensureLooseCabinet)(storage, targetRoomId)
        : await (0, cabinet_1.ensureGlobalLooseCabinet)(storage);
    const result = await (0, ai_1.detectCabinetsAndItems)(photoBlob, size, cfg);
    const added = [];
    for (const box of result.items) {
        const crop = await (0, image_1.cropItemFromPhoto)(photoBlob, box.rect);
        const image = crop || (await (0, image_1.generateItemThumb)(box.name, box.emoji || 'box'));
        const item = {
            id: (0, id_1.uid)(),
            cabinetId: targetCabinet.id,
            roomId: targetCabinet.roomId,
            name: box.name,
            qty: 1,
            note: '',
            tags: [],
            image,
            status: 'pending',
            source: 'ai',
            sourcePhotoId: sourcePhoto?.id || null,
            aiEmoji: box.emoji,
            aiRect: box.rect,
            createdAt: Date.now(),
        };
        await storage.add('items', item);
        added.push(item);
    }
    return added;
}
