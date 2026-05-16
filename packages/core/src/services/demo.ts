import type { ActionLog, Cabinet, Item, Label, Photo, Room, ScanSession, Subscription } from '../models';
import { DEMO_HOME_ID, GLOBAL_ROOM_ID } from '../models';
import type { Storage } from '../storage/types';
import { generateItemThumb } from '../utils/image';

interface DemoCabinet {
  id: string;
  name: string;
  rect: Cabinet['rect'];
  items: Array<{ name: string; qty: number; note?: string; tags?: string[]; emoji?: string }>;
}

interface DemoRoom {
  id: string;
  name: string;
  icon: string;
  color: [string, string];
  cabinets: DemoCabinet[];
}

const DEMO_ROOMS: DemoRoom[] = [
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

async function makeDemoPhoto(room: DemoRoom): Promise<{ blob: Blob; width: number; height: number }> {
  const width = 1200;
  const height = 900;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
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
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.86)
  );
  return { blob, width, height };
}

export async function loadDemoData(storage: Storage, replace = false): Promise<void> {
  const homeId = storage.homeId || DEMO_HOME_ID;
  const existing = await storage.all('rooms');
  if (existing.length && !replace) {
    throw new Error('已有数据，若要重新加载示例请先清空或选择覆盖');
  }
  if (replace) await storage.clearAll();
  const baseTime = Date.now() - 86400000 * 30;
  const firstIds = {
    roomId: '',
    photoId: '',
    cabinetId: '',
    itemId: '',
  };
  for (const [roomIndex, demo] of DEMO_ROOMS.entries()) {
    const room: Room = {
      id: demo.id,
      homeId,
      name: demo.name,
      icon: demo.icon,
      createdAt: baseTime + roomIndex * 86400000,
    };
    if (!firstIds.roomId) firstIds.roomId = room.id;
    await storage.add('rooms', room);
    const photoData = await makeDemoPhoto(demo);
    const photo: Photo = {
      id: `demo-photo-${demo.id}`,
      homeId,
      roomId: room.id,
      ...photoData,
      createdAt: room.createdAt + 1000,
    };
    if (!firstIds.photoId) firstIds.photoId = photo.id;
    await storage.add('photos', photo);
    for (const cab of demo.cabinets) {
      const cabinet: Cabinet = {
        id: cab.id,
        homeId,
        photoId: photo.id,
        roomId: room.id,
        name: cab.name,
        rect: cab.rect,
        type: 'normal',
        createdAt: room.createdAt + 2000,
      };
      if (!firstIds.cabinetId) firstIds.cabinetId = cabinet.id;
      await storage.add('cabinets', cabinet);
      for (const data of cab.items) {
        const item: Item = {
          id: `demo-item-${cab.id}-${data.name}`.replace(/\s+/g, ''),
          homeId,
          cabinetId: cabinet.id,
          roomId: room.id,
          name: data.name,
          qty: data.qty,
          note: data.note || '',
          tags: data.tags || [],
          image: await generateItemThumb(data.name, data.emoji || '📦'),
          status: 'placed',
          source: 'manual',
          createdAt: room.createdAt + 3000,
          lastTouchedAt: room.createdAt + 3000,
        };
        if (!firstIds.itemId) firstIds.itemId = item.id;
        await storage.add('items', item);
      }
    }
  }

  const globalCabinet: Cabinet = {
    id: 'demo-cab-global-loose',
    homeId,
    photoId: null,
    roomId: GLOBAL_ROOM_ID,
    name: '全屋自由区',
    rect: { x: 0, y: 0, w: 0, h: 0 },
    type: 'loose-global',
    createdAt: baseTime + 86400000 * 4,
  };
  await storage.add('cabinets', globalCabinet);
  const pendingItems: Item[] = [
    {
      id: 'demo-item-pending-vitamin',
      homeId,
      cabinetId: globalCabinet.id,
      roomId: GLOBAL_ROOM_ID,
      name: '维生素 D',
      qty: 1,
      note: '待确认放药箱还是床头柜',
      tags: ['药品'],
      image: await generateItemThumb('维生素 D', '💊'),
      expiry: new Date(Date.now() + 86400000 * 12).toISOString().slice(0, 10),
      status: 'pending',
      source: 'ai',
      aiEmoji: '💊',
      confidence: 0.82,
      aiReason: '识别为瓶装保健品，建议先进入待处理',
      reviewStatus: 'pending',
      createdAt: baseTime + 86400000 * 5,
    },
    {
      id: 'demo-item-pending-cable',
      homeId,
      cabinetId: globalCabinet.id,
      roomId: GLOBAL_ROOM_ID,
      name: 'HDMI 线',
      qty: 2,
      note: '可能属于电视柜',
      tags: ['数码'],
      image: await generateItemThumb('HDMI 线', '🔌'),
      status: 'pending',
      source: 'manual',
      aiEmoji: '🔌',
      createdAt: baseTime + 86400000 * 5 + 1000,
    },
  ];
  for (const item of pendingItems) await storage.add('items', item);

  const subscriptions: Subscription[] = [
    {
      id: 'demo-sub-cloud',
      homeId,
      name: 'iCloud+',
      icon: '☁️',
      category: 'software',
      amount: 21,
      currency: 'CNY',
      cycle: 'monthly',
      nextDueAt: new Date(Date.now() + 86400000 * 8).toISOString().slice(0, 10),
      autoRenew: true,
      paymentMethod: 'Apple Pay',
      status: 'active',
      decision: 'keep',
      source: 'manual',
      createdAt: baseTime + 86400000 * 6,
    },
    {
      id: 'demo-sub-video',
      homeId,
      name: '视频会员',
      icon: '▶️',
      category: 'membership',
      amount: 29,
      currency: 'CNY',
      cycle: 'monthly',
      nextDueAt: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
      autoRenew: true,
      paymentMethod: '微信',
      status: 'active',
      decision: 'review',
      reviewBeforeDays: 3,
      source: 'ai_text',
      evidenceText: '微信自动续费提醒：视频会员 29 元/月',
      createdAt: baseTime + 86400000 * 7,
    },
  ];
  for (const sub of subscriptions) await storage.add('subscriptions', sub);

  const labels: Label[] = [
    {
      id: 'demo-label-room',
      homeId,
      code: 'hi_demo_room',
      labelNo: 'D-001',
      targetType: 'room',
      targetId: firstIds.roomId,
      status: 'linked',
      createdAt: baseTime + 86400000 * 8,
      updatedAt: baseTime + 86400000 * 8,
    },
    {
      id: 'demo-label-item',
      homeId,
      code: 'hi_demo_item',
      labelNo: 'D-002',
      targetType: 'item',
      targetId: firstIds.itemId,
      status: 'linked',
      createdAt: baseTime + 86400000 * 8 + 1000,
      updatedAt: baseTime + 86400000 * 8 + 1000,
    },
  ];
  for (const label of labels) await storage.add('labels', label);

  const scanSession: ScanSession = {
    id: 'demo-scan-review',
    homeId,
    photoId: firstIds.photoId,
    roomId: firstIds.roomId,
    status: 'reviewing',
    candidates: [
      {
        id: 'demo-candidate-cabinet',
        kind: 'cabinet',
        name: '展示柜',
        rect: { x: 0.12, y: 0.18, w: 0.34, h: 0.42 },
        confidence: 0.86,
        aiReason: '疑似独立储物区域',
        reviewStatus: 'pending',
        createdAt: baseTime + 86400000 * 9,
      },
      {
        id: 'demo-candidate-item',
        kind: 'item',
        name: '备用电池',
        rect: { x: 0.24, y: 0.34, w: 0.12, h: 0.12 },
        emoji: '🔋',
        confidence: 0.74,
        suggestedCabinetCandidateId: 'demo-candidate-cabinet',
        placementConfidence: 0.8,
        placementReason: '物品位于展示柜框内',
        reviewStatus: 'pending',
        createdAt: baseTime + 86400000 * 9 + 1000,
      },
    ],
    createdAt: baseTime + 86400000 * 9,
  };
  await storage.add('scanSessions', scanSession);

  const logs: ActionLog[] = [
    {
      id: 'demo-log-seeded',
      homeId,
      source: 'system',
      type: 'demo_seeded',
      summary: '生成示例 home 数据',
      targetType: 'home',
      targetId: homeId,
      createdAt: Date.now(),
    },
    {
      id: 'demo-log-scan',
      homeId,
      source: 'ai',
      type: 'scan_session_created',
      summary: '生成扫描审核：1 个柜子 · 1 件物品',
      targetType: 'scanSession',
      targetId: scanSession.id,
      createdAt: Date.now() + 1,
    },
  ];
  for (const log of logs) await storage.add('actionLogs', log);
}
