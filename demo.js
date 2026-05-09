/* ================================================================
 * demo.js — 示例数据生成器
 * 首次打开应用时自动填充丰富的示例房间、柜子和物品
 * ================================================================ */

const DEMO_ROOMS = [
  {
    id: 'demo-room-1', name: '客厅', icon: '🛋️', createdAt: Date.now() - 86400000 * 30,
    color: ['#667eea', '#764ba2'],
    photoUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&h=900&fit=crop',
    cabinets: [
      {
        id: 'demo-cab-1a', name: '电视柜',
        rect: { x: 0.03, y: 0.45, w: 0.55, h: 0.40 },
        items: [
          { name: '遥控器', qty: 3, note: '电视/空调/机顶盒各一个', tags: ['电器'] },
          { name: '充电线', qty: 5, note: 'Type-C × 3、Lightning × 2', tags: ['电子'] },
          { name: '相框', qty: 2, note: '全家福 + 旅行照', tags: ['装饰'] },
          { name: '收纳盒', qty: 1, note: '放杂物的藤编盒', tags: ['收纳'] },
          { name: '扑克牌', qty: 1, note: '过年打牌用', tags: ['娱乐'] },
        ]
      },
      {
        id: 'demo-cab-1b', name: '沙发旁边柜',
        rect: { x: 0.65, y: 0.30, w: 0.30, h: 0.55 },
        items: [
          { name: '台灯', qty: 1, note: '暖光护眼灯', tags: ['电器'] },
          { name: '杂志', qty: 4, note: '《读者》《三联》', tags: ['书籍'] },
          { name: '纸巾盒', qty: 1, note: '', tags: ['日用'] },
          { name: '指甲剪套装', qty: 1, note: '', tags: ['日用'] },
        ]
      },
    ]
  },
  {
    id: 'demo-room-2', name: '主卧', icon: '🛏️', createdAt: Date.now() - 86400000 * 28,
    color: ['#f093fb', '#f5576c'],
    photoUrl: 'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=1200&h=900&fit=crop',
    cabinets: [
      {
        id: 'demo-cab-2a', name: '衣柜（左侧）',
        rect: { x: 0.03, y: 0.08, w: 0.35, h: 0.82 },
        items: [
          { name: '羽绒服', qty: 2, note: '黑色长款 + 灰色短款', tags: ['冬装'] },
          { name: '西装', qty: 1, note: '深蓝色，面试穿的', tags: ['正装'] },
          { name: '毛衣', qty: 4, note: '高领 × 2、圆领 × 2', tags: ['冬装'] },
          { name: '牛仔裤', qty: 3, note: '深蓝、浅蓝、黑色各一条', tags: ['裤装'] },
          { name: '围巾', qty: 2, note: '羊毛的和薄款各一条', tags: ['配饰'] },
          { name: '行李箱', qty: 1, note: '20寸登机箱，藏在最下面', tags: ['旅行'] },
        ]
      },
      {
        id: 'demo-cab-2b', name: '衣柜（右侧）',
        rect: { x: 0.40, y: 0.08, w: 0.35, h: 0.82 },
        items: [
          { name: 'T恤', qty: 8, note: '各种颜色', tags: ['夏装'] },
          { name: '运动服', qty: 2, note: '速干面料', tags: ['运动'] },
          { name: '袜子', qty: 10, note: '黑白各半，抽屉里', tags: ['内衣'] },
          { name: '内衣', qty: 6, note: '', tags: ['内衣'] },
          { name: '睡衣', qty: 2, note: '棉质，一薄一厚', tags: ['居家'] },
        ]
      },
      {
        id: 'demo-cab-2c', name: '床头柜',
        rect: { x: 0.80, y: 0.50, w: 0.17, h: 0.40 },
        items: [
          { name: '充电宝', qty: 1, note: '10000mAh', tags: ['电子'] },
          { name: '眼罩', qty: 1, note: '遮光用', tags: ['睡眠'] },
          { name: 'Kindle', qty: 1, note: '在看《三体》', tags: ['电子'] },
          { name: '水杯', qty: 1, note: '保温杯', tags: ['日用'] },
        ]
      },
    ]
  },
  {
    id: 'demo-room-3', name: '厨房', icon: '🍳', createdAt: Date.now() - 86400000 * 25,
    color: ['#4facfe', '#00f2fe'],
    photoUrl: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&h=900&fit=crop',
    cabinets: [
      {
        id: 'demo-cab-3a', name: '吊柜',
        rect: { x: 0.03, y: 0.05, w: 0.60, h: 0.35 },
        items: [
          { name: '碗', qty: 8, note: '白色陶瓷，大小各半', tags: ['餐具'] },
          { name: '盘子', qty: 6, note: '圆盘 × 4、鱼盘 × 2', tags: ['餐具'] },
          { name: '杯子', qty: 4, note: '玻璃杯 × 2、马克杯 × 2', tags: ['餐具'] },
          { name: '保温壶', qty: 1, note: '1.5L', tags: ['餐具'] },
          { name: '干货', qty: 3, note: '木耳、香菇、枸杞', tags: ['食材'] },
        ]
      },
      {
        id: 'demo-cab-3b', name: '橱柜（灶台下）',
        rect: { x: 0.03, y: 0.45, w: 0.45, h: 0.45 },
        items: [
          { name: '炒锅', qty: 1, note: '32cm 不粘锅', tags: ['厨具'] },
          { name: '汤锅', qty: 1, note: '不锈钢，煲汤用', tags: ['厨具'] },
          { name: '砧板', qty: 2, note: '生熟分开', tags: ['厨具'] },
          { name: '刀具套装', qty: 1, note: '菜刀、水果刀、剪刀', tags: ['厨具'] },
          { name: '调味料', qty: 6, note: '盐、糖、酱油、醋、蚝油、料酒', tags: ['调料'] },
          { name: '食用油', qty: 1, note: '花生油 5L', tags: ['调料'] },
        ]
      },
      {
        id: 'demo-cab-3c', name: '冰箱',
        rect: { x: 0.55, y: 0.15, w: 0.40, h: 0.75 },
        items: [
          { name: '鸡蛋', qty: 12, note: '冰箱门上', tags: ['食材'] },
          { name: '牛奶', qty: 2, note: '鲜奶，保质期短', tags: ['饮品'] },
          { name: '酸奶', qty: 6, note: '原味 × 4、草莓 × 2', tags: ['饮品'] },
          { name: '豆腐', qty: 1, note: '今晚要做麻婆豆腐', tags: ['食材'] },
          { name: '水果', qty: 3, note: '苹果、橙子、葡萄', tags: ['食材'] },
          { name: '剩菜', qty: 1, note: '昨天的红烧肉', tags: ['食材', '⚠️快过期'] },
        ]
      },
    ]
  },
  {
    id: 'demo-room-4', name: '书房', icon: '📚', createdAt: Date.now() - 86400000 * 22,
    color: ['#a18cd1', '#fbc2eb'],
    photoUrl: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1200&h=900&fit=crop',
    cabinets: [
      {
        id: 'demo-cab-4a', name: '左侧书柜',
        rect: { x: 0.03, y: 0.10, w: 0.28, h: 0.80 },
        items: [
          { name: '设计模式', qty: 2, note: 'GoF 经典，中英文各一本', tags: ['书籍', '技术'] },
          { name: '深入理解计算机系统', qty: 1, note: 'CSAPP', tags: ['书籍', '技术'] },
          { name: 'JavaScript 高级程序设计', qty: 1, note: '红宝书第四版', tags: ['书籍', '技术'] },
          { name: '人类简史', qty: 1, note: '尤瓦尔·赫拉利', tags: ['书籍', '社科'] },
          { name: '百年孤独', qty: 1, note: '马尔克斯', tags: ['书籍', '文学'] },
          { name: '活着', qty: 1, note: '余华', tags: ['书籍', '文学'] },
        ]
      },
      {
        id: 'demo-cab-4b', name: '右侧书柜',
        rect: { x: 0.70, y: 0.10, w: 0.27, h: 0.80 },
        items: [
          { name: '文件夹', qty: 5, note: '合同、发票、保险、体检、其他', tags: ['文件'] },
          { name: '笔记本', qty: 3, note: 'A5 活页本 × 2、Muji × 1', tags: ['文具'] },
          { name: '打印机墨盒', qty: 2, note: '黑色 + 彩色', tags: ['耗材'] },
          { name: '移动硬盘', qty: 1, note: '2TB，备份照片用', tags: ['电子'] },
          { name: '计算器', qty: 1, note: '卡西欧科学计算器', tags: ['文具'] },
        ]
      },
      {
        id: 'demo-cab-4c', name: '书桌抽屉',
        rect: { x: 0.35, y: 0.55, w: 0.30, h: 0.35 },
        items: [
          { name: '签字笔', qty: 8, note: '黑色为主，快用完了', tags: ['文具'] },
          { name: '便签纸', qty: 2, note: '黄色方块 + 彩色长条', tags: ['文具'] },
          { name: 'U盘', qty: 2, note: '32G + 64G', tags: ['电子'] },
          { name: '尺子', qty: 1, note: '30cm', tags: ['文具'] },
          { name: '胶带', qty: 1, note: '透明胶带 + 底座', tags: ['文具'] },
        ]
      },
    ]
  },
  {
    id: 'demo-room-5', name: '儿童房', icon: '🧸', createdAt: Date.now() - 86400000 * 20,
    color: ['#ffecd2', '#fcb69f'],
    photoUrl: 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?w=1200&h=900&fit=crop',
    cabinets: [
      {
        id: 'demo-cab-5a', name: '玩具柜',
        rect: { x: 0.03, y: 0.10, w: 0.45, h: 0.75 },
        items: [
          { name: '乐高', qty: 3, note: '城市系列、星球大战、创意盒', tags: ['玩具'] },
          { name: '毛绒玩具', qty: 5, note: '小熊、兔子、恐龙、猫咪、企鹅', tags: ['玩具'] },
          { name: '拼图', qty: 2, note: '100 片 + 300 片', tags: ['玩具'] },
          { name: '画笔套装', qty: 1, note: '水彩 + 蜡笔 + 彩铅', tags: ['美术'] },
          { name: '绘本', qty: 12, note: '宫西达也、大卫系列', tags: ['书籍'] },
        ]
      },
      {
        id: 'demo-cab-5b', name: '衣柜',
        rect: { x: 0.55, y: 0.10, w: 0.40, h: 0.80 },
        items: [
          { name: '校服', qty: 2, note: '夏装 + 秋装', tags: ['童装'] },
          { name: '外套', qty: 3, note: '冲锋衣、卫衣、夹克', tags: ['童装'] },
          { name: '裤子', qty: 4, note: '运动裤 × 2、牛仔裤 × 2', tags: ['童装'] },
          { name: '鞋子', qty: 3, note: '运动鞋、凉鞋、雨靴', tags: ['鞋'] },
          { name: '书包', qty: 1, note: '粉色双肩包', tags: ['学习'] },
        ]
      },
    ]
  },
  {
    id: 'demo-room-6', name: '卫生间', icon: '🚿', createdAt: Date.now() - 86400000 * 18,
    color: ['#89f7fe', '#66a6ff'],
    photoUrl: 'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=1200&h=900&fit=crop',
    cabinets: [
      {
        id: 'demo-cab-6a', name: '镜柜',
        rect: { x: 0.20, y: 0.05, w: 0.55, h: 0.35 },
        items: [
          { name: '牙膏', qty: 2, note: '云南白药 + 高露洁', tags: ['洗护'] },
          { name: '牙刷', qty: 2, note: '电动 + 普通备用', tags: ['洗护'] },
          { name: '洗面奶', qty: 1, note: '芙丽芳丝', tags: ['护肤'] },
          { name: '护肤品', qty: 3, note: '水、乳、精华', tags: ['护肤'] },
          { name: '剃须刀', qty: 1, note: '飞利浦电动', tags: ['洗护'] },
          { name: '隐形眼镜', qty: 2, note: '日抛 × 30片', tags: ['洗护'] },
        ]
      },
      {
        id: 'demo-cab-6b', name: '浴室柜',
        rect: { x: 0.10, y: 0.50, w: 0.45, h: 0.40 },
        items: [
          { name: '洗发水', qty: 1, note: '750ml 大瓶', tags: ['洗护'] },
          { name: '沐浴露', qty: 1, note: '力士，快用完了', tags: ['洗护'] },
          { name: '毛巾', qty: 4, note: '浴巾 × 2、手巾 × 2', tags: ['日用'] },
          { name: '吹风机', qty: 1, note: '戴森', tags: ['电器'] },
          { name: '洗衣液', qty: 1, note: '蓝月亮 3kg', tags: ['清洁'] },
          { name: '卫生纸', qty: 6, note: '囤货，整提', tags: ['日用'] },
        ]
      },
    ]
  },
  {
    id: 'demo-room-7', name: '阳台', icon: '🧺', createdAt: Date.now() - 86400000 * 15,
    color: ['#a1c4fd', '#c2e9fb'],
    photoUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&h=900&fit=crop',
    cabinets: [
      {
        id: 'demo-cab-7a', name: '洗衣柜',
        rect: { x: 0.03, y: 0.20, w: 0.45, h: 0.65 },
        items: [
          { name: '洗衣液', qty: 1, note: '补充装 1L', tags: ['清洁'] },
          { name: '柔顺剂', qty: 1, note: '金纺', tags: ['清洁'] },
          { name: '晾衣架', qty: 20, note: '塑料 × 15、木质 × 5', tags: ['日用'] },
          { name: '夹子', qty: 10, note: '晒袜子用', tags: ['日用'] },
          { name: '熨斗', qty: 1, note: '挂烫机', tags: ['电器'] },
        ]
      },
      {
        id: 'demo-cab-7b', name: '储物柜',
        rect: { x: 0.55, y: 0.15, w: 0.40, h: 0.70 },
        items: [
          { name: '工具箱', qty: 1, note: '螺丝刀、扳手、锤子、卷尺', tags: ['工具'] },
          { name: '吸尘器', qty: 1, note: '戴森 V12，充电中', tags: ['电器', '清洁'] },
          { name: '花盆', qty: 4, note: '绿萝 × 2、多肉 × 2', tags: ['园艺'] },
          { name: '肥料', qty: 1, note: '通用型营养土', tags: ['园艺'] },
          { name: '圣诞灯', qty: 2, note: '彩灯串，节庆装饰', tags: ['装饰', '⚠️闲置'] },
          { name: '旧杂志', qty: 10, note: '可以考虑扔掉', tags: ['杂物', '⚠️可丢弃'] },
        ]
      },
    ]
  },
];

