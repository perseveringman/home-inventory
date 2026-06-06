"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDemoData = loadDemoData;
const image_1 = require("../utils/image");
const DEMO_ROOMS = [
    {
        id: 'demo-room-living',
        name: '客厅',
        icon: '🛋️',
        color: ['#667eea', '#764ba2'],
        cabinets: [
            {
                id: 'demo-cab-tv',
                name: '电视柜',
                rect: { x: 0.06, y: 0.50, w: 0.55, h: 0.32 },
                items: [
                    { name: '遥控器', qty: 3, note: '电视/空调/机顶盒', tags: ['数码'], emoji: '📺' },
                    { name: '充电线', qty: 5, note: 'Type-C 和 Lightning', tags: ['数码'], emoji: '🔌' },
                    { name: '扑克牌', qty: 1, note: '过年打牌用', tags: ['玩具'], emoji: '🃏' },
                    { name: '纸巾盒', qty: 1, tags: ['日用'], emoji: '🧻' },
                ],
            },
            {
                id: 'demo-cab-side',
                name: '沙发边柜',
                rect: { x: 0.68, y: 0.28, w: 0.24, h: 0.48 },
                items: [
                    { name: '台灯', qty: 1, note: '暖光护眼灯', tags: ['家电'], emoji: '💡' },
                    { name: '杂志', qty: 4, tags: ['书籍'], emoji: '📰' },
                    { name: '指甲剪套装', qty: 1, tags: ['日用'], emoji: '💅' },
                ],
            },
        ],
    },
    {
        id: 'demo-room-bedroom',
        name: '主卧',
        icon: '🛏️',
        color: ['#f093fb', '#f5576c'],
        cabinets: [
            {
                id: 'demo-cab-wardrobe-left',
                name: '衣柜左侧',
                rect: { x: 0.05, y: 0.08, w: 0.34, h: 0.80 },
                items: [
                    { name: '羽绒服', qty: 2, tags: ['衣物'], emoji: '🧥' },
                    { name: '毛衣', qty: 4, tags: ['衣物'], emoji: '🧶' },
                    { name: '行李箱', qty: 1, note: '20 寸登机箱', tags: ['日用'], emoji: '🧳' },
                ],
            },
            {
                id: 'demo-cab-nightstand',
                name: '床头柜',
                rect: { x: 0.75, y: 0.48, w: 0.18, h: 0.35 },
                items: [
                    { name: '充电宝', qty: 1, tags: ['数码'], emoji: '🔋' },
                    { name: '眼罩', qty: 1, tags: ['日用'], emoji: '😴' },
                    { name: '水杯', qty: 1, tags: ['日用'], emoji: '🥤' },
                ],
            },
        ],
    },
    {
        id: 'demo-room-kitchen',
        name: '厨房',
        icon: '🍳',
        color: ['#4facfe', '#00f2fe'],
        cabinets: [
            {
                id: 'demo-cab-wall',
                name: '吊柜',
                rect: { x: 0.05, y: 0.07, w: 0.58, h: 0.32 },
                items: [
                    { name: '碗', qty: 8, tags: ['厨具'], emoji: '🍜' },
                    { name: '盘子', qty: 6, tags: ['厨具'], emoji: '🍽️' },
                    { name: '干货', qty: 3, note: '木耳、香菇、枸杞', tags: ['食品'], emoji: '🍄' },
                ],
            },
            {
                id: 'demo-cab-fridge',
                name: '冰箱',
                rect: { x: 0.62, y: 0.15, w: 0.30, h: 0.70 },
                items: [
                    { name: '鸡蛋', qty: 12, tags: ['食品'], emoji: '🥚' },
                    { name: '牛奶', qty: 2, tags: ['饮料'], emoji: '🥛' },
                    { name: '酸奶', qty: 6, tags: ['食品'], emoji: '🥤' },
                ],
            },
        ],
    },
];
async function makeDemoPhoto(room) {
    const width = 1200;
    const height = 900;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, room.color[0]);
    grad.addColorStop(1, room.color[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let x = 0; x < width; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    for (let y = 0; y < height; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 54px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillText(room.name, width / 2, height / 2 - 20);
    ctx.font = '22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.70)';
    ctx.fillText('示例照片 - 点击柜子管理物品', width / 2, height / 2 + 30);
    for (const cab of room.cabinets) {
        const x = cab.rect.x * width;
        const y = cab.rect.y * height;
        const w = cab.rect.w * width;
        const h = cab.rect.h * height;
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.82)';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 8]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(cab.name, x + w / 2, y + h / 2);
    }
    const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.86));
    return { blob, width, height };
}
async function loadDemoData(storage, replace = false) {
    const existing = await storage.all('rooms');
    if (existing.length && !replace) {
        throw new Error('已有数据，若要重新加载示例请先清空或选择覆盖');
    }
    if (replace)
        await storage.clearAll();
    const baseTime = Date.now() - 86400000 * 30;
    for (const [roomIndex, demo] of DEMO_ROOMS.entries()) {
        const room = {
            id: demo.id,
            name: demo.name,
            icon: demo.icon,
            createdAt: baseTime + roomIndex * 86400000,
        };
        await storage.add('rooms', room);
        const photoData = await makeDemoPhoto(demo);
        const photo = {
            id: `demo-photo-${demo.id}`,
            roomId: room.id,
            ...photoData,
            createdAt: room.createdAt + 1000,
        };
        await storage.add('photos', photo);
        for (const cab of demo.cabinets) {
            const cabinet = {
                id: cab.id,
                photoId: photo.id,
                roomId: room.id,
                name: cab.name,
                rect: cab.rect,
                type: 'normal',
                createdAt: room.createdAt + 2000,
            };
            await storage.add('cabinets', cabinet);
            for (const data of cab.items) {
                const item = {
                    id: `demo-item-${cab.id}-${data.name}`.replace(/\s+/g, ''),
                    cabinetId: cabinet.id,
                    roomId: room.id,
                    name: data.name,
                    qty: data.qty,
                    note: data.note || '',
                    tags: data.tags || [],
                    image: await (0, image_1.generateItemThumb)(data.name, data.emoji || '📦'),
                    status: 'placed',
                    source: 'manual',
                    createdAt: room.createdAt + 3000,
                    lastTouchedAt: room.createdAt + 3000,
                };
                await storage.add('items', item);
            }
        }
    }
}