/* 物品 emoji 映射表 */
const ITEM_EMOJIS = {
  '遥控器': '🔌', '充电线': '🔌', '相框': '🖼️', '收纳盒': '📦', '扑克牌': '🃏',
  '台灯': '💡', '杂志': '📰', '纸巾盒': '🧻', '指甲剪套装': '💅',
  '羽绒服': '🧥', '西装': '🤵', '毛衣': '🧶', '牛仔裤': '👖', '围巾': '🧣', '行李箱': '🧳',
  'T恤': '👕', '运动服': '🏃', '袜子': '🧦', '内衣': '👙', '睡衣': '👚',
  '充电宝': '🔋', '眼罩': '😴', 'Kindle': '📖', '水杯': '🥤',
  '碗': '🍜', '盘子': '🍽️', '杯子': '☕', '保温壶': '🫖', '干货': '🍄',
  '炒锅': '🍳', '汤锅': '🫕', '砧板': '🪵', '刀具套装': '🔪', '调味料': '🧂', '食用油': '🫒',
  '鸡蛋': '🥚', '牛奶': '🥛', '酸奶': '🥤', '豆腐': '🧊', '水果': '🍎', '剩菜': '🍖',
  '设计模式': '📘', '深入理解计算机系统': '📕', 'JavaScript 高级程序设计': '📗',
  '人类简史': '📙', '百年孤独': '📓', '活着': '📔',
  '文件夹': '📁', '笔记本': '📝', '打印机墨盒': '🖨️', '移动硬盘': '💾', '计算器': '🧮',
  '签字笔': '🖊️', '便签纸': '📌', 'U盘': '💽', '尺子': '📏', '胶带': '🎞️',
  '乐高': '🧱', '毛绒玩具': '🧸', '拼图': '🧩', '画笔套装': '🎨', '绘本': '📚',
  '校服': '👔', '外套': '🧥', '裤子': '👖', '鞋子': '👟', '书包': '🎒',
  '牙膏': '🪥', '牙刷': '🪥', '洗面奶': '🧴', '护肤品': '🧴', '剃须刀': '🪒', '隐形眼镜': '👓',
  '洗发水': '🧴', '沐浴露': '🧴', '毛巾': '🧖', '吹风机': '💨', '洗衣液': '🧴', '卫生纸': '🧻',
  '洗衣液': '🧴', '柔顺剂': '🧴', '晾衣架': '👕', '夹子': '📎', '熨斗': '👔',
  '工具箱': '🧰', '吸尘器': '🧹', '花盆': '🪴', '肥料': '🌱', '圣诞灯': '🎄', '旧杂志': '📰',
};

/* 从 Unsplash 获取真实房间照片，失败时降级为 canvas 占位图 */
async function fetchDemoPhoto(room) {
  // 尝试从 Unsplash 获取真实照片
  if (room.photoUrl) {
    try {
      const res = await fetch(room.photoUrl);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 1000 && blob.type.startsWith('image/')) {
          const bmp = await createImageBitmap(blob).catch(() => null);
          if (bmp) {
            const result = { blob, width: bmp.width, height: bmp.height };
            bmp.close();
            return result;
          }
        }
      }
    } catch {}
  }
  // 降级：canvas 生成占位图
  const w = 1200, h = 900;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, room.color[0]);
  grad.addColorStop(1, room.color[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 48px -apple-system, "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${room.icon} ${room.name}`, w / 2, h / 2 - 20);
  ctx.font = '20px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('示例照片 — 点击柜子查看物品', w / 2, h / 2 + 30);
  for (const cab of room.cabinets) {
    const r = cab.rect;
    const cx = r.x * w, cy = r.y * h, cw = r.w * w, ch = r.h * h;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(cx, cy, cw, ch);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 16px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(cab.name, cx + cw / 2, cy + ch / 2 + 6);
  }
  let blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob || blob.size < 100) {
    // 最终兜底：生成一个最小有效 JPEG
    blob = await new Promise(r => {
      const c = document.createElement('canvas'); c.width = 2; c.height = 2;
      const x = c.getContext('2d'); x.fillStyle = room.color[0]; x.fillRect(0, 0, 2, 2);
      c.toBlob(r, 'image/jpeg', 0.5);
    });
  }
  return { blob, width: w, height: h };
}

/* 主函数：向 IndexedDB 填充示例数据 */
async function loadDemoData() {
  // 已有数据或用户主动清空过则不自动加载
  if (localStorage.getItem('hi-demo-cleared')) return false;
  const existing = await db.all('rooms');
  if (existing.length > 0) return false;

  toast('正在加载示例数据…');

  for (const room of DEMO_ROOMS) {
    await db.add('rooms', {
      id: room.id, name: room.name, icon: room.icon, createdAt: room.createdAt,
    });

    // 获取照片（优先 Unsplash 真实图片）
    const { blob: photoBlob, width, height } = await fetchDemoPhoto(room);
    if (!photoBlob || !(photoBlob instanceof Blob) || photoBlob.size < 8) {
      console.warn(`跳过房间 ${room.name}：照片生成失败`);
      continue;
    }
    const photoId = `demo-photo-${room.id}`;
    await db.add('photos', {
      id: photoId, roomId: room.id, blob: photoBlob,
      width, height, createdAt: room.createdAt + 1000,
    });

    // 写入柜子和物品
    for (const cab of room.cabinets) {
      await db.add('cabinets', {
        id: cab.id, photoId, roomId: room.id,
        name: cab.name, rect: cab.rect, createdAt: room.createdAt + 2000,
      });
      for (const item of cab.items) {
        const emoji = ITEM_EMOJIS[item.name] || '📦';
        const image = await generateItemThumb(item.name, emoji);
        await db.add('items', {
          id: `demo-item-${cab.id}-${item.name}`.replace(/\s+/g, ''),
          cabinetId: cab.id, roomId: room.id,
          name: item.name, qty: item.qty || 1,
          note: item.note || '', tags: item.tags || [],
          image, createdAt: room.createdAt + 3000,
        });
      }
    }
  }

  toast('示例数据加载完成！');
  return true;
}

window.loadDemoData = loadDemoData;
