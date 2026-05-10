/* ================================================================
 * 家居收纳 · 物品档案  (MVP, 纯前端 IndexedDB)
 * 数据模型：
 *   rooms:    { id, name, icon, createdAt }
 *   photos:   { id, roomId, blob, width, height, createdAt }
 *   cabinets: { id, photoId, roomId, name, rect:{x,y,w,h} (0~1 归一化), createdAt }
 *   items:    { id, cabinetId, roomId, name, qty, note, tags:[], createdAt }
 * ================================================================ */

/* ---------- 极简 IndexedDB 封装 ---------- */
const DB_NAME = 'home-inventory';
const DB_VERSION = 3;
const STORES = ['rooms', 'photos', 'cabinets', 'items', 'config', 'subscriptions'];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (name === 'photos' || name === 'cabinets' || name === 'items') {
            store.createIndex('roomId', 'roomId', { unique: false });
          }
          if (name === 'cabinets' || name === 'items') {
            store.createIndex(name === 'cabinets' ? 'photoId' : 'cabinetId',
                              name === 'cabinets' ? 'photoId' : 'cabinetId',
                              { unique: false });
          }
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result && result.value !== undefined ? result.value : result);
    t.onerror    = () => reject(t.error);
  });
}

const db = {
  add:    (store, obj)   => tx(store, 'readwrite', s => s.put(obj)),
  put:    (store, obj)   => tx(store, 'readwrite', s => s.put(obj)),
  del:    (store, id)    => tx(store, 'readwrite', s => s.delete(id)),
  get:    (store, id)    => new Promise(async (res, rej) => {
    const d = await openDB();
    const r = d.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }),
  all:    (store)        => new Promise(async (res, rej) => {
    const d = await openDB();
    const r = d.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  }),
  byIndex:(store, index, value) => new Promise(async (res, rej) => {
    const d = await openDB();
    const r = d.transaction(store).objectStore(store).index(index).getAll(value);
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  }),
  clearAll: async () => {
    const d = await openDB();
    const toClear = STORES.filter(n => n !== 'config'); // 保留 API Key 等配置
    await Promise.all(toClear.map(n => new Promise((res, rej) => {
      const r = d.transaction(n, 'readwrite').objectStore(n).clear();
      r.onsuccess = res; r.onerror = () => rej(r.error);
    })));
  }
};

/* ---------- 配置存储（API Key 等） ---------- */
async function getConfig(key, fallback = '') {
  try { const r = await db.get('config', key); return r ? r.value : fallback; }
  catch { return fallback; }
}
async function setConfig(key, value) {
  await db.put('config', { id: key, value });
}

/* ---------- Claude Vision 柜子识别 ---------- */
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

/* 柜子识别统一提示词
 * 关键策略：
 *   1. 强调"独立可存放单元"——每扇柜门、每个开放格、每个收纳盒都是独立单元
 *   2. 明确不要把多个相邻柜门合并成一个大框
 *   3. 同类多个时统一按从左到右、从上到下编号
 *   4. 桌面上的小型收纳盒/抽屉柜也要识别
 *   5. 边界框要紧贴物体边缘，避免过大或过小
 */
const CABINET_DETECT_PROMPT = `你是家居收纳整理助手。请仔细分析这张房间照片，同时完成两件事：
A) 识别所有可用于存放物品的"独立储物单元"（柜子/开放格/桌面等）及其边界框
B) 识别照片中肉眼可见的、值得记录的"单个物品"（杂物/工具/日用品等）及其边界框

====== 【A. 识别储物单元】 ======
1. 每一个【独立可存取的储物空间】都要单独识别，不要合并：
   - 多扇并排的柜门 → 每扇柜门算一个独立单元（即使它们外观一样、紧挨在一起）
   - 多个并排的开放格/方格 → 每个格子算一个独立单元
   - 桌面上的收纳盒、收纳筐、抽屉柜 → 每个都是独立单元
   - 抽屉柜的多个抽屉 → 如果能清楚看到抽屉边界，分开识别
2. 范围要包括：
   - 大型家具：衣柜、书柜、橱柜、壁柜、吊柜、地柜、电视柜、储物柜
   - 开放式：开放格、置物架、书架的每一层
   - 桌面/小型：桌面收纳盒、桌面抽屉柜、收纳筐、文件盒、首饰盒
   - 透明/半透明储物盒也要识别
   - **桌面/工作台面**：书桌、办公桌、餐桌、床头柜的台面区域算一个独立的"放置单元"，即使台面上只是平放物品（笔、水杯、键盘）也要识别。命名为"XX 桌面"或"XX 台面"。**只框桌面平面区域，不要框桌腿、不要包含桌面下方的椅子或抽屉柜**。
3. 不要识别为储物单元：墙面、地面、天花板、门、窗、显示器/屏幕本身、电脑/笔记本本身、装饰品本身、人和宠物

【储物单元命名规则】
- 同类型有多个时，按从左到右、从上到下顺序编号
- 例如："白色吊柜1"、"白色吊柜2"、"开放格1"、"桌面收纳盒1"、"办公桌桌面"
- 名称要包含颜色或材质等可区分特征（白色/黑色/木色/透明等）

====== 【B. 识别单个物品】 ======
1. **请尽可能穷尽地识别照片里**所有**肉眼能看见、能区分出轮廓的物品**，不要遗漏。范围非常广，包括但远不限于：
   - 电子产品：键盘、鼠标、耳机、手机、平板、相机、充电器、数据线、路由器、音箱、遥控器、电池、U 盘
   - 日用品：杯子、水瓶、保温杯、书、笔记本、便签、笔、眼镜、钥匙、钱包、纸巾盒、湿巾、口罩、药盒、垃圾桶、衣架
   - 厨房用品：碗、盘、筷子、勺子、刀、锅、铲、调料瓶、罐头、零食、水果、蔬菜、瓶装饮料
   - 卫浴用品：牙刷、牙膏、洗面奶、沐浴露、毛巾、化妆品、护肤品、剃须刀、梳子、卷纸
   - 工具/文具：剪刀、胶带、卷尺、螺丝刀、订书机、胶水、订书针、夹子、文件夹
   - 玩具/摆件：毛绒玩具、手办、相框、小盆栽、绿植、装饰小物、香薰、蜡烛
   - 衣物配饰：帽子、包、围巾、衣物、鞋、袜子、首饰
   - 文件/纸张/书本：每一本书、每一份文件、每一张纸都可以单独识别
   - 墙上/桌上的画、海报、日历、时钟、相框、装饰画也算物品
   - 食物、饮料、植物、宠物用品都算物品
2. **识别原则：宁可多不可少**。只要能在图里看到一个独立的实体（哪怕只能看到一部分、哪怕有点模糊、哪怕你不确定具体型号），都尝试识别出来并起一个合理的中文名。不确定的就用通用名（比如"白色瓶子""黑色小盒子""蓝色书本"）。
3. **不要因为下列理由跳过**：
   - 物体看起来很小 → 仍要识别
   - 物体只露出一部分 → 仍要识别，名字里可写"（部分可见）"
   - 物体在透明/半透明盒子里 → 也要识别（盒子本身归入 A，盒子里能看清的物品仍要逐个识别）
   - 多个相同物品堆在一起 → 也要识别，可命名为"XX 一摞""XX×N"或分开识别
   - 不知道具体名字 → 用颜色/形状/材质描述（如"白色塑料罐""红色小盒"）
4. **真正不识别**的只有：家具本身（柜子、椅子、桌子——这些归入 A）、墙体/地面/天花板/门窗、人和宠物本身、显示器上正在播放的画面内容、非常远处看不清是什么的色块。
5. 每件物品给一个**尽量具体的中文名**（能想到品牌/用途就写上，如"苹果鼠标"而非"鼠标"；不确定则用通用名），并配一个合适的 emoji。
6. **不设数量上限**。请把图里看到的所有物品都列出来，理想情况下应该有几十件甚至上百件。如果你只列出十几件，说明你漏了很多——请再仔细扫一遍图。
7. 如果照片里确实一件物品都没有（只有空房间和家具），items 返回 []。

====== 【边界框要求】（对 A 和 B 都适用） ======
- 使用归一化坐标 [x, y, w, h]，范围 0~1，原点在左上角
- x, y 是左上角坐标；w, h 是宽高
- 边界要【紧贴物体边缘】，不要过大留白，也不要切到物体
- 确保 x+w ≤ 1 且 y+h ≤ 1

====== 【输出格式】 ======
只输出一个 JSON 对象（不要任何解释、Markdown 代码块或其他文字）：
{"cabinets":[{"name":"白色吊柜1","rect":{"x":0.05,"y":0.10,"w":0.20,"h":0.35}}],"items":[{"name":"苹果无线键盘","emoji":"⌨️","rect":{"x":0.42,"y":0.61,"w":0.15,"h":0.05}}]}

如果某类没有内容，对应字段给空数组 []。请尽可能识别完整，宁可多不可少。`;

/* 解析 AI 返回，兼容三种格式：
 *   1. 新格式对象 { cabinets:[], items:[] }
 *   2. 旧格式数组（纯柜子，向后兼容）
 * 返回统一结构 { cabinets: [...], items: [...] }
 */
function parseDetection(text) {
  // 剥离 ```json ... ``` 代码块
  const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  // 尝试提取 JSON 对象（优先）或数组
  let payload;
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (objMatch) {
    try { payload = JSON.parse(objMatch[0]); }
    catch (e) { /* 继续尝试数组 */ }
  }
  if (!payload && arrMatch) {
    try { payload = JSON.parse(arrMatch[0]); }
    catch (e) { throw new Error('JSON 解析失败：' + e.message); }
  }
  if (!payload) throw new Error('AI 返回格式异常：' + text.slice(0, 120));

  // 规整为 { cabinets, items }
  let rawCabinets, rawItems;
  if (Array.isArray(payload)) {
    rawCabinets = payload;
    rawItems = [];
  } else {
    rawCabinets = Array.isArray(payload.cabinets) ? payload.cabinets : [];
    rawItems    = Array.isArray(payload.items)    ? payload.items    : [];
  }

  const clampRect = (r) => {
    let x = +r.x || 0, y = +r.y || 0, w = +r.w || 0.1, h = +r.h || 0.1;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    w = Math.max(0.02, Math.min(1, w));
    h = Math.max(0.02, Math.min(1, h));
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;
    return { x, y, w, h };
  };

  const cabinets = rawCabinets.map((b, i) => ({
    name: (b.name || `柜子${i + 1}`).toString().slice(0, 30),
    rect: clampRect(b.rect || {}),
  })).filter(b => b.rect.w > 0.02 && b.rect.h > 0.02);

  const items = rawItems.map((b, i) => ({
    name: (b.name || `物品${i + 1}`).toString().slice(0, 30),
    emoji: (b.emoji || '').toString().slice(0, 4),
    rect: clampRect(b.rect || {}),
  })).filter(b => b.rect.w > 0.01 && b.rect.h > 0.01);

  return { cabinets, items };
}

/* 向后兼容别名：老代码里若还在调 parseCabinetBoxes，返回扁平数组 */
function parseCabinetBoxes(text) {
  return parseDetection(text).cabinets;
}


async function fileToBase64(blob) {
  if (!blob || !(blob instanceof Blob)) throw new Error('无效的图片数据');
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function detectCabinetsWithClaude(blob, { width, height }) {
  const apiKey = await getConfig('claude_api_key');
  if (!apiKey) throw new Error('请先在设置页填入 Claude API Key');

  const maxSide = 1568;
  let imgBlob = blob;
  if (blob && blob.size > 100 && Math.max(width, height) > maxSide) {
    const ratio = maxSide / Math.max(width, height);
    const nw = Math.round(width * ratio), nh = Math.round(height * ratio);
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (bmp) {
      const c = document.createElement('canvas');
      c.width = nw; c.height = nh;
      c.getContext('2d').drawImage(bmp, 0, 0, nw, nh);
      imgBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      bmp.close();
    }
  }

  const base64 = await fileToBase64(imgBlob);
  const proxy = await getConfig('claude_proxy_url', '');

  const res = await fetch(proxy + ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: CABINET_DETECT_PROMPT }
        ]
      }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API 调用失败 (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '[]';
  return parseDetection(text);
}

/* ---------- 工具 ---------- */
const uid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = ts => { const d = new Date(ts); return `${d.getMonth()+1}月${d.getDate()}日`; };

/* ---------- 预设标签 ----------
 * 用户常用品类标签。可在物品 modal 里一键打上；也支持自定义标签。
 * 这些标签会被提醒引擎和统计页用作分类维度。
 */
const PRESET_TAGS = [
  { name: '药品',     emoji: '💊' },
  { name: '保健品',   emoji: '🌿' },
  { name: '食品',     emoji: '🍱' },
  { name: '零食',     emoji: '🍪' },
  { name: '饮料',     emoji: '🥤' },
  { name: '数码',     emoji: '💻' },
  { name: '家电',     emoji: '🔌' },
  { name: '衣物',     emoji: '👕' },
  { name: '书籍',     emoji: '📚' },
  { name: '文具',     emoji: '✏️' },
  { name: '工具',     emoji: '🔧' },
  { name: '玩具',     emoji: '🧸' },
  { name: '美妆',     emoji: '💄' },
  { name: '日用',     emoji: '🧻' },
  { name: '厨具',     emoji: '🍳' },
];

/* 是否填了任一扩展属性（用于默认展开 modal 的"更多属性"区） */
function hasExtendedProps(item) {
  if (!item) return false;
  return !!(item.openedAt || item.openedShelfDays || item.purchasedAt
    || item.warrantyMonths || item.minStock != null && item.minStock !== ''
    || item.season);
}

/* 保质期工具：传入 ISO 日期字符串 (yyyy-mm-dd)，返回 { days, level, label, badge } 或 null
 *   level: 'expired' | 'soon' | 'warn' | 'ok'
 *   badge: 一段可直接插入 HTML 的小徽标
 */
function expiryInfo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T23:59:59');
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = d.getTime() - today.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  let level, label, cls;
  if (days < 0) {
    level = 'expired';
    label = `已过期 ${-days} 天`;
    cls = 'bg-red-100 text-red-700 border-red-200';
  } else if (days === 0) {
    level = 'expired';
    label = '今日到期';
    cls = 'bg-red-100 text-red-700 border-red-200';
  } else if (days <= 30) {
    level = 'soon';
    label = `${days} 天后过期`;
    cls = 'bg-orange-100 text-orange-700 border-orange-200';
  } else if (days <= 90) {
    level = 'warn';
    label = `${days} 天后过期`;
    cls = 'bg-amber-50 text-amber-700 border-amber-200';
  } else {
    level = 'ok';
    label = `保质至 ${dateStr}`;
    cls = 'bg-slate-100 text-slate-600 border-slate-200';
  }
  const badge = `<span class="inline-block px-1.5 py-0.5 rounded border text-[10px] leading-none ${cls}" title="${label}">⏰ ${label}</span>`;
  return { days, level, label, badge, cls };
}

/* ================================================================
 * 提醒事件引擎
 * 从所有物品中派生出 6 类时效性事件：
 *   1. expiry    保质期临近/已过
 *   2. opened    开封后超过建议天数
 *   3. warranty  保修期临近/已过
 *   4. lowstock  库存低于下限
 *   5. seasonal  换季提醒（当前月份匹配季节）
 *   6. dust      久未动（createdAt 超过 180 天且从未编辑）
 * 每个事件 { kind, level, itemId, title, subtitle, daysLeft, icon }
 * level: 'critical' | 'warn' | 'info'
 * ================================================================ */
const REMINDER_ICONS = {
  expiry:   '⏰',
  opened:   '🧃',
  warranty: '🛡️',
  lowstock: '📉',
  seasonal: '🗓️',
  dust:     '💤',
};

const DUST_DAYS = 180;

function daysBetween(aMs, bMs) {
  return Math.floor((bMs - aMs) / (24 * 60 * 60 * 1000));
}

function computeReminderEvents(items) {
  const events = [];
  const now = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const curMonth = today.getMonth() + 1; // 1~12

  // 季节 → 月份范围
  const SEASON_MONTHS = {
    spring: [3, 4, 5],
    summer: [6, 7, 8],
    autumn: [9, 10, 11],
    winter: [12, 1, 2],
  };

  for (const it of items) {
    // 跳过待处理（它们自己就会出现在待处理列表里，不重复生成事件）
    if (it.status === 'pending') continue;

    // 1. 保质期
    if (it.expiry) {
      const info = expiryInfo(it.expiry);
      if (info && info.level !== 'ok') {
        events.push({
          kind: 'expiry',
          level: info.level === 'expired' || info.level === 'soon' ? 'critical' : 'warn',
          itemId: it.id,
          title: it.name,
          subtitle: info.label,
          daysLeft: info.days,
          icon: REMINDER_ICONS.expiry,
        });
      }
    }

    // 2. 开封后超期
    if (it.openedAt && it.openedShelfDays) {
      const openedMs = new Date(it.openedAt + 'T00:00:00').getTime();
      if (!isNaN(openedMs)) {
        const passed = daysBetween(openedMs, now);
        const remain = (+it.openedShelfDays) - passed;
        if (remain <= 14) {
          events.push({
            kind: 'opened',
            level: remain < 0 ? 'critical' : remain <= 3 ? 'critical' : 'warn',
            itemId: it.id,
            title: it.name,
            subtitle: remain < 0 ? `开封已 ${passed} 天 · 超过建议 ${-remain} 天` : `开封已 ${passed} 天 · 还剩 ${remain} 天`,
            daysLeft: remain,
            icon: REMINDER_ICONS.opened,
          });
        }
      }
    }

    // 3. 保修到期
    if (it.purchasedAt && it.warrantyMonths) {
      const pMs = new Date(it.purchasedAt + 'T00:00:00').getTime();
      if (!isNaN(pMs)) {
        const end = new Date(pMs);
        end.setMonth(end.getMonth() + (+it.warrantyMonths));
        const remainDays = daysBetween(now, end.getTime());
        if (remainDays <= 60) {
          events.push({
            kind: 'warranty',
            level: remainDays < 0 ? 'info' : remainDays <= 30 ? 'critical' : 'warn',
            itemId: it.id,
            title: it.name,
            subtitle: remainDays < 0 ? `保修已过 ${-remainDays} 天` : `保修还剩 ${remainDays} 天`,
            daysLeft: remainDays,
            icon: REMINDER_ICONS.warranty,
          });
        }
      }
    }

    // 4. 库存低
    if (it.minStock != null && it.minStock !== '' && (+it.minStock) > 0) {
      const q = +it.qty || 0;
      if (q <= (+it.minStock)) {
        events.push({
          kind: 'lowstock',
          level: q === 0 ? 'critical' : 'warn',
          itemId: it.id,
          title: it.name,
          subtitle: q === 0 ? `库存为 0 · 建议补货` : `库存 ${q} 件（低于下限 ${it.minStock}）`,
          daysLeft: -999,
          icon: REMINDER_ICONS.lowstock,
        });
      }
    }

    // 5. 换季
    if (it.season && SEASON_MONTHS[it.season]) {
      const months = SEASON_MONTHS[it.season];
      // 只在"季节前一个月"或"季节第一个月"提醒
      const firstMonth = months[0];
      const preMonth = firstMonth === 1 ? 12 : firstMonth - 1;
      if (curMonth === preMonth || curMonth === firstMonth) {
        events.push({
          kind: 'seasonal',
          level: 'info',
          itemId: it.id,
          title: it.name,
          subtitle: `${seasonLabel(it.season)}将至 · 该整理上架了`,
          daysLeft: 9999,
          icon: REMINDER_ICONS.seasonal,
        });
      }
    }

    // 6. 久未动
    const lastMs = it.lastTouchedAt || it.createdAt || 0;
    if (lastMs && daysBetween(lastMs, now) >= DUST_DAYS) {
      events.push({
        kind: 'dust',
        level: 'info',
        itemId: it.id,
        title: it.name,
        subtitle: `已 ${daysBetween(lastMs, now)} 天未动 · 是否还需要？`,
        daysLeft: 99999,
        icon: REMINDER_ICONS.dust,
      });
    }
  }

  // 排序：critical 优先，daysLeft 越小越急
  const levelOrder = { critical: 0, warn: 1, info: 2 };
  events.sort((a, b) => {
    if (levelOrder[a.level] !== levelOrder[b.level]) return levelOrder[a.level] - levelOrder[b.level];
    return a.daysLeft - b.daysLeft;
  });
  return events;
}

function seasonLabel(s) {
  return { spring: '🌸 春季', summer: '☀️ 夏季', autumn: '🍂 秋季', winter: '❄️ 冬季' }[s] || s;
}

function toast(msg, ms = 1800) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

/* Blob → Object URL 缓存，避免同一张图反复 createObjectURL */
const urlCache = new Map();
const PLACEHOLDER_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect fill="#e2e8f0" width="120" height="120" rx="16"/><text x="60" y="65" text-anchor="middle" font-size="36">📦</text></svg>');
function blobURL(blob, key) {
  if (urlCache.has(key)) return urlCache.get(key);
  if (!blob || !(blob instanceof Blob) || blob.size < 8) return PLACEHOLDER_SVG;
  const u = URL.createObjectURL(blob);
  urlCache.set(key, u);
  return u;
}

/* 将图片压缩到合适尺寸再存，避免 IndexedDB 里堆几十 MB */
async function compressImage(file, maxSide = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // 无法解码时返回空占位
    const blob = await new Promise(r => {
      const c = document.createElement('canvas'); c.width = 1; c.height = 1;
      c.toBlob(r, 'image/png');
    });
    return { blob, width: 1, height: 1 };
  }
  let { width, height } = bitmap;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  width = Math.round(width * scale); height = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  bitmap.close && bitmap.close();
  return { blob, width, height };
}

/* ---------- 物品缩略图生成 ---------- */
// 根据 emoji/名称生成颜色
function nameToHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

// 为物品生成缩略图 blob（彩色背景 + emoji + 名称）
async function generateItemThumb(name, emoji = '') {
  const S = 160;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const hue = nameToHue(name);
  // 渐变背景
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, `hsl(${hue}, 65%, 88%)`);
  grad.addColorStop(1, `hsl(${(hue + 30) % 360}, 55%, 78%)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(0, 0, S, S, 20);
  ctx.fill();
  // emoji
  if (emoji) {
    ctx.font = '48px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, S / 2, S / 2 - 14);
  }
  // 名称
  ctx.font = 'bold 13px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = '#1e293b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = name.length > 5 ? name.slice(0, 5) + '…' : name;
  ctx.fillText(label, S / 2, S - 14);
  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

// 通用灰色占位图
function placeholderBlob() {
  const S = 160;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.roundRect(0, 0, S, S, 20);
  ctx.fill();
  ctx.font = '40px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📦', S / 2, S / 2);
  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

/* 从原图根据归一化 rect 裁剪物品缩略图，输出 Blob；失败/太小返回 null */
async function cropItemFromPhoto(photoBlob, rect, maxSize = 280) {
  try {
    const bmp = await createImageBitmap(photoBlob);
    const sx = Math.max(0, rect.x * bmp.width);
    const sy = Math.max(0, rect.y * bmp.height);
    const sw = Math.min(bmp.width - sx, rect.w * bmp.width);
    const sh = Math.min(bmp.height - sy, rect.h * bmp.height);
    if (sw < 24 || sh < 24) { bmp.close(); return null; }
    const scale = Math.min(1, maxSize / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const c = document.createElement('canvas');
    c.width = dw; c.height = dh;
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
    bmp.close();
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  } catch (e) {
    console.warn('裁剪失败', e);
    return null;
  }
}

/* 确保某房间有一个 type='loose' 的"自由物品收纳处" cabinet，返回该 cabinet */
async function ensureLooseCabinet(roomId) {
  const list = await db.byIndex('cabinets', 'roomId', roomId);
  let loose = list.find(c => c.type === 'loose');
  if (loose) return loose;
  loose = {
    id: uid(),
    photoId: null,
    roomId,
    name: '📥 自由物品收纳处',
    rect: { x: 0, y: 0, w: 0, h: 0 },
    type: 'loose',
    createdAt: Date.now(),
  };
  await db.add('cabinets', loose);
  return loose;
}

/* 确保存在全局"全屋自由区" cabinet（roomId 为特殊值 '__global__'），返回 cabinet */
async function ensureGlobalLooseCabinet() {
  const GID = '__global__';
  const list = await db.all('cabinets');
  let loose = list.find(c => c.type === 'loose-global');
  if (loose) return loose;
  loose = {
    id: uid(),
    photoId: null,
    roomId: GID,
    name: '📦 全屋自由区',
    rect: { x: 0, y: 0, w: 0, h: 0 },
    type: 'loose-global',
    createdAt: Date.now(),
  };
  await db.add('cabinets', loose);
  return loose;
}

/* 判断 cabinet 是否是"自由区"（房间级或全局级） */
function isLooseCabinet(c) {
  return c && (c.type === 'loose' || c.type === 'loose-global');
}

/* ---------- AI 识别接口 ----------
 * 优先 Gemini Vision (OpenRouter) → Claude Vision → 启发式占位
 */
async function detectCabinets(blob, { width, height }) {
  // 1. 尝试 Gemini Vision（OpenRouter）
  const orKey = await getConfig('openrouter_api_key');
  if (orKey) {
    return await detectCabinetsWithGemini(blob, { width, height });
  }
  // 2. 尝试 Claude Vision
  const ckKey = await getConfig('claude_api_key');
  if (ckKey) {
    return await detectCabinetsWithClaude(blob, { width, height });
  }
  // 3. 启发式占位
  await new Promise(r => setTimeout(r, 600));
  const ratio = width / height;
  const boxes = [];
  if (ratio > 1.1) {
    boxes.push({ name: '柜子 1', rect: { x: 0.04, y: 0.18, w: 0.28, h: 0.70 } });
    boxes.push({ name: '柜子 2', rect: { x: 0.36, y: 0.15, w: 0.28, h: 0.72 } });
    boxes.push({ name: '柜子 3', rect: { x: 0.68, y: 0.18, w: 0.28, h: 0.70 } });
  } else {
    boxes.push({ name: '柜子 1', rect: { x: 0.10, y: 0.20, w: 0.80, h: 0.35 } });
    boxes.push({ name: '柜子 2', rect: { x: 0.12, y: 0.58, w: 0.76, h: 0.35 } });
  }
  return { cabinets: boxes, items: [] };
}

/* ---------- 路由（两层分层） ----------
 * scene：顶部场景 tab —— storage / inbox / overview / subscribe / settings
 *   - storage 场景下，底部 tab（rooms/items/search）才出现
 *   - 其他 scene 都是"单页"，不走底部 route
 * route：底部 tab 细分页 —— 仅在 storage 场景下生效
 *   - rooms / room / photo / items / search
 */
const STORAGE_ROUTES = new Set(['rooms', 'room', 'photo', 'items', 'search']);
const TOP_SCENES = new Set(['storage', 'inbox', 'overview', 'subscribe', 'settings']);

const state = {
  scene: 'storage',
  route: { name: 'rooms' },
};

function go(route) {
  const r = typeof route === 'string' ? { name: route } : route;
  if (!r || !r.name) return;
  // 若目标是 storage 的底部 route
  if (STORAGE_ROUTES.has(r.name)) {
    state.scene = 'storage';
    state.route = r;
  } else if (TOP_SCENES.has(r.name)) {
    // 顶部 scene 直接切换
    state.scene = r.name;
  } else {
    // 未知目标 —— 忽略
    return;
  }
  render();
  persistRoute();
}

function goScene(sceneName) {
  if (!TOP_SCENES.has(sceneName)) return;
  state.scene = sceneName;
  if (sceneName === 'storage' && !STORAGE_ROUTES.has(state.route.name)) {
    state.route = { name: 'rooms' };
  }
  render();
  persistRoute();
}

function persistRoute() {
  const payload = state.scene === 'storage' ? state.route : { name: state.scene };
  history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(payload)));
}

window.addEventListener('hashchange', () => {
  try {
    const r = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    if (r && r.name) {
      if (STORAGE_ROUTES.has(r.name)) { state.scene = 'storage'; state.route = r; }
      else if (TOP_SCENES.has(r.name)) { state.scene = r.name; }
      render();
    }
  } catch {}
});

// 全局悬浮 AI 助手按钮 + 即时识别按钮（拍照 + 选图）
function bindGlobalFabs() {
  const chat = document.getElementById('__fab-chat');
  if (chat && !chat.dataset.bound) {
    chat.dataset.bound = '1';
    chat.addEventListener('click', () => openChatPanel().catch(e => toast('打开失败：' + e.message)));
  }
  ['__fab-scan-cam', '__fab-scan-pick'].forEach(labelId => {
    const label = document.getElementById(labelId);
    const input = label?.querySelector('input.__fab-scan-input');
    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // 清空以便再次选择同一文件
        if (file) runQuickItemScan(file).catch(err => toast('识别失败：' + err.message));
      });
    }
  });
  const quick = document.getElementById('__fab-quick-add');
  if (quick && !quick.dataset.bound) {
    quick.dataset.bound = '1';
    quick.addEventListener('click', () => openQuickAddDialog().catch(e => toast('打开失败：' + e.message)));
  }
}
document.addEventListener('DOMContentLoaded', bindGlobalFabs);
if (document.readyState !== 'loading') bindGlobalFabs();

/* 即时识别物品入口：拍照/上传 → 压缩 → AI 识别 → 裁剪 → 入 Inbox */
async function runQuickItemScan(file) {
  const camBtn  = document.getElementById('__fab-scan-cam');
  const pickBtn = document.getElementById('__fab-scan-pick');
  const camIcon  = camBtn?.querySelector('.__fab-scan-icon');
  const pickIcon = pickBtn?.querySelector('.__fab-scan-icon');
  const setBusy = (busy, _text) => {
    [camBtn, pickBtn].forEach(b => {
      if (!b) return;
      b.style.pointerEvents = busy ? 'none' : '';
      b.style.opacity = busy ? '0.85' : '';
    });
    if (camIcon)  camIcon.innerHTML  = busy ? '<span class="scan-spinner"></span>' : '📷';
    if (pickIcon) pickIcon.innerHTML = busy ? '<span class="scan-spinner"></span>' : '🖼️';
  };

  try {
    setBusy(true, '压缩中…');
    const { blob, width, height } = await compressImage(file);

    // 决定归属：当前若在 room / photo 页，归到该房间自由区；否则全屋自由区
    const route = state.route || {};
    let targetRoomId = null;
    if (route.name === 'room' && route.id) {
      targetRoomId = route.id;
    } else if (route.name === 'photo' && route.id) {
      const photo = await db.get('photos', route.id);
      if (photo) targetRoomId = photo.roomId;
    }

    let targetCab, scope;
    if (targetRoomId) {
      targetCab = await ensureLooseCabinet(targetRoomId);
      const room = await db.get('rooms', targetRoomId);
      scope = `${room?.icon || '🏠'} ${room?.name || '当前房间'}`;
    } else {
      targetCab = await ensureGlobalLooseCabinet();
      scope = '📦 全屋自由区';
    }

    setBusy(true, 'AI 识别中…');
    toast('AI 正在识别物品…');
    const detected = await detectCabinets(blob, { width, height });
    const itemList = detected.items || [];

    if (itemList.length === 0) {
      setBusy(false);
      toast('没识别到可记录的物品');
      return;
    }

    setBusy(true, `裁剪 ${itemList.length} 个…`);

    // 保存原图作为 photo，方便之后溯源（可选）；但不暴露到照片列表。
    // 简化：只存 item 的 image，不创建 photo 记录，避免污染房间照片列表。
    for (const it of itemList) {
      const crop = await cropItemFromPhoto(blob, it.rect);
      const image = crop || await generateItemThumb(it.name, it.emoji || '📦');
      await db.add('items', {
        id: uid(),
        cabinetId: targetCab.id,
        roomId: targetCab.roomId, // 'loose-global' 时值是 '__global__'
        name: it.name,
        qty: 1,
        note: '',
        tags: [],
        image,
        status: 'pending',
        source: 'ai',
        sourcePhotoId: null,
        aiEmoji: it.emoji || '',
        aiRect: it.rect,
        createdAt: Date.now(),
      });
    }

    setBusy(false);
    toast(`识别了 ${itemList.length} 件物品 · 已放入${scope}的待处理`);
    refreshInboxBadge();

    // 当前在 inbox / room / rooms 页的话，刷新
    if (['inbox', 'room', 'rooms'].includes(route.name)) {
      render();
    }
  } catch (e) {
    setBusy(false);
    throw e;
  }
}

/* 快速文字录入物品：弹窗输入多行 → 选择目的地 → 批量入库
 * 输入语法（每行一件）：
 *   名称
 *   名称×数量
 *   名称 x 数量
 *   名称, 备注
 *   名称×2, 备注
 */
async function openQuickAddDialog() {
  const [rooms, cabinets] = await Promise.all([db.all('rooms'), db.all('cabinets')]);

  // 推断默认房间：当前在 room/photo 页时优先
  const route = state.route || {};
  let defaultRoomId = '__global__';
  if (route.name === 'room' && route.id) defaultRoomId = route.id;
  else if (route.name === 'photo' && route.id) {
    const p = await db.get('photos', route.id);
    if (p) defaultRoomId = p.roomId;
  }

  const m = modal(`
    <div class="p-5 space-y-4">
      <div>
        <h3 class="text-base font-semibold text-ink-900">✏️ 快速添加物品</h3>
        <p class="text-xs text-ink-500 mt-1">每行一件，支持 <code class="text-brand-600">名称×数量, 备注</code> 语法</p>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-500">物品列表</label>
        <textarea id="qa-list" rows="6" placeholder="牙膏×2&#10;洗发水&#10;螺丝刀, 工具盒里&#10;感冒药×3"
          class="w-full mt-1 p-3 rounded-xl bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm font-mono"></textarea>
      </div>

      <div class="bg-brand-50 rounded-xl p-3 space-y-2">
        <div class="text-xs font-semibold text-brand-700">放到哪里</div>
        <div class="flex gap-2">
          <select id="qa-room" class="flex-1 h-10 px-3 rounded-lg bg-white border border-slate-200 text-sm">
            ${rooms.map(r => `<option value="${r.id}" ${r.id === defaultRoomId ? 'selected' : ''}>${r.icon || '🏠'} ${esc(r.name)}</option>`).join('')}
            <option value="__global__" ${defaultRoomId === '__global__' ? 'selected' : ''}>📦 全屋自由区</option>
          </select>
          <select id="qa-cab" class="flex-1 h-10 px-3 rounded-lg bg-white border border-slate-200 text-sm"></select>
        </div>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-500">⏰ 统一保质期 <span class="text-ink-400 font-normal">（可选，会应用到本次所有物品）</span></label>
        <input id="qa-expiry" type="date" class="w-full mt-1 h-9 px-3 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm"/>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button id="qa-cancel" class="h-9 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm">取消</button>
        <button id="qa-save" class="h-9 px-5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium shadow-soft">添加</button>
      </div>
    </div>
  `);

  const roomSel = m.root.querySelector('#qa-room');
  const cabSel = m.root.querySelector('#qa-cab');

  const refreshCabOptions = async () => {
    const rid = roomSel.value;
    let html = '';
    if (rid === '__global__') {
      await ensureGlobalLooseCabinet();
      html = `<option value="__global_loose__">📦 全屋自由区</option>`;
    } else {
      const cabs = cabinets.filter(c => c.roomId === rid && (c.type === 'normal' || !c.type));
      cabs.sort((a, b) => a.name.localeCompare(b.name));
      html = cabs.map(c => `<option value="${c.id}">🗄️ ${esc(c.name)}</option>`).join('')
           + `<option value="__room_loose__">📥 此房间的自由区</option>`;
    }
    cabSel.innerHTML = html;
  };
  roomSel.addEventListener('change', refreshCabOptions);
  await refreshCabOptions();

  m.root.querySelector('#qa-cancel').onclick = () => m.close();

  m.root.querySelector('#qa-save').onclick = async () => {
    const raw = m.root.querySelector('#qa-list').value || '';
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) { toast('请先输入物品'); return; }

    const rid = roomSel.value;
    const cabChoice = cabSel.value;
    let targetCab;
    if (cabChoice === '__global_loose__') targetCab = await ensureGlobalLooseCabinet();
    else if (cabChoice === '__room_loose__') targetCab = await ensureLooseCabinet(rid);
    else targetCab = cabinets.find(c => c.id === cabChoice);
    if (!targetCab) { toast('请选择目的地'); return; }

    const expiry = m.root.querySelector('#qa-expiry').value || '';

    // 解析每一行：名称[×|x|*]数量, 备注
    const parseLine = (line) => {
      let name = line, qty = 1, note = '';
      // 拆备注（中英文逗号）
      const commaIdx = line.search(/[,，]/);
      if (commaIdx >= 0) {
        name = line.slice(0, commaIdx).trim();
        note = line.slice(commaIdx + 1).trim();
      }
      // 拆数量（×、x、X、*）
      const qtyMatch = name.match(/^(.+?)\s*[×xX*]\s*(\d+)\s*$/);
      if (qtyMatch) {
        name = qtyMatch[1].trim();
        qty = parseInt(qtyMatch[2]) || 1;
      }
      return { name, qty, note };
    };

    let added = 0;
    for (const line of lines) {
      const { name, qty, note } = parseLine(line);
      if (!name) continue;
      const image = await generateItemThumb(name);
      await db.add('items', {
        id: uid(),
        cabinetId: targetCab.id,
        roomId: targetCab.roomId === '__global__' ? '__global__' : targetCab.roomId,
        name, qty, note, tags: [],
        image,
        expiry,
        status: 'placed',
        source: 'manual',
        createdAt: Date.now(),
      });
      added++;
    }

    m.close();
    toast(`已添加 ${added} 件物品`);
    refreshInboxBadge();
    if (['inbox', 'room', 'rooms', 'items', 'search'].includes(route.name)) render();
  };
}


/* ---------- 渲染入口 ---------- */
async function render() {
  const app = $('#app');
  app.innerHTML = '<div class="p-8 text-center text-ink-500">加载中…</div>';

  // 顶部 scene tab 高亮
  $('.scene-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.scene === state.scene);
  });

  // 底部 tab 只在 storage 场景出现
  const tabbar = document.getElementById('__tabbar');
  if (tabbar) tabbar.classList.toggle('hidden', state.scene !== 'storage');

  // 底部 tab 高亮（仅 storage 场景）
  $('.tab-btn').forEach(b => {
    const active = state.scene === 'storage' && (
         b.dataset.route === state.route.name
      || (state.route.name === 'room' && b.dataset.route === 'rooms')
      || (state.route.name === 'photo' && b.dataset.route === 'rooms'));
    b.classList.toggle('text-brand-600', active);
    b.classList.toggle('md:bg-brand-50', active);
    b.classList.toggle('text-ink-500', !active);
  });

  // 刷新顶部「待处理」徽标
  refreshInboxBadge();

  // —— 顶部场景分发 ——
  if (state.scene === 'inbox')     return renderInbox(app);
  if (state.scene === 'overview')  return renderOverview(app);
  if (state.scene === 'subscribe') return renderSubscribe(app);
  if (state.scene === 'settings')  return renderSettings(app);

  // —— 收纳场景下的子路由 ——
  const r = state.route;
  if (r.name === 'rooms')    return renderRooms(app);
  if (r.name === 'room')     return renderRoomDetail(app, r.id);
  if (r.name === 'photo')    return renderPhotoDetail(app, r.id);
  if (r.name === 'items')    return renderItems(app);
  if (r.name === 'search')   return renderSearch(app);
  app.innerHTML = '<div class="p-8">未知页面</div>';
}

async function refreshInboxBadge() {
  try {
    const [items, subs] = await Promise.all([db.all('items'), db.all('subscriptions').catch(() => [])]);
    const pending = items.filter(i => i.status === 'pending').length;
    const itemEvents = computeReminderEvents(items).filter(e => e.level === 'critical');
    const subEvents  = computeSubscriptionEvents(subs || []).filter(e => e.level === 'critical');
    const total = pending + itemEvents.length + subEvents.length;
    const el = document.getElementById('scene-inbox-badge');
    if (!el) return;
    if (total > 0) {
      el.textContent = total > 99 ? '99+' : String(total);
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  } catch (_) { /* ignore */ }
}

/* ---------- 通用：顶部栏 ---------- */
function header({ title, subtitle, back, actions = '' }) {
  return `
    <header class="flex items-center gap-3 px-4 md:px-6 pt-5 pb-4 bg-white/80 backdrop-blur sticky top-0 z-10 border-b border-slate-100">
      ${back ? `<button id="__back" class="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-ink-700">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>` : ''}
      <div class="flex-1 min-w-0">
        <h1 class="text-lg md:text-xl font-semibold text-ink-900 truncate">${esc(title)}</h1>
        ${subtitle ? `<p class="text-xs md:text-sm text-ink-500 mt-0.5 truncate">${esc(subtitle)}</p>` : ''}
      </div>
      ${actions}
    </header>
  `;
}

function bindBack(handler) {
  const b = $('#__back'); if (b) b.onclick = handler;
}

/* ---------- Modal ---------- */
function modal(html, { onClose } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal-card">${html}</div></div>`;
  const close = () => { root.innerHTML = ''; onClose && onClose(); };
  root.querySelector('.modal-backdrop').addEventListener('click', e => {
    if (e.target === root.querySelector('.modal-backdrop')) close();
  });
  return { close, root };
}

/* ================================================================
 * 页面：房间列表
 * ================================================================ */
const ROOM_ICONS = ['🛋️','🛏️','🍳','🚿','📚','👕','🧸','🧺','🧑‍💻','🏠'];
const ROOM_PRESETS = [
  { name: '客厅', icon: '🛋️' }, { name: '卧室', icon: '🛏️' },
  { name: '厨房', icon: '🍳' },  { name: '书房', icon: '📚' },
  { name: '卫生间', icon: '🚿' },{ name: '衣帽间', icon: '👕' },
  { name: '儿童房', icon: '🧸' },{ name: '阳台', icon: '🧺' },
];

async function renderRooms(app) {
  const [rooms, photos, cabinets, items] = await Promise.all([
    db.all('rooms'), db.all('photos'), db.all('cabinets'), db.all('items')
  ]);
  rooms.sort((a,b) => a.createdAt - b.createdAt);

  const countsByRoom = id => ({
    photos: photos.filter(p => p.roomId === id).length,
    cabinets: cabinets.filter(c => c.roomId === id && (c.type === 'normal' || !c.type)).length,
    items: items.filter(i => i.roomId === id && i.status !== 'pending').length,
  });

  // 全屋自由区物品数
  const globalLooseCab = cabinets.find(c => c.type === 'loose-global');
  const globalLooseItems = globalLooseCab ? items.filter(i => i.cabinetId === globalLooseCab.id) : [];
  const globalLoosePending = globalLooseItems.filter(i => i.status === 'pending').length;

  app.innerHTML = `
    ${header({
      title: '家居收纳',
      subtitle: rooms.length ? `${rooms.length} 个房间 · ${items.length} 件物品` : '给家里的每个角落建个档案',
      actions: `<button id="__add" class="px-3.5 md:px-4 h-9 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium flex items-center gap-1 shadow-soft">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        新房间
      </button>`
    })}
    <div class="px-4 md:px-6 py-4">
      ${rooms.length === 0 ? `
        <div class="text-center py-16 px-6">
          <div class="text-6xl mb-4">🏠</div>
          <h2 class="text-lg font-semibold text-ink-900 mb-2">先添加一个房间吧</h2>
          <p class="text-sm text-ink-500 mb-6">为每个房间拍几张平面照，圈出柜子，把每件物品的位置记下来。</p>
          <button id="__empty-add" class="px-5 h-11 rounded-full bg-brand-500 hover:bg-brand-600 text-white font-medium shadow-soft">添加第一个房间</button>
        </div>
      ` : `
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          ${rooms.map(r => {
            const c = countsByRoom(r.id);
            const cover = photos.find(p => p.roomId === r.id);
            return `
              <button class="room-card text-left bg-white rounded-2xl shadow-soft hover:shadow-lg transition overflow-hidden" data-id="${r.id}">
                <div class="aspect-[4/3] bg-slate-100 relative">
                  ${cover
                    ? `<img src="${blobURL(cover.blob, cover.id)}" class="w-full h-full object-cover"/>`
                    : `<div class="w-full h-full flex items-center justify-center text-5xl">${r.icon || '🏠'}</div>`}
                  <div class="absolute top-2 left-2 bg-white/90 backdrop-blur rounded-full px-2 py-0.5 text-xs font-medium">${r.icon || '🏠'} ${esc(r.name)}</div>
                </div>
                <div class="p-3">
                  <div class="flex items-center gap-2 text-xs text-ink-500">
                    <span>📷 ${c.photos}</span>
                    <span>🗄️ ${c.cabinets}</span>
                    <span>📦 ${c.items}</span>
                  </div>
                </div>
              </button>
            `;
          }).join('')}
          <!-- 全屋自由区卡片 -->
          <button id="__global-loose" class="text-left bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-dashed border-amber-300 rounded-2xl shadow-soft hover:shadow-lg transition overflow-hidden">
            <div class="aspect-[4/3] flex flex-col items-center justify-center">
              <div class="text-5xl mb-2">📦</div>
              <div class="text-sm font-medium text-amber-700">全屋自由区</div>
              ${globalLoosePending > 0 ? `<div class="mt-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-semibold">${globalLoosePending} 件待处理</div>` : ''}
            </div>
            <div class="p-3">
              <div class="text-xs text-ink-500">暂时不知道放哪的物品 · ${globalLooseItems.length} 件</div>
            </div>
          </button>
        </div>
      `}
    </div>
  `;

  $('#__add')?.addEventListener('click', () => openRoomDialog());
  $('#__empty-add')?.addEventListener('click', () => openRoomDialog());
  $$('.room-card').forEach(b => b.onclick = () => go({ name: 'room', id: b.dataset.id }));
  $('#__global-loose')?.addEventListener('click', async () => {
    const cab = await ensureGlobalLooseCabinet();
    openLooseListDialog(cab, null);
  });
}

function openRoomDialog(existing) {
  const isEdit = !!existing;
  const m = modal(`
    <div class="p-5">
      <h3 class="text-base font-semibold mb-4">${isEdit ? '编辑房间' : '新建房间'}</h3>
      <label class="block text-xs text-ink-500 mb-1">房间名称</label>
      <input id="rn" type="text" value="${esc(existing?.name || '')}" placeholder="例如：主卧、书房"
        class="w-full h-11 px-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none text-sm"/>
      <div class="mt-4">
        <label class="block text-xs text-ink-500 mb-2">选一个图标</label>
        <div id="icons" class="grid grid-cols-5 gap-2">
          ${ROOM_ICONS.map(i => `<button data-i="${i}" class="ib h-11 rounded-xl border border-slate-200 text-xl hover:bg-slate-50 ${existing?.icon === i ? 'bg-brand-50 border-brand-500' : ''}">${i}</button>`).join('')}
        </div>
      </div>
      ${!isEdit ? `
        <div class="mt-4">
          <p class="text-xs text-ink-500 mb-2">或快速添加：</p>
          <div class="flex flex-wrap gap-2">
            ${ROOM_PRESETS.map(p => `<button data-p='${JSON.stringify(p)}' class="preset px-3 h-8 rounded-full border border-slate-200 hover:border-brand-500 text-sm">${p.icon} ${p.name}</button>`).join('')}
          </div>
        </div>` : ''}
      <div class="flex gap-2 mt-6">
        ${isEdit ? `<button id="del" class="h-11 px-4 rounded-xl text-red-600 font-medium hover:bg-red-50">删除</button>` : ''}
        <div class="flex-1"></div>
        <button id="cancel" class="h-11 px-5 rounded-xl text-ink-700 font-medium hover:bg-slate-100">取消</button>
        <button id="ok" class="h-11 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-medium">${isEdit ? '保存' : '创建'}</button>
      </div>
    </div>
  `);

  let selectedIcon = existing?.icon || '🏠';
  const iconBtns = m.root.querySelectorAll('.ib');
  iconBtns.forEach(b => b.onclick = () => {
    selectedIcon = b.dataset.i;
    iconBtns.forEach(x => x.classList.remove('bg-brand-50','border-brand-500'));
    b.classList.add('bg-brand-50','border-brand-500');
  });

  m.root.querySelectorAll('.preset').forEach(b => b.onclick = () => {
    const p = JSON.parse(b.dataset.p);
    m.root.querySelector('#rn').value = p.name;
    selectedIcon = p.icon;
    iconBtns.forEach(x => {
      x.classList.toggle('bg-brand-50', x.dataset.i === p.icon);
      x.classList.toggle('border-brand-500', x.dataset.i === p.icon);
    });
  });

  m.root.querySelector('#cancel').onclick = m.close;
  m.root.querySelector('#ok').onclick = async () => {
    const name = m.root.querySelector('#rn').value.trim();
    if (!name) { toast('请填写房间名称'); return; }
    if (isEdit) {
      await db.put('rooms', { ...existing, name, icon: selectedIcon });
      toast('已保存');
    } else {
      await db.add('rooms', { id: uid(), name, icon: selectedIcon, createdAt: Date.now() });
      toast('房间已创建');
    }
    m.close(); render();
  };
  m.root.querySelector('#del')?.addEventListener('click', async () => {
    if (!confirm(`删除房间「${existing.name}」及其所有照片、柜子和物品？`)) return;
    const photos  = await db.byIndex('photos', 'roomId', existing.id);
    const cabs    = await db.byIndex('cabinets', 'roomId', existing.id);
    const items   = await db.byIndex('items', 'roomId', existing.id);
    await Promise.all([
      ...photos.map(p => db.del('photos', p.id)),
      ...cabs.map(c => db.del('cabinets', c.id)),
      ...items.map(i => db.del('items', i.id)),
      db.del('rooms', existing.id),
    ]);
    toast('房间已删除');
    m.close(); go('rooms');
  });
}

/* ================================================================
 * 页面：房间详情（照片列表）
 * ================================================================ */
async function renderRoomDetail(app, roomId) {
  const room = await db.get('rooms', roomId);
  if (!room) { go('rooms'); return; }
  const [photos, cabinets, items] = await Promise.all([
    db.byIndex('photos', 'roomId', roomId),
    db.byIndex('cabinets', 'roomId', roomId),
    db.byIndex('items', 'roomId', roomId),
  ]);
  photos.sort((a,b) => a.createdAt - b.createdAt);

  // 房间级自由区 cabinet & 其物品
  const looseCab = cabinets.find(c => c.type === 'loose');
  const looseItems = looseCab ? items.filter(i => i.cabinetId === looseCab.id) : [];
  const loosePending = looseItems.filter(i => i.status === 'pending');

  app.innerHTML = `
    ${header({
      title: `${room.icon || '🏠'} ${room.name}`,
      subtitle: `${photos.length} 张照片 · ${cabinets.length} 个柜子 · ${items.length} 件物品`,
      back: true,
      actions: `<button id="__edit" class="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-ink-700" title="编辑">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14.5 4.5L19.5 9.5M4 20l4.5-.5L20 8l-4-4L4.5 15.5 4 20z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>`
    })}
    <div class="px-4 md:px-6 py-4">
      <div class="mb-4 bg-gradient-to-r from-brand-50 to-indigo-50 rounded-2xl p-4 flex items-start gap-3">
        <div class="text-2xl">📸</div>
        <div class="flex-1 text-sm text-ink-700">
          <strong class="text-ink-900">拍几张平面照</strong>
          <p class="text-xs text-ink-500 mt-1">比如把房间的三面墙分别拍下来，AI 会帮你识别出柜子，你再点每个柜子记录里面有什么物品。</p>
        </div>
      </div>

      ${photos.length === 0 ? `
        <div class="text-center py-12 px-6 bg-white rounded-2xl shadow-soft">
          <div class="text-5xl mb-3">📷</div>
          <p class="text-sm text-ink-500 mb-4">还没有照片</p>
          <div class="flex items-center justify-center gap-3 flex-wrap">
            <label class="inline-block">
              <input type="file" accept="image/*" capture="environment" class="hidden" id="__addphoto-cam1"/>
              <span class="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-brand-500 hover:bg-brand-600 text-white font-medium shadow-soft cursor-pointer">
                📷 拍照
              </span>
            </label>
            <label class="inline-block">
              <input type="file" accept="image/*" class="hidden" id="__addphoto-pick1"/>
              <span class="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-white border border-slate-200 hover:border-brand-500 text-ink-700 hover:text-brand-600 font-medium shadow-soft cursor-pointer">
                🖼️ 选图
              </span>
            </label>
          </div>
        </div>
      ` : `
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-4">
          ${photos.map(p => {
            const nCab = cabinets.filter(c => c.photoId === p.id).length;
            return `
              <button class="photo-card text-left bg-white rounded-2xl shadow-soft hover:shadow-lg transition overflow-hidden" data-id="${p.id}">
                <div class="aspect-[4/3] bg-slate-100 relative">
                  <img src="${blobURL(p.blob, p.id)}" class="w-full h-full object-cover"/>
                  ${nCab > 0 ? `<div class="absolute top-2 right-2 bg-brand-500 text-white rounded-full px-2 py-0.5 text-xs font-semibold shadow">🗄️ ${nCab}</div>` : ''}
                </div>
                <div class="px-3 py-2 text-xs text-ink-500">${fmtDate(p.createdAt)}</div>
              </button>
            `;
          }).join('')}
          <div class="aspect-[4/3] rounded-2xl border-2 border-dashed border-slate-300 hover:border-brand-500 text-ink-500 hover:text-brand-600 flex flex-col items-center justify-center transition gap-1.5 p-2">
            <div class="text-3xl">＋</div>
            <div class="flex items-center gap-2">
              <label class="cursor-pointer">
                <input type="file" accept="image/*" capture="environment" class="hidden" id="__addphoto-cam2"/>
                <span class="inline-flex items-center gap-1 px-3 h-8 rounded-full bg-brand-500 text-white text-xs font-medium hover:bg-brand-600">📷 拍照</span>
              </label>
              <label class="cursor-pointer">
                <input type="file" accept="image/*" class="hidden" id="__addphoto-pick2"/>
                <span class="inline-flex items-center gap-1 px-3 h-8 rounded-full bg-white border border-slate-200 text-ink-700 text-xs font-medium hover:border-brand-500 hover:text-brand-600">🖼️ 选图</span>
              </label>
            </div>
          </div>
        </div>
      `}

      <!-- 自由物品收纳处 -->
      <div class="bg-white rounded-2xl shadow-soft overflow-hidden mt-4">
        <button id="__open-loose" class="w-full flex items-center gap-3 p-4 hover:bg-slate-50 text-left">
          <div class="text-2xl">📥</div>
          <div class="flex-1">
            <div class="text-sm font-semibold text-ink-900 flex items-center gap-2">
              自由物品收纳处
              ${loosePending.length > 0 ? `<span class="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-[18px] text-center font-semibold">${loosePending.length}</span>` : ''}
            </div>
            <div class="text-xs text-ink-500 mt-0.5">暂时不知道放到哪里的物品 · 共 ${looseItems.length} 件${loosePending.length > 0 ? ` · ${loosePending.length} 件待处理` : ''}</div>
          </div>
          <div class="text-ink-300">→</div>
        </button>
      </div>
    </div>
  `;

  bindBack(() => go('rooms'));
  $('#__edit').onclick = () => openRoomDialog(room);
  $('#__open-loose')?.addEventListener('click', async () => {
    const cab = looseCab || await ensureLooseCabinet(roomId);
    openLooseListDialog(cab, room);
  });
  $$('.photo-card').forEach(b => b.onclick = () => go({ name: 'photo', id: b.dataset.id }));

  const addPhoto = async (input) => {
    const file = input.files?.[0]; if (!file) return;
    toast('压缩图片中…');
    const { blob, width, height } = await compressImage(file);
    const photo = { id: uid(), roomId, blob, width, height, createdAt: Date.now() };
    await db.add('photos', photo);
    toast('照片已添加');
    go({ name: 'photo', id: photo.id });
  };
  ['__addphoto-cam1', '__addphoto-pick1', '__addphoto-cam2', '__addphoto-pick2'].forEach(id => {
    $('#' + id)?.addEventListener('change', e => addPhoto(e.target));
  });
}

/* ================================================================
 * 页面：照片详情（柜子标注 & 点击柜子看物品）
 * 这是整个应用的核心交互
 * ================================================================ */
async function renderPhotoDetail(app, photoId) {
  const photo = await db.get('photos', photoId);
  if (!photo) { go('rooms'); return; }
  const room = await db.get('rooms', photo.roomId);
  const cabinets = await db.byIndex('cabinets', 'photoId', photoId);
  const items = (await db.all('items')).filter(i => cabinets.some(c => c.id === i.cabinetId));

  app.innerHTML = `
    ${header({
      title: `${room.icon || '🏠'} ${room.name}`,
      subtitle: `${cabinets.length} 个柜子 · ${items.length} 件物品 · 点柜子查看/编辑`,
      back: true,
      actions: `
        <button id="__detect" class="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white border border-slate-200 hover:border-brand-500 text-sm text-ink-700">
          <span>✨</span> AI 识别
        </button>
        <button id="__edit-boxes" class="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white border border-slate-200 hover:border-amber-500 text-sm text-ink-700 ml-2">
          <span>✏️</span> 编辑边框
        </button>
        <button id="__draw" class="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium shadow-soft ml-2">
          <span>＋</span> <span class="hidden md:inline">手动框选</span><span class="md:hidden">框选</span>
        </button>
      `
    })}

    <div class="px-4 md:px-6 py-4">
      <!-- 移动端工具条 -->
      <div class="md:hidden flex gap-2 mb-3">
        <button id="__detect-m" class="flex-1 h-10 rounded-xl bg-white border border-slate-200 text-sm font-medium flex items-center justify-center gap-1">
          ✨ AI 识别
        </button>
        <button id="__edit-boxes-m" class="flex-1 h-10 rounded-xl bg-white border border-slate-200 text-sm font-medium flex items-center justify-center gap-1">
          ✏️ 编辑边框
        </button>
        <button id="__del-photo" class="h-10 w-10 rounded-xl bg-white border border-slate-200 text-red-500" title="删除照片">
          <svg class="mx-auto" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>

      <div class="bg-white rounded-2xl shadow-soft overflow-hidden">
        <div id="stage-wrap" class="bg-slate-900 flex items-center justify-center p-2 md:p-4">
          <div id="stage" class="photo-stage max-w-full">
            <img id="photo-img" src="${blobURL(photo.blob, photo.id)}" alt="room photo" class="max-h-[65vh]"/>
            <div id="boxes"></div>
            <div id="draw-layer" class="draw-layer hidden"></div>
          </div>
        </div>

        <!-- 柜子列表（折叠区） -->
        <div class="border-t border-slate-100 p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-ink-900">已标注的柜子</h3>
            <button id="__del-photo-desktop" class="hidden md:inline text-xs text-red-500 hover:text-red-700">删除这张照片</button>
          </div>
          <div id="cabinet-list" class="grid grid-cols-1 md:grid-cols-2 gap-2"></div>
        </div>
      </div>

      <div id="hint" class="mt-3 text-center text-xs text-ink-500"></div>
    </div>
  `;

  bindBack(() => go({ name: 'room', id: photo.roomId }));

  /* ----- 渲染柜子叠层 ----- */
  const stage = $('#stage');
  const img = $('#photo-img');
  const boxesEl = $('#boxes');
  const listEl = $('#cabinet-list');

  let editingBoxes = false;
  let selectedCabId = null;

  function renderBoxes() {
    boxesEl.classList.toggle('edit-mode', editingBoxes);
    boxesEl.innerHTML = cabinets.map((c) => {
      const r = c.rect;
      const sel = (editingBoxes && c.id === selectedCabId);
      const dim = (editingBoxes && selectedCabId && c.id !== selectedCabId);
      const handles = sel
        ? ['nw','n','ne','e','se','s','sw','w'].map(d => `<span class="handle ${d}" data-dir="${d}"></span>`).join('')
        : '';
      return `
        <div class="cabinet-box ${sel ? 'selected' : ''} ${dim ? 'dimmed' : ''}" data-id="${c.id}"
          style="left:${r.x*100}%;top:${r.y*100}%;width:${r.w*100}%;height:${r.h*100}%;">
          <span class="label">${esc(c.name)}</span>
          ${handles}
        </div>
      `;
    }).join('');

    if (!editingBoxes) {
      // 普通模式：点击柜子打开详情
      boxesEl.querySelectorAll('.cabinet-box').forEach(b => {
        b.onclick = (e) => { e.stopPropagation(); openCabinetDialog(cabinets.find(c => c.id === b.dataset.id)); };
      });
    }
    // 编辑模式下点击/拖拽由 setupBoxEditing 中的 pointer 事件统一处理
  }

  async function renderList() {
    const allItems = await db.all('items');
    if (cabinets.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-ink-500 col-span-full text-center py-4">还没有柜子，点右上角「AI 识别」或「手动框选」开始标注。</p>`;
      return;
    }
    listEl.innerHTML = cabinets.map(c => {
      const items = allItems.filter(i => i.cabinetId === c.id);
      return `
        <button class="cab-row text-left bg-slate-50 hover:bg-brand-50 rounded-xl p-3 transition" data-id="${c.id}">
          <div class="flex items-center justify-between mb-2">
            <span class="font-medium text-sm text-ink-900">🗄️ ${esc(c.name)}</span>
            <span class="chip">${items.length} 件</span>
          </div>
          ${items.length > 0 ? `
            <div class="flex gap-1.5 overflow-hidden">
              ${items.slice(0, 8).map(it => `
                <div class="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-white shadow-sm">
                  ${it.image ? `<img src="${blobURL(it.image, 'item-' + it.id)}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full flex items-center justify-center text-lg">📦</div>`}
                </div>
              `).join('')}
              ${items.length > 8 ? `<div class="flex-shrink-0 w-10 h-10 rounded-lg bg-slate-200 flex items-center justify-center text-xs text-ink-500">+${items.length - 8}</div>` : ''}
            </div>
          ` : `<p class="text-xs text-ink-500">点击添加物品</p>`}
        </button>
      `;
    }).join('');
    listEl.querySelectorAll('.cab-row').forEach(b =>
      b.onclick = () => openCabinetDialog(cabinets.find(c => c.id === b.dataset.id))
    );
  }

  renderBoxes();
  renderList();

  /* ----- 删除照片 ----- */
  const delPhoto = async () => {
    if (!confirm('删除这张照片及其柜子和物品记录？')) return;
    const cabs = await db.byIndex('cabinets', 'photoId', photoId);
    const items = (await db.all('items')).filter(i => cabs.some(c => c.id === i.cabinetId));
    await Promise.all([
      ...items.map(i => db.del('items', i.id)),
      ...cabs.map(c => db.del('cabinets', c.id)),
      db.del('photos', photoId),
    ]);
    toast('照片已删除');
    go({ name: 'room', id: photo.roomId });
  };
  $('#__del-photo')?.addEventListener('click', delPhoto);
  $('#__del-photo-desktop')?.addEventListener('click', delPhoto);

  /* ----- AI 识别 ----- */
  const runDetect = async () => {
    const hint = $('#hint');
    const orKey = await getConfig('openrouter_api_key');
    const ckKey = await getConfig('claude_api_key');
    const mode = orKey ? 'Gemini Vision' : ckKey ? 'Claude Vision' : '启发式';
    hint.textContent = `✨ ${mode} 正在识别柜子和物品…`;
    try {
      const detected = await detectCabinets(photo.blob, { width: photo.width, height: photo.height });
      const cabList = detected.cabinets || [];
      const itemList = detected.items || [];

      // 1) 添加柜子
      for (const d of cabList) {
        const cab = { id: uid(), photoId, roomId: photo.roomId, name: d.name, rect: d.rect, type: 'normal', createdAt: Date.now() };
        await db.add('cabinets', cab);
        cabinets.push(cab);
      }
      renderBoxes(); renderList();

      // 2) 添加物品到房间的自由区（status: pending）
      let addedItems = 0;
      if (itemList.length > 0) {
        hint.textContent = `✨ 裁剪 ${itemList.length} 个物品图像…`;
        const looseCab = await ensureLooseCabinet(photo.roomId);
        for (const it of itemList) {
          const crop = await cropItemFromPhoto(photo.blob, it.rect);
          const image = crop || await generateItemThumb(it.name, it.emoji || '📦');
          await db.add('items', {
            id: uid(),
            cabinetId: looseCab.id,
            roomId: photo.roomId,
            name: it.name,
            qty: 1,
            note: '',
            tags: [],
            image,
            status: 'pending',
            source: 'ai',
            sourcePhotoId: photoId,
            aiEmoji: it.emoji || '',
            aiRect: it.rect, // 保存 AI 原始 rect，方便之后"查看原图定位"
            createdAt: Date.now(),
          });
          addedItems++;
        }
      }

      hint.textContent = `已识别 ${cabList.length} 个柜子` + (addedItems > 0 ? ` · ${addedItems} 件物品已放入待处理` : '。点击任一柜子可重命名或调整。');
      toast(`AI 识别完成：${cabList.length} 个柜子、${addedItems} 件物品`);
      refreshInboxBadge();
    } catch (e) {
      hint.textContent = '识别失败：' + e.message;
    }
  };
  $('#__detect')?.addEventListener('click', runDetect);
  $('#__detect-m')?.addEventListener('click', runDetect);

  /* ----- 手动框选 ----- */
  const drawLayer = $('#draw-layer');
  let drawing = false;
  $('#__draw').onclick = () => {
    drawing = !drawing;
    drawLayer.classList.toggle('hidden', !drawing);
    $('#hint').textContent = drawing ? '✏️ 在图片上按住拖动，框出一个柜子的范围' : '';
    $('#__draw').classList.toggle('bg-amber-500', drawing);
    $('#__draw').classList.toggle('bg-brand-500', !drawing);
  };

  const pt = (e) => {
    const t = e.touches ? e.touches[0] : e;
    const rect = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (t.clientY - rect.top) / rect.height)),
    };
  };

  let start = null, rectEl = null;
  const onDown = (e) => {
    if (!drawing) return;
    e.preventDefault();
    start = pt(e);
    rectEl = document.createElement('div');
    rectEl.className = 'draw-rect';
    drawLayer.appendChild(rectEl);
  };
  const onMove = (e) => {
    if (!start || !rectEl) return;
    e.preventDefault();
    const p = pt(e);
    const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
    const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    Object.assign(rectEl.style, {
      left: x*100+'%', top: y*100+'%', width: w*100+'%', height: h*100+'%'
    });
  };
  const onUp = async (e) => {
    if (!start || !rectEl) return;
    const p = pt(e);
    const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
    const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    rectEl.remove(); rectEl = null; start = null;
    if (w < 0.03 || h < 0.03) { toast('框选范围太小'); return; }
    const name = prompt('给这个柜子起个名字', `柜子 ${cabinets.length + 1}`);
    if (!name) return;
    const cab = { id: uid(), photoId, roomId: photo.roomId, name: name.trim(), rect: { x, y, w, h }, createdAt: Date.now() };
    await db.add('cabinets', cab);
    cabinets.push(cab);
    renderBoxes(); renderList();
    toast('已添加柜子');
  };

  drawLayer.addEventListener('mousedown', onDown);
  drawLayer.addEventListener('mousemove', onMove);
  drawLayer.addEventListener('mouseup',   onUp);
  drawLayer.addEventListener('mouseleave',onUp);
  drawLayer.addEventListener('touchstart', onDown, { passive: false });
  drawLayer.addEventListener('touchmove',  onMove, { passive: false });
  drawLayer.addEventListener('touchend',   onUp);

  /* ----- 编辑边框：拖拽缩放 + 平移 ----- */
  const toggleEditMode = () => {
    if (drawing) { $('#__draw').click(); } // 关闭框选模式
    editingBoxes = !editingBoxes;
    selectedCabId = null;
    const btns = [$('#__edit-boxes'), $('#__edit-boxes-m')].filter(Boolean);
    btns.forEach(b => {
      b.classList.toggle('bg-amber-500', editingBoxes);
      b.classList.toggle('text-white', editingBoxes);
      b.classList.toggle('bg-white', !editingBoxes);
      b.classList.toggle('text-ink-700', !editingBoxes);
    });
    $('#hint').textContent = editingBoxes
      ? '✏️ 点选一个边框后，拖动四角/四边手柄缩放，拖框中心平移；再次点击空白处取消选择'
      : '';
    renderBoxes();
  };
  $('#__edit-boxes')?.addEventListener('click', toggleEditMode);
  $('#__edit-boxes-m')?.addEventListener('click', toggleEditMode);

  let editDrag = null; // { mode:'move'|'resize', dir, cabId, startPt:{x,y}, startRect:{x,y,w,h}, boxEl }

  const onEditDown = (e) => {
    if (!editingBoxes) return;
    const box = e.target.closest('.cabinet-box');
    const handle = e.target.closest('.handle');

    if (!box) {
      // 点击空白：取消选中
      if (selectedCabId) { selectedCabId = null; renderBoxes(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const cabId = box.dataset.id;

    // 如果点的是未选中的框，先选中（不拖）
    if (cabId !== selectedCabId) {
      selectedCabId = cabId;
      renderBoxes();
      return;
    }

    // 已选中：开始拖拽
    const cab = cabinets.find(c => c.id === cabId);
    if (!cab) return;
    const newBox = boxesEl.querySelector(`.cabinet-box[data-id="${cabId}"]`);
    editDrag = {
      mode: handle ? 'resize' : 'move',
      dir: handle ? handle.dataset.dir : null,
      cabId,
      startPt: pt(e),
      startRect: { ...cab.rect },
      boxEl: newBox,
    };
    if (e.pointerId !== undefined) {
      try { newBox.setPointerCapture(e.pointerId); } catch (_) {}
    }
  };

  const computeNewRect = (drag, p) => {
    const dx = p.x - drag.startPt.x;
    const dy = p.y - drag.startPt.y;
    const s = drag.startRect;
    const MIN = 0.02;
    let { x, y, w, h } = s;

    if (drag.mode === 'move') {
      x = Math.max(0, Math.min(1 - s.w, s.x + dx));
      y = Math.max(0, Math.min(1 - s.h, s.y + dy));
    } else {
      // resize：dir 决定边/角
      const d = drag.dir;
      // 计算两条对边
      let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
      if (d.includes('w')) x1 = Math.max(0, Math.min(x2 - MIN, s.x + dx));
      if (d.includes('e')) x2 = Math.min(1, Math.max(x1 + MIN, s.x + s.w + dx));
      if (d.includes('n')) y1 = Math.max(0, Math.min(y2 - MIN, s.y + dy));
      if (d.includes('s')) y2 = Math.min(1, Math.max(y1 + MIN, s.y + s.h + dy));
      x = x1; y = y1; w = x2 - x1; h = y2 - y1;
    }
    return { x, y, w, h };
  };

  const onEditMove = (e) => {
    if (!editDrag) return;
    e.preventDefault();
    const p = pt(e);
    const r = computeNewRect(editDrag, p);
    Object.assign(editDrag.boxEl.style, {
      left: r.x*100 + '%', top: r.y*100 + '%',
      width: r.w*100 + '%', height: r.h*100 + '%',
    });
    editDrag.lastRect = r;
  };

  const onEditUp = async (e) => {
    if (!editDrag) return;
    const r = editDrag.lastRect || editDrag.startRect;
    const cabId = editDrag.cabId;
    editDrag = null;
    const cab = cabinets.find(c => c.id === cabId);
    if (!cab) return;
    // 仅在实际改变时落库
    const same = ['x','y','w','h'].every(k => Math.abs(cab.rect[k] - r[k]) < 0.001);
    if (!same) {
      cab.rect = r;
      await db.put('cabinets', cab);
    }
    renderBoxes();
  };

  // 用 pointer 事件统一覆盖鼠标 + 触摸
  boxesEl.addEventListener('pointerdown', onEditDown);
  boxesEl.addEventListener('pointermove', onEditMove);
  boxesEl.addEventListener('pointerup',   onEditUp);
  boxesEl.addEventListener('pointercancel', onEditUp);
  // 点击 stage 空白处也能取消选中
  stage.addEventListener('pointerdown', (e) => {
    if (!editingBoxes) return;
    if (e.target === stage || e.target === img) {
      if (selectedCabId) { selectedCabId = null; renderBoxes(); }
    }
  });

  /* ----- 柜子详情弹窗 ----- */
  async function openCabinetDialog(cab) {
    const items = (await db.all('items')).filter(i => i.cabinetId === cab.id);
    const m = modal(`
      <div class="p-5">
        <div class="flex items-center gap-2 mb-4">
          <div class="flex-1">
            <input id="cn" type="text" value="${esc(cab.name)}" class="w-full text-base font-semibold bg-transparent border-b border-slate-200 focus:border-brand-500 outline-none py-1"/>
            <p class="text-xs text-ink-500 mt-1">🗄️ 位于 ${room.icon || ''} ${esc(room.name)}</p>
          </div>
          <button id="del-cab" class="text-red-500 text-xs hover:text-red-700">删除柜子</button>
        </div>

        <h4 class="text-xs font-semibold text-ink-500 mb-2">物品清单（${items.length}）</h4>
        <div id="item-list" class="grid grid-cols-5 gap-2 max-h-72 overflow-y-auto mb-3">
          ${items.length === 0 ? `<p class="text-sm text-ink-500 text-center py-6 col-span-full">还没有物品，在下方添加</p>` : items.map(it => {
            const ei = expiryInfo(it.expiry);
            return `
            <div class="relative group cursor-pointer" data-iid="${it.id}">
              <div class="aspect-square rounded-xl overflow-hidden bg-slate-100 shadow-sm relative">
                ${it.image ? `<img src="${blobURL(it.image, 'item-' + it.id)}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full flex items-center justify-center text-3xl">📦</div>`}
                ${ei && (ei.level === 'expired' || ei.level === 'soon') ? `<span class="absolute top-1 left-1 px-1 py-0.5 rounded text-[9px] leading-none ${ei.cls} border" title="${ei.label}">⏰</span>` : ''}
              </div>
              <div class="mt-1 text-center">
                <div class="text-xs font-medium truncate leading-tight">${esc(it.name)}</div>
                ${it.qty > 1 ? `<div class="text-xs text-ink-500">×${it.qty}</div>` : ''}
                ${ei ? `<div class="mt-0.5 ${ei.level === 'expired' ? 'text-red-600' : ei.level === 'soon' ? 'text-orange-600' : 'text-ink-500'} text-[10px] leading-tight truncate" title="${ei.label}">⏰ ${ei.label}</div>` : ''}
              </div>
              <button class="del-item absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow" title="删除">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
              </button>
            </div>
          `;}).join('')}
        </div>

        <form id="add-item-form" class="space-y-2 bg-brand-50 rounded-xl p-3">
          <div class="flex gap-2 items-center">
            <input id="in" type="text" placeholder="物品名称，例如：吸尘器"
              class="flex-1 h-10 px-3 rounded-lg bg-white border border-transparent focus:border-brand-500 outline-none text-sm"/>
            <input id="iq" type="number" min="1" value="1" class="w-16 h-10 px-2 rounded-lg bg-white border border-transparent focus:border-brand-500 outline-none text-sm text-center"/>
          </div>
          <input id="inote" type="text" placeholder="备注（可选，例如：第二层抽屉）"
            class="w-full h-10 px-3 rounded-lg bg-white border border-transparent focus:border-brand-500 outline-none text-sm"/>
          <div class="flex gap-2 items-center">
            <label class="text-xs text-ink-500 whitespace-nowrap">⏰ 保质期</label>
            <input id="iexp" type="date" class="flex-1 h-9 px-2 rounded-lg bg-white border border-transparent focus:border-brand-500 outline-none text-sm" title="食品/药品保质期（可选）"/>
          </div>
          <div class="flex gap-2 items-center flex-wrap">
            <label class="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border border-slate-200 hover:border-brand-500 text-xs text-ink-700 cursor-pointer">
              📷 拍照
              <input id="iphoto-cam" type="file" accept="image/*" capture="environment" class="hidden"/>
            </label>
            <label class="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border border-slate-200 hover:border-brand-500 text-xs text-ink-700 cursor-pointer">
              🖼️ 选图
              <input id="iphoto-pick" type="file" accept="image/*" class="hidden"/>
            </label>
            <span id="iphoto-label" class="text-xs text-ink-500"></span>
            <div class="flex-1"></div>
            <button type="submit" class="h-9 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium">加入</button>
          </div>
        </form>

        <div class="flex justify-end gap-2 mt-5">
          <button id="close" class="h-10 px-5 rounded-xl text-ink-700 font-medium hover:bg-slate-100">完成</button>
        </div>
      </div>
    `);

    const refresh = async () => { m.close(); openCabinetDialog(await db.get('cabinets', cab.id)); };

    m.root.querySelector('#cn').addEventListener('change', async (e) => {
      const n = e.target.value.trim(); if (!n) return;
      const updated = { ...cab, name: n };
      await db.put('cabinets', updated);
      Object.assign(cab, updated);
      // 更新列表/框上文字
      const label = boxesEl.querySelector(`[data-id="${cab.id}"] .label`);
      if (label) label.textContent = n;
      renderList();
      toast('已重命名');
    });

    let itemPhoto = null;
    const onPhotoPick = async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      const { blob } = await compressImage(file, 400, 0.8);
      itemPhoto = blob;
      m.root.querySelector('#iphoto-label').textContent = '已选照片';
    };
    m.root.querySelector('#iphoto-cam')?.addEventListener('change', onPhotoPick);
    m.root.querySelector('#iphoto-pick')?.addEventListener('change', onPhotoPick);

    m.root.querySelector('#add-item-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = m.root.querySelector('#in').value.trim();
      if (!name) { toast('请填物品名'); return; }
      const qty = parseInt(m.root.querySelector('#iq').value) || 1;
      const note = m.root.querySelector('#inote').value.trim();
      const expiry = m.root.querySelector('#iexp')?.value || '';
      const image = itemPhoto || await generateItemThumb(name);
      await db.add('items', {
        id: uid(), cabinetId: cab.id, roomId: cab.roomId,
        name, qty, note, tags: [], image,
        expiry,
        status: 'placed', source: 'manual',
        createdAt: Date.now()
      });
      itemPhoto = null;
      toast('已添加');
      refresh();
    };

    m.root.querySelectorAll('.del-item').forEach(b => b.onclick = async (e) => {
      const id = e.currentTarget.closest('[data-iid]').dataset.iid;
      await db.del('items', id);
      toast('已删除'); refresh();
    });

    m.root.querySelector('#del-cab').onclick = async () => {
      if (!confirm(`删除柜子「${cab.name}」及其 ${items.length} 件物品？`)) return;
      await Promise.all([
        ...items.map(i => db.del('items', i.id)),
        db.del('cabinets', cab.id),
      ]);
      const idx = cabinets.findIndex(c => c.id === cab.id);
      if (idx >= 0) cabinets.splice(idx, 1);
      m.close();
      renderBoxes(); renderList();
      toast('柜子已删除');
    };

    m.root.querySelector('#close').onclick = () => { m.close(); renderList(); };
  }
}

/* ================================================================
 * 页面：全局物品视图（按房间 → 柜子 分组）
 * ================================================================ */
async function renderItems(app) {
  const [rooms, cabinets, allItems] = await Promise.all([
    db.all('rooms'), db.all('cabinets'), db.all('items')
  ]);
  // 物品页不显示待处理物品（它们在 Inbox 里）
  const items = allItems.filter(i => i.status !== 'pending');
  const photos = await db.all('photos');
  const cabMap = Object.fromEntries(cabinets.map(c => [c.id, c]));
  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]));

  // 按 room → cabinet 分组
  const grouped = {};
  items.forEach(it => {
    const cab = cabMap[it.cabinetId]; if (!cab) return;
    const room = roomMap[cab.roomId]; if (!room) return;
    const k1 = room.id; const k2 = cab.id;
    grouped[k1] = grouped[k1] || { room, cabinets: {} };
    grouped[k1].cabinets[k2] = grouped[k1].cabinets[k2] || { cabinet: cab, items: [] };
    grouped[k1].cabinets[k2].items.push(it);
  });

  const totalItems = items.reduce((s, i) => s + (i.qty || 1), 0);
  const normalCabCount = cabinets.filter(c => !isLooseCabinet(c)).length;

  app.innerHTML = `
    ${header({
      title: '所有物品',
      subtitle: items.length
        ? `${rooms.length} 个房间 · ${normalCabCount} 个柜子 · ${totalItems} 件物品`
        : '还没有记录物品',
    })}
    <div class="px-4 md:px-6 py-4">
      ${items.length === 0 ? `
        <div class="text-center py-16 px-6 bg-white rounded-2xl shadow-soft">
          <div class="text-5xl mb-3">📦</div>
          <p class="text-sm text-ink-500 mb-4">去「房间」里拍张照片，框出柜子后就能添加物品了。</p>
          <button id="__goto" class="px-5 h-11 rounded-full bg-brand-500 hover:bg-brand-600 text-white font-medium">去添加</button>
        </div>
      ` : Object.values(grouped).map(g => `
        <section class="mb-5 bg-white rounded-2xl shadow-soft overflow-hidden">
          <button class="w-full flex items-center gap-2 px-4 py-3 border-b border-slate-100 hover:bg-slate-50 text-left room-link" data-id="${g.room.id}">
            <span class="text-lg">${g.room.icon || '🏠'}</span>
            <span class="font-semibold text-ink-900">${esc(g.room.name)}</span>
            <span class="text-xs text-ink-500">(${Object.values(g.cabinets).reduce((s,c)=>s+c.items.length,0)} 件)</span>
            <span class="ml-auto text-xs text-ink-500">查看 →</span>
          </button>
          <div class="divide-y divide-slate-100">
            ${Object.values(g.cabinets).map(ci => {
              const photo = photos.find(p => p.id === ci.cabinet.photoId);
              return `
                <div class="p-3">
                  <button class="flex items-center gap-2 mb-2 cab-link" data-photo="${ci.cabinet.photoId}">
                    ${photo ? `<img src="${blobURL(photo.blob, photo.id)}" class="w-10 h-10 rounded-lg object-cover"/>` : ''}
                    <span class="text-sm font-medium">🗄️ ${esc(ci.cabinet.name)}</span>
                    <span class="chip">${ci.items.length}</span>
                  </button>
                  <div class="grid grid-cols-5 gap-2 pl-12">
                    ${ci.items.map(it => {
                      const ei = expiryInfo(it.expiry);
                      return `
                      <div class="text-center">
                        <div class="aspect-square rounded-xl overflow-hidden bg-slate-100 shadow-sm relative">
                          ${it.image ? `<img src="${blobURL(it.image, 'item-' + it.id)}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full flex items-center justify-center text-2xl">📦</div>`}
                          ${ei && (ei.level === 'expired' || ei.level === 'soon') ? `<span class="absolute top-1 left-1 px-1 py-0.5 rounded text-[9px] leading-none ${ei.cls} border" title="${ei.label}">⏰</span>` : ''}
                        </div>
                        <div class="mt-0.5 text-xs font-medium truncate leading-tight">${esc(it.name)}</div>
                        ${it.qty > 1 ? `<div class="text-xs text-ink-500">×${it.qty}</div>` : ''}
                        ${ei ? `<div class="mt-0.5 ${ei.level === 'expired' ? 'text-red-600' : ei.level === 'soon' ? 'text-orange-600' : 'text-ink-500'} text-[10px] leading-tight truncate" title="${ei.label}">⏰ ${ei.label}</div>` : ''}
                      </div>
                    `;}).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      `).join('')}
    </div>
  `;

  $('#__goto')?.addEventListener('click', () => go('rooms'));
  $$('.room-link').forEach(b => b.onclick = () => go({ name: 'room', id: b.dataset.id }));
  $$('.cab-link').forEach(b => b.onclick = () => go({ name: 'photo', id: b.dataset.photo }));
}

/* ================================================================
 * 页面：📥 待处理（顶部 scene）
 * 两段内容：
 *   ① AI 识别未归位的物品（按房间分组）
 *   ② 系统自动生成的提醒事件（过期/开封/保修/库存/换季/久未动）
 * ================================================================ */
const REMINDER_KIND_LABEL = {
  expiry:       '保质期',
  opened:       '开封后',
  warranty:     '保修',
  lowstock:     '库存',
  seasonal:     '换季',
  dust:         '久未动',
  subscription: '订阅扣款',
};
REMINDER_ICONS.subscription = '💳';

async function renderInbox(app) {
  const [rooms, cabinets, allItems, allSubs] = await Promise.all([
    db.all('rooms'), db.all('cabinets'), db.all('items'), db.all('subscriptions').catch(() => []),
  ]);
  const pending = allItems.filter(i => i.status === 'pending');
  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]));
  const cabMap = Object.fromEntries(cabinets.map(c => [c.id, c]));
  const itemMap = Object.fromEntries(allItems.map(i => [i.id, i]));
  const subMap = Object.fromEntries((allSubs || []).map(s => [s.id, s]));
  const events = [...computeReminderEvents(allItems), ...computeSubscriptionEvents(allSubs || [])]
    .sort((a, b) => {
      const order = { critical: 0, warn: 1, info: 2 };
      if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
      return a.daysLeft - b.daysLeft;
    });

  // 按房间分组 pending
  const pendingGroups = {};
  pending.forEach(it => {
    const rid = it.roomId || '__global__';
    pendingGroups[rid] = pendingGroups[rid] || [];
    pendingGroups[rid].push(it);
  });

  // 按事件类型分组
  const eventGroups = {};
  events.forEach(ev => {
    eventGroups[ev.kind] = eventGroups[ev.kind] || [];
    eventGroups[ev.kind].push(ev);
  });

  const criticalCount = events.filter(e => e.level === 'critical').length;
  const totalTodos = pending.length + events.length;

  app.innerHTML = `
    ${header({
      title: '📥 待处理',
      subtitle: totalTodos === 0
        ? '一切井井有条'
        : `${pending.length} 件未归位 · ${events.length} 条提醒${criticalCount > 0 ? ` · ${criticalCount} 条紧急` : ''}`,
    })}

    <div class="px-4 md:px-6 py-4 space-y-6">
      ${totalTodos === 0 ? `
        <div class="text-center py-16 bg-white rounded-2xl shadow-soft">
          <div class="text-6xl mb-3">🎉</div>
          <p class="text-ink-700 font-medium mb-1">一切井井有条</p>
          <p class="text-sm text-ink-500">没有待归位物品，也没有临近提醒。</p>
        </div>
      ` : ''}

      ${pending.length > 0 ? `
        <section>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-bold text-ink-900 flex items-center gap-2">
              <span class="text-lg">✨</span> AI 识别待归位
              <span class="chip">${pending.length}</span>
            </h2>
          </div>
          ${Object.keys(pendingGroups).map(rid => {
            const room = roomMap[rid];
            const label = room ? `${room.icon || '🏠'} ${room.name}` : '📦 全屋自由区（未分类）';
            const list = pendingGroups[rid];
            return `
              <div class="mb-4">
                <div class="text-xs text-ink-500 mb-2">${esc(label)}</div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                  ${list.map(it => {
                    const ei = expiryInfo(it.expiry);
                    return `
                    <button class="inbox-card text-left bg-white rounded-2xl shadow-soft hover:shadow-lg transition overflow-hidden" data-iid="${it.id}">
                      <div class="aspect-square bg-slate-100 relative">
                        ${it.image ? `<img src="${blobURL(it.image, 'item-' + it.id)}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full flex items-center justify-center text-4xl">${it.aiEmoji || '📦'}</div>`}
                        ${ei && (ei.level === 'expired' || ei.level === 'soon') ? `<span class="absolute top-1 left-1 px-1 py-0.5 rounded text-[10px] leading-none ${ei.cls} border" title="${ei.label}">⏰</span>` : ''}
                      </div>
                      <div class="p-2">
                        <div class="text-sm font-medium text-ink-900 truncate">${esc(it.name)}</div>
                        <div class="text-xs text-ink-500 mt-0.5">✨ AI 识别</div>
                        ${ei ? `<div class="mt-1">${ei.badge}</div>` : ''}
                      </div>
                    </button>
                  `;}).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </section>
      ` : ''}

      ${events.length > 0 ? `
        <section>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-bold text-ink-900 flex items-center gap-2">
              <span class="text-lg">⏰</span> 提醒事件
              <span class="chip">${events.length}</span>
              ${criticalCount > 0 ? `<span class="chip" style="background:#fee2e2;color:#991b1b">${criticalCount} 紧急</span>` : ''}
            </h2>
          </div>
          ${Object.keys(eventGroups).map(kind => {
            const list = eventGroups[kind];
            return `
              <div class="mb-4 bg-white rounded-2xl shadow-soft overflow-hidden">
                <div class="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                  <span>${REMINDER_ICONS[kind] || '•'}</span>
                  <span class="text-sm font-semibold text-ink-900">${REMINDER_KIND_LABEL[kind] || kind}</span>
                  <span class="chip">${list.length}</span>
                </div>
                <div class="divide-y divide-slate-100">
                  ${list.map(ev => {
                    const levelCls = ev.level === 'critical'
                      ? 'bg-red-100 text-red-700 border-red-200'
                      : ev.level === 'warn'
                        ? 'bg-orange-100 text-orange-700 border-orange-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200';
                    // 订阅事件
                    if (ev.kind === 'subscription') {
                      const sub = subMap[ev.subId];
                      if (!sub) return '';
                      const cat = SUB_CATEGORIES.find(c => c.id === sub.category) || { name: '其他', emoji: '📌' };
                      return `
                        <button class="sub-event-row w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left" data-sid="${ev.subId}">
                          <div class="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style="background:${subColorBg(sub.name)}">${esc(sub.icon || cat.emoji)}</div>
                          <div class="flex-1 min-w-0">
                            <div class="text-sm font-medium text-ink-900 truncate">${esc(ev.title)}</div>
                            <div class="text-xs text-ink-500 truncate">${cat.emoji} ${esc(cat.name)}${sub.paymentMethod ? ` · ${esc(sub.paymentMethod)}` : ''}</div>
                          </div>
                          <div class="text-right flex-shrink-0">
                            <span class="inline-block px-2 py-0.5 rounded border text-[10px] leading-tight ${levelCls}">${esc(ev.subtitle)}</span>
                          </div>
                        </button>
                      `;
                    }
                    // 物品事件
                    const it = itemMap[ev.itemId];
                    if (!it) return '';
                    const cab = cabMap[it.cabinetId];
                    const room = cab ? roomMap[cab.roomId] : null;
                    const location = room
                      ? `${room.icon || '🏠'} ${esc(room.name)}${cab && !isLooseCabinet(cab) ? ` › 🗄️ ${esc(cab.name)}` : ''}`
                      : (it.roomId === '__global__' ? '📦 全屋自由区' : '—');
                    return `
                      <button class="event-row w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left" data-iid="${ev.itemId}">
                        <div class="w-10 h-10 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                          ${it.image ? `<img src="${blobURL(it.image, 'ev-' + it.id)}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full flex items-center justify-center text-xl">${it.aiEmoji || '📦'}</div>`}
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="text-sm font-medium text-ink-900 truncate">${esc(ev.title)}</div>
                          <div class="text-xs text-ink-500 truncate">${esc(location)}</div>
                        </div>
                        <div class="text-right flex-shrink-0">
                          <span class="inline-block px-2 py-0.5 rounded border text-[10px] leading-tight ${levelCls}">${esc(ev.subtitle)}</span>
                        </div>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </section>
      ` : ''}
    </div>
  `;

  $('.inbox-card').forEach(b => {
    b.onclick = () => {
      const item = pending.find(x => x.id === b.dataset.iid);
      if (item) openItemProcessDialog(item);
    };
  });
  $('.event-row').forEach(b => {
    b.onclick = async () => {
      const item = await db.get('items', b.dataset.iid);
      if (item) openItemProcessDialog(item);
    };
  });
  $('.sub-event-row').forEach(b => {
    b.onclick = async () => {
      const sub = await db.get('subscriptions', b.dataset.sid);
      if (sub) openSubscriptionDialog(sub);
    };
  });
}

/* ---------- 自由区物品列表弹窗（房间级或全屋级） ---------- */
async function openLooseListDialog(cab, room) {
  const items = (await db.byIndex('items', 'cabinetId', cab.id));
  items.sort((a, b) => {
    // pending 靠前，然后按时间倒序
    if ((a.status === 'pending') !== (b.status === 'pending')) {
      return a.status === 'pending' ? -1 : 1;
    }
    return b.createdAt - a.createdAt;
  });

  const title = cab.type === 'loose-global' ? '📦 全屋自由区' : `📥 ${room?.name || ''} · 自由物品收纳处`;

  const m = modal(`
    <div class="p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="text-base font-semibold text-ink-900">${esc(title)}</h3>
          <p class="text-xs text-ink-500 mt-1">${items.length} 件物品${items.filter(i => i.status === 'pending').length > 0 ? ` · ${items.filter(i => i.status === 'pending').length} 件待处理` : ''}</p>
        </div>
      </div>
      ${items.length === 0 ? `
        <div class="text-center py-8 text-ink-500 text-sm">还没有物品</div>
      ` : `
        <div class="grid grid-cols-3 md:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto">
          ${items.map(it => {
            const ei = expiryInfo(it.expiry);
            return `
            <button class="loose-item text-left bg-slate-50 hover:bg-brand-50 rounded-xl overflow-hidden transition" data-iid="${it.id}">
              <div class="aspect-square bg-white relative">
                ${it.image ? `<img src="${blobURL(it.image, 'lo-' + it.id)}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full flex items-center justify-center text-3xl">${it.aiEmoji || '📦'}</div>`}
                ${ei && (ei.level === 'expired' || ei.level === 'soon') ? `<span class="absolute top-1 left-1 px-1 py-0.5 rounded text-[9px] leading-none ${ei.cls} border" title="${ei.label}">⏰</span>` : ''}
              </div>
              <div class="p-2">
                <div class="text-xs font-medium text-ink-900 truncate">${esc(it.name)}</div>
                ${it.status === 'pending' ? `<div class="text-[10px] text-amber-600 mt-0.5">✨ 待处理</div>` : `<div class="text-[10px] text-ink-500 mt-0.5">已归位</div>`}
                ${ei ? `<div class="mt-0.5 ${ei.level === 'expired' ? 'text-red-600' : ei.level === 'soon' ? 'text-orange-600' : 'text-ink-500'} text-[10px] leading-tight truncate" title="${ei.label}">⏰ ${ei.label}</div>` : ''}
              </div>
            </button>
          `;}).join('')}
        </div>
      `}
    </div>
  `);

  m.root.querySelectorAll('.loose-item').forEach(b => {
    b.onclick = () => {
      const it = items.find(x => x.id === b.dataset.iid);
      if (it) { m.close(); openItemProcessDialog(it); }
    };
  });
}


async function openItemProcessDialog(item) {
  const [rooms, cabinets, photos] = await Promise.all([
    db.all('rooms'), db.all('cabinets'), db.all('photos')
  ]);
  const sourcePhoto = item.sourcePhotoId ? photos.find(p => p.id === item.sourcePhotoId) : null;

  // 当前 item 所属房间（可能是 __global__）
  const currentRoomId = item.roomId && rooms.find(r => r.id === item.roomId) ? item.roomId : '__global__';

  const m = modal(`
    <div class="p-5 space-y-4">
      <div class="flex items-start gap-3">
        <div class="w-24 h-24 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
          ${item.image ? `<img id="ip-img" src="${blobURL(item.image, 'ip-' + item.id)}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full flex items-center justify-center text-4xl">${item.aiEmoji || '📦'}</div>`}
        </div>
        <div class="flex-1 min-w-0">
          <input id="ip-name" type="text" value="${esc(item.name)}" class="w-full text-base font-semibold bg-transparent border-b border-slate-200 focus:border-brand-500 outline-none py-1"/>
          <div class="flex items-center gap-2 mt-2">
            <label class="text-xs text-ink-500">数量</label>
            <input id="ip-qty" type="number" min="1" value="${item.qty || 1}" class="w-16 h-8 px-2 rounded-lg bg-slate-50 border border-transparent focus:border-brand-500 outline-none text-sm text-center"/>
          </div>
          <label class="inline-block mt-2">
            <input id="ip-photo" type="file" accept="image/*" class="hidden"/>
            <span class="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 cursor-pointer">
              📷 替换配图
            </span>
          </label>
        </div>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-500">备注</label>
        <input id="ip-note" type="text" value="${esc(item.note || '')}" placeholder="备注（可选）" class="w-full mt-1 h-9 px-3 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm"/>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-500">⏰ 保质期 <span class="text-ink-400 font-normal">（食品/药品适用，可留空）</span></label>
        <div class="flex gap-2 items-center mt-1">
          <input id="ip-expiry" type="date" value="${esc(item.expiry || '')}" class="flex-1 h-9 px-3 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm"/>
          ${item.expiry ? `<button type="button" id="ip-expiry-clear" class="text-xs text-ink-500 hover:text-red-600">清除</button>` : ''}
        </div>
        ${(() => { const ei = expiryInfo(item.expiry); return ei ? `<div class="mt-1">${ei.badge}</div>` : ''; })()}
      </div>

      <!-- 标签 -->
      <div>
        <label class="text-xs font-medium text-ink-500">🏷️ 标签</label>
        <div id="ip-tags-row" class="mt-1 flex flex-wrap gap-1.5">
          ${PRESET_TAGS.map(t => {
            const on = (item.tags || []).includes(t.name);
            return `<button type="button" data-tag="${esc(t.name)}" class="tag-btn h-7 px-2.5 rounded-full text-xs border ${on ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-700 border-slate-200 hover:border-brand-500'}">${t.emoji} ${esc(t.name)}</button>`;
          }).join('')}
          <input id="ip-tag-custom" type="text" placeholder="+ 自定义" class="h-7 px-2.5 rounded-full text-xs border border-dashed border-slate-300 focus:border-brand-500 outline-none w-20 focus:w-28 transition-all"/>
        </div>
        <div id="ip-custom-tags" class="mt-1.5 flex flex-wrap gap-1.5">
          ${(item.tags || []).filter(t => !PRESET_TAGS.find(p => p.name === t)).map(t =>
            `<span class="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs" data-custom="${esc(t)}">${esc(t)}<button type="button" class="rm-custom hover:text-red-600">×</button></span>`
          ).join('')}
        </div>
      </div>

      <!-- 更多属性（折叠） -->
      <details class="bg-slate-50 rounded-xl overflow-hidden" ${hasExtendedProps(item) ? 'open' : ''}>
        <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-ink-700 hover:bg-slate-100">⚡ 更多属性 <span class="text-ink-400 font-normal">（可选，按需填写以启用提醒）</span></summary>
        <div class="px-3 pb-3 pt-1 space-y-3">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-[11px] text-ink-500">🧃 开封日期</label>
              <input id="ip-opened" type="date" value="${esc(item.openedAt || '')}" class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
            </div>
            <div>
              <label class="text-[11px] text-ink-500">开封后可用(天)</label>
              <input id="ip-opened-days" type="number" min="1" value="${esc(item.openedShelfDays ?? '')}" placeholder="如 30" class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-[11px] text-ink-500">🛡️ 购买日期</label>
              <input id="ip-purchased" type="date" value="${esc(item.purchasedAt || '')}" class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
            </div>
            <div>
              <label class="text-[11px] text-ink-500">保修(月)</label>
              <input id="ip-warranty" type="number" min="1" value="${esc(item.warrantyMonths ?? '')}" placeholder="如 12" class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-[11px] text-ink-500">📉 库存下限</label>
              <input id="ip-minstock" type="number" min="0" value="${esc(item.minStock ?? '')}" placeholder="低于此数字提醒" class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
            </div>
            <div>
              <label class="text-[11px] text-ink-500">🗓️ 季节属性</label>
              <select id="ip-season" class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs">
                <option value="" ${!item.season ? 'selected' : ''}>— 无 —</option>
                <option value="spring" ${item.season === 'spring' ? 'selected' : ''}>🌸 春</option>
                <option value="summer" ${item.season === 'summer' ? 'selected' : ''}>☀️ 夏</option>
                <option value="autumn" ${item.season === 'autumn' ? 'selected' : ''}>🍂 秋</option>
                <option value="winter" ${item.season === 'winter' ? 'selected' : ''}>❄️ 冬</option>
              </select>
            </div>
          </div>
        </div>
      </details>

      <div class="bg-brand-50 rounded-xl p-3 space-y-2">
        <div class="text-xs font-semibold text-brand-700">放到哪里</div>
        <div class="flex gap-2">
          <select id="ip-room" class="flex-1 h-10 px-3 rounded-lg bg-white border border-slate-200 text-sm">
            ${rooms.map(r => `<option value="${r.id}" ${r.id === currentRoomId ? 'selected' : ''}>${r.icon || '🏠'} ${esc(r.name)}</option>`).join('')}
            <option value="__global__" ${currentRoomId === '__global__' ? 'selected' : ''}>📦 全屋自由区</option>
          </select>
          <select id="ip-cab" class="flex-1 h-10 px-3 rounded-lg bg-white border border-slate-200 text-sm"></select>
        </div>
        ${sourcePhoto ? `
          <details class="text-xs text-ink-500 mt-2">
            <summary class="cursor-pointer hover:text-ink-700">📷 查看来源照片位置</summary>
            <div class="mt-2 relative inline-block">
              <img src="${blobURL(sourcePhoto.blob, sourcePhoto.id)}" class="max-w-full max-h-48 rounded-lg"/>
              ${item.aiRect ? `<div class="absolute border-2 border-amber-500 bg-amber-500/20 rounded" style="left:${item.aiRect.x*100}%;top:${item.aiRect.y*100}%;width:${item.aiRect.w*100}%;height:${item.aiRect.h*100}%;"></div>` : ''}
            </div>
          </details>
        ` : ''}
      </div>

      <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <button id="ip-del" class="text-red-500 text-xs hover:text-red-700">🗑️ 删除这个物品</button>
        <div class="flex gap-2">
          <button id="ip-cancel" class="h-9 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm">取消</button>
          <button id="ip-save" class="h-9 px-5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium shadow-soft">保存并归位</button>
        </div>
      </div>
    </div>
  `);

  const roomSel = m.root.querySelector('#ip-room');
  const cabSel = m.root.querySelector('#ip-cab');
  const nameEl = m.root.querySelector('#ip-name');
  const qtyEl = m.root.querySelector('#ip-qty');
  const noteEl = m.root.querySelector('#ip-note');
  const imgEl = m.root.querySelector('#ip-img');
  const photoInput = m.root.querySelector('#ip-photo');

  // 新图（如果用户替换配图，先缓存）
  let newImage = null;

  photoInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    toast('处理图片中…');
    const { blob } = await compressImage(file, 400, 0.82);
    newImage = blob;
    if (imgEl) {
      imgEl.src = blobURL(blob, 'ip-new');
    }
    toast('配图已替换');
  });

  // 柜子下拉联动：选房间时更新柜子列表
  const refreshCabOptions = async () => {
    const rid = roomSel.value;
    let options = '';
    if (rid === '__global__') {
      // 全屋自由区，柜子选项只有"全屋自由区"
      await ensureGlobalLooseCabinet();
      options = `<option value="__global_loose__">📦 保留在全屋自由区</option>`;
    } else {
      // 该房间的所有 normal 柜子 + 房间自由区
      const cabs = cabinets.filter(c => c.roomId === rid);
      const normal = cabs.filter(c => c.type === 'normal' || !c.type);
      normal.sort((a, b) => a.name.localeCompare(b.name));
      const looseOpt = `<option value="__room_loose__">📥 留在此房间的自由区</option>`;
      options = normal.map(c => `<option value="${c.id}" ${c.id === item.cabinetId ? 'selected' : ''}>🗄️ ${esc(c.name)}</option>`).join('') + looseOpt;
    }
    cabSel.innerHTML = options;

    // 如果当前 item.cabinetId 对应的柜子属于"该房间的自由区"，默认选中 __room_loose__
    const currentCab = cabinets.find(c => c.id === item.cabinetId);
    if (currentCab && isLooseCabinet(currentCab)) {
      if (currentCab.type === 'loose-global') cabSel.value = '__global_loose__';
      else cabSel.value = '__room_loose__';
    }
  };
  roomSel.addEventListener('change', refreshCabOptions);
  await refreshCabOptions();

  m.root.querySelector('#ip-cancel').onclick = () => m.close();

  m.root.querySelector('#ip-del').onclick = async () => {
    if (!confirm('确认删除这个物品？')) return;
    await db.del('items', item.id);
    toast('已删除');
    m.close();
    render();
  };

  // 清除保质期按钮（如果存在）
  const expiryEl = m.root.querySelector('#ip-expiry');
  m.root.querySelector('#ip-expiry-clear')?.addEventListener('click', () => {
    if (expiryEl) expiryEl.value = '';
  });

  // —— 标签交互：选中/取消预设标签 + 自定义标签 ——
  let currentTags = [...(item.tags || [])];
  const tagsRow = m.root.querySelector('#ip-tags-row');
  const customWrap = m.root.querySelector('#ip-custom-tags');
  const refreshTagBtns = () => {
    tagsRow.querySelectorAll('.tag-btn').forEach(b => {
      const on = currentTags.includes(b.dataset.tag);
      b.className = `tag-btn h-7 px-2.5 rounded-full text-xs border ${on ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-700 border-slate-200 hover:border-brand-500'}`;
    });
  };
  const refreshCustomTags = () => {
    const customs = currentTags.filter(t => !PRESET_TAGS.find(p => p.name === t));
    customWrap.innerHTML = customs.map(t =>
      `<span class="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs" data-custom="${esc(t)}">${esc(t)}<button type="button" class="rm-custom hover:text-red-600">×</button></span>`
    ).join('');
    customWrap.querySelectorAll('.rm-custom').forEach(btn => {
      btn.onclick = () => {
        const name = btn.closest('[data-custom]').dataset.custom;
        currentTags = currentTags.filter(t => t !== name);
        refreshCustomTags();
      };
    });
  };
  tagsRow.querySelectorAll('.tag-btn').forEach(b => {
    b.onclick = () => {
      const name = b.dataset.tag;
      if (currentTags.includes(name)) currentTags = currentTags.filter(t => t !== name);
      else currentTags.push(name);
      refreshTagBtns();
    };
  });
  const customInput = m.root.querySelector('#ip-tag-custom');
  customInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      const v = customInput.value.trim().replace(/[,，]/g, '');
      if (v && !currentTags.includes(v)) {
        currentTags.push(v);
        refreshCustomTags();
      }
      customInput.value = '';
    }
  });
  refreshCustomTags();

  m.root.querySelector('#ip-save').onclick = async () => {
    const name = nameEl.value.trim();
    if (!name) { toast('请填物品名'); return; }
    const qty = parseInt(qtyEl.value) || 1;
    const note = noteEl.value.trim();
    const expiry = expiryEl?.value || '';
    const rid = roomSel.value;
    const cabChoice = cabSel.value;

    // 扩展字段
    const openedAt       = m.root.querySelector('#ip-opened')?.value || '';
    const openedShelfDaysRaw = m.root.querySelector('#ip-opened-days')?.value || '';
    const openedShelfDays = openedShelfDaysRaw ? (+openedShelfDaysRaw) : null;
    const purchasedAt    = m.root.querySelector('#ip-purchased')?.value || '';
    const warrantyRaw    = m.root.querySelector('#ip-warranty')?.value || '';
    const warrantyMonths = warrantyRaw ? (+warrantyRaw) : null;
    const minStockRaw    = m.root.querySelector('#ip-minstock')?.value || '';
    const minStock       = minStockRaw !== '' ? (+minStockRaw) : null;
    const season         = m.root.querySelector('#ip-season')?.value || '';

    let targetCab;
    if (cabChoice === '__global_loose__') {
      targetCab = await ensureGlobalLooseCabinet();
    } else if (cabChoice === '__room_loose__') {
      targetCab = await ensureLooseCabinet(rid);
    } else {
      targetCab = cabinets.find(c => c.id === cabChoice);
    }
    if (!targetCab) { toast('请选择目的地'); return; }

    const updated = {
      ...item,
      name,
      qty,
      note,
      expiry,
      tags: currentTags,
      openedAt,
      openedShelfDays,
      purchasedAt,
      warrantyMonths,
      minStock,
      season,
      cabinetId: targetCab.id,
      roomId: targetCab.roomId === '__global__' ? '__global__' : targetCab.roomId,
      status: 'placed',
      image: newImage || item.image,
      lastTouchedAt: Date.now(),
    };
    await db.put('items', updated);
    toast('已归位');
    m.close();
    render();
  };
}

/* ================================================================
 * 页面：搜索
 * ================================================================ */
async function renderSearch(app) {
  const [rooms, cabinets, items, photos] = await Promise.all([
    db.all('rooms'), db.all('cabinets'), db.all('items'), db.all('photos')
  ]);
  const cabMap = Object.fromEntries(cabinets.map(c => [c.id, c]));
  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]));

  app.innerHTML = `
    ${header({ title: '搜索物品', subtitle: `在 ${items.length} 件物品中查找` })}
    <div class="px-4 md:px-6 py-4">
      <div class="relative mb-4">
        <input id="q" type="search" placeholder="搜物品名、备注，如「吸尘器」「螺丝刀」"
          class="w-full h-12 pl-11 pr-4 rounded-2xl bg-white border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none text-sm shadow-soft" autofocus/>
        <svg class="absolute left-4 top-1/2 -translate-y-1/2 text-ink-500" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </div>
      <div id="results" class="space-y-2"></div>
    </div>
  `;

  const renderResults = (q) => {
    const res = $('#results');
    if (!q) {
      res.innerHTML = `<p class="text-sm text-ink-500 text-center py-8">输入关键词开始搜索</p>`;
      return;
    }
    const ql = q.toLowerCase();
    const matched = items.filter(i =>
      i.name.toLowerCase().includes(ql) ||
      (i.note && i.note.toLowerCase().includes(ql))
    );
    if (matched.length === 0) {
      res.innerHTML = `<p class="text-sm text-ink-500 text-center py-8">没有找到「${esc(q)}」相关的物品</p>`;
      return;
    }
    res.innerHTML = matched.map(it => {
      const cab = cabMap[it.cabinetId];
      const room = cab ? roomMap[cab.roomId] : null;
      const ei = expiryInfo(it.expiry);
      return `
        <button class="result w-full bg-white rounded-xl shadow-soft hover:shadow-lg transition p-3 flex items-center gap-3 text-left" data-photo="${cab?.photoId || ''}">
          <div class="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
            ${it.image ? `<img src="${blobURL(it.image, 'item-' + it.id)}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full flex items-center justify-center text-2xl">📦</div>`}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm text-ink-900 truncate">${esc(it.name)}${it.qty > 1 ? ` <span class="text-ink-500 text-xs">×${it.qty}</span>` : ''}</div>
            <div class="text-xs text-ink-500 truncate">
              ${room ? `${room.icon || '🏠'} ${esc(room.name)} › 🗄️ ${esc(cab.name)}` : '（柜子已删除）'}
            </div>
            ${it.note ? `<div class="text-xs text-ink-500 mt-0.5 truncate">💭 ${esc(it.note)}</div>` : ''}
            ${ei ? `<div class="mt-1">${ei.badge}</div>` : ''}
          </div>
          <svg class="text-ink-300" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      `;
    }).join('');
    res.querySelectorAll('.result').forEach(b => b.onclick = () => {
      const pid = b.dataset.photo; if (pid) go({ name: 'photo', id: pid });
    });
  };

  renderResults('');
  $('#q').addEventListener('input', e => renderResults(e.target.value.trim()));
}

/* ================================================================
 * 页面：📊 总览（顶部 scene）
 * 给出全局快照：房间/柜子/物品/紧急提醒数 + 标签分布 + 最近新增
 * ================================================================ */
async function renderOverview(app) {
  const [rooms, cabinets, items, subs] = await Promise.all([
    db.all('rooms'), db.all('cabinets'), db.all('items'), db.all('subscriptions').catch(() => []),
  ]);
  const placed = items.filter(i => i.status !== 'pending');
  const pending = items.filter(i => i.status === 'pending');
  const events = computeReminderEvents(items);
  const subEvents = computeSubscriptionEvents(subs || []);
  const allEvents = [...events, ...subEvents].sort((a, b) => a.daysLeft - b.daysLeft);
  const criticalCount = allEvents.filter(e => e.level === 'critical').length;
  const warnCount     = allEvents.filter(e => e.level === 'warn').length;
  const totalQty = items.reduce((s, i) => s + (i.qty || 1), 0);

  // 标签分布
  const tagCount = {};
  placed.forEach(i => (i.tags || []).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  const tagList = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const tagMax = tagList[0]?.[1] || 1;

  // 最近新增
  const recent = [...placed].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8);

  // 订阅概览
  const activeSubs = (subs || []).filter(s => s.status !== 'cancelled');
  const monthlyCost = activeSubs.reduce((s, x) => s + subscriptionMonthlyCost(x), 0);

  app.innerHTML = `
    ${header({
      title: '📊 总览',
      subtitle: `${rooms.length} 房间 · ${cabinets.filter(c => !isLooseCabinet(c)).length} 柜子 · ${items.length} 物品`,
    })}
    <div class="px-4 md:px-6 py-4 space-y-5">

      <!-- 概览卡片 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${[
          { label: '物品总数', value: items.length, sub: `共 ${totalQty} 件`, color: 'from-blue-50 to-indigo-50', accent: 'text-indigo-700' },
          { label: '紧急提醒', value: criticalCount, sub: `${warnCount} 条临近`, color: 'from-red-50 to-orange-50', accent: 'text-red-600' },
          { label: '待归位', value: pending.length, sub: pending.length ? 'AI 识别项' : '全部完成', color: 'from-amber-50 to-yellow-50', accent: 'text-amber-700' },
          { label: '月度订阅', value: `¥${monthlyCost.toFixed(0)}`, sub: `${activeSubs.length} 项`, color: 'from-emerald-50 to-teal-50', accent: 'text-emerald-700' },
        ].map(c => `
          <div class="bg-gradient-to-br ${c.color} rounded-2xl p-4 shadow-soft">
            <div class="text-xs text-ink-500">${c.label}</div>
            <div class="text-2xl font-bold ${c.accent} mt-1">${c.value}</div>
            <div class="text-xs text-ink-500 mt-0.5">${c.sub}</div>
          </div>
        `).join('')}
      </div>

      <!-- 标签分布 -->
      ${tagList.length > 0 ? `
        <section class="bg-white rounded-2xl shadow-soft p-4">
          <h3 class="text-sm font-semibold text-ink-900 mb-3">🏷️ 标签分布</h3>
          <div class="space-y-2">
            ${tagList.map(([t, n]) => {
              const preset = PRESET_TAGS.find(p => p.name === t);
              const emoji = preset?.emoji || '•';
              const pct = Math.round((n / tagMax) * 100);
              return `
                <div class="flex items-center gap-3">
                  <div class="w-20 text-xs text-ink-700 truncate">${emoji} ${esc(t)}</div>
                  <div class="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div class="h-full bg-brand-500 rounded-full" style="width:${pct}%"></div>
                  </div>
                  <div class="w-10 text-xs text-ink-500 text-right">${n}</div>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      ` : `
        <section class="bg-white rounded-2xl shadow-soft p-6 text-center text-sm text-ink-500">
          还没有打任何标签 · 在物品详情里给物品打标签后这里会统计分布
        </section>
      `}

      <!-- 按房间分布 -->
      <section class="bg-white rounded-2xl shadow-soft p-4">
        <h3 class="text-sm font-semibold text-ink-900 mb-3">🏠 各房间物品数</h3>
        <div class="space-y-2">
          ${(() => {
            const roomCounts = rooms.map(r => ({ r, n: placed.filter(i => i.roomId === r.id).length }));
            const globalN = placed.filter(i => i.roomId === '__global__').length;
            if (globalN) roomCounts.push({ r: { id: '__global__', name: '全屋自由区', icon: '📦' }, n: globalN });
            roomCounts.sort((a, b) => b.n - a.n);
            const max = roomCounts[0]?.n || 1;
            return roomCounts.map(({ r, n }) => `
              <button class="overview-room w-full flex items-center gap-3 text-left hover:bg-slate-50 rounded-lg p-1.5 -mx-1.5" data-id="${r.id}">
                <div class="w-24 text-xs text-ink-700 truncate">${r.icon || '🏠'} ${esc(r.name)}</div>
                <div class="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div class="h-full bg-emerald-500 rounded-full" style="width:${Math.round((n / max) * 100)}%"></div>
                </div>
                <div class="w-10 text-xs text-ink-500 text-right">${n}</div>
              </button>
            `).join('');
          })()}
        </div>
      </section>

      <!-- 最近新增 -->
      <section class="bg-white rounded-2xl shadow-soft p-4">
        <h3 class="text-sm font-semibold text-ink-900 mb-3">🕒 最近新增</h3>
        ${recent.length === 0 ? `<p class="text-sm text-ink-500 py-4 text-center">还没有物品</p>` : `
          <div class="grid grid-cols-4 md:grid-cols-8 gap-2">
            ${recent.map(it => `
              <div class="text-center">
                <div class="aspect-square rounded-xl overflow-hidden bg-slate-100 shadow-sm">
                  ${it.image ? `<img src="${blobURL(it.image, 'ov-' + it.id)}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full flex items-center justify-center text-2xl">📦</div>`}
                </div>
                <div class="mt-1 text-xs truncate" title="${esc(it.name)}">${esc(it.name)}</div>
              </div>
            `).join('')}
          </div>
        `}
      </section>
    </div>
  `;

  $('.overview-room').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.id;
      if (id === '__global__') {
        goScene('storage');
        go('rooms');
      } else {
        go({ name: 'room', id });
      }
    };
  });
}

/* ================================================================
 * 页面：🔔 订阅（定期账单）—— 顶部 scene
 * 管理软件订阅、贷款、水电煤、保险、会员等定期付款项。
 * 掉款提醒 computeSubscriptionEvents 汇入待处理页。
 * ================================================================ */
const SUB_CATEGORIES = [
  { id: 'software', name: '软件',   emoji: '💻' },
  { id: 'loan',     name: '贷款',   emoji: '🏦' },
  { id: 'utility',  name: '水电煤', emoji: '💡' },
  { id: 'rent',     name: '房租',   emoji: '🏠' },
  { id: 'membership', name: '会员', emoji: '🎫' },
  { id: 'insurance',name: '保险',   emoji: '🛟' },
  { id: 'telecom',  name: '通讯',   emoji: '📱' },
  { id: 'other',    name: '其他',   emoji: '📌' },
];

const SUB_CYCLES = [
  { id: 'weekly',    name: '每周',   days: 7 },
  { id: 'monthly',   name: '每月',   days: 30 },
  { id: 'quarterly', name: '每季',   days: 91 },
  { id: 'yearly',    name: '每年',   days: 365 },
];

function subscriptionCycleDays(sub) {
  const preset = SUB_CYCLES.find(c => c.id === sub.cycle);
  if (preset) return preset.days;
  if (sub.cycle === 'custom' && +sub.cycleDays > 0) return +sub.cycleDays;
  return 30;
}

function subscriptionMonthlyCost(sub) {
  const amount = +sub.amount || 0;
  const days = subscriptionCycleDays(sub);
  return amount * 30 / days;
}

/* 推进下次扣款日期（按 cycle 累加直到 > today） */
function advanceSubDue(sub) {
  if (!sub.nextDueAt) return sub;
  const days = subscriptionCycleDays(sub);
  let d = new Date(sub.nextDueAt + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  while (d.getTime() <= today.getTime()) {
    d = new Date(d.getTime() + days * 24 * 3600 * 1000);
  }
  return { ...sub, nextDueAt: d.toISOString().slice(0, 10) };
}

/* 订阅 → 提醒事件（汇入待处理） */
function computeSubscriptionEvents(subs) {
  const events = [];
  const now = Date.now();
  for (const sub of subs) {
    if (sub.status === 'cancelled' || sub.status === 'paused') continue;
    if (!sub.nextDueAt) continue;
    const dueMs = new Date(sub.nextDueAt + 'T23:59:59').getTime();
    if (isNaN(dueMs)) continue;
    const remain = Math.ceil((dueMs - now) / (24 * 3600 * 1000));
    if (remain > 14) continue;
    let level = 'info';
    if (remain < 0)       level = 'critical'; // 已逾期
    else if (remain <= 3) level = 'critical';
    else if (remain <= 7) level = 'warn';
    const amount = sub.amount ? `¥${(+sub.amount).toFixed(2)}` : '';
    events.push({
      kind: 'subscription',
      level,
      subId: sub.id,
      title: sub.name,
      subtitle: remain < 0
        ? `已逾期 ${-remain} 天${amount ? ` · ${amount}` : ''}`
        : remain === 0 ? `今天扣款${amount ? ` · ${amount}` : ''}`
        : `${remain} 天后扣款${amount ? ` · ${amount}` : ''}`,
      daysLeft: remain,
      icon: '💳',
    });
  }
  return events;
}

async function renderSubscribe(app) {
  const subs = await db.all('subscriptions');
  const active = subs.filter(s => s.status !== 'cancelled');
  const paused = subs.filter(s => s.status === 'paused');
  const normal = subs.filter(s => s.status !== 'cancelled' && s.status !== 'paused');
  normal.sort((a, b) => {
    const ad = a.nextDueAt || '9999-12-31';
    const bd = b.nextDueAt || '9999-12-31';
    return ad.localeCompare(bd);
  });

  const monthly = active.reduce((s, x) => s + subscriptionMonthlyCost(x), 0);
  const yearly = monthly * 12;

  // 按分类分组
  const byCategory = {};
  active.forEach(s => {
    const c = s.category || 'other';
    byCategory[c] = (byCategory[c] || 0) + subscriptionMonthlyCost(s);
  });

  app.innerHTML = `
    ${header({
      title: '🔔 订阅',
      subtitle: subs.length === 0 ? '管理软件订阅 / 贷款 / 水电等定期账单' : `${active.length} 项生效 · 月均 ¥${monthly.toFixed(0)}`,
      actions: `<button id="__sub-add" class="px-3.5 md:px-4 h-9 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium flex items-center gap-1 shadow-soft">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        新增
      </button>`,
    })}

    <div class="px-4 md:px-6 py-4 space-y-5">
      ${subs.length === 0 ? `
        <div class="text-center py-16 px-6 bg-white rounded-2xl shadow-soft">
          <div class="text-6xl mb-3">💳</div>
          <h2 class="text-base font-semibold text-ink-900 mb-2">管理家里的定期账单</h2>
          <p class="text-sm text-ink-500 mb-6">软件订阅、贷款、水电煤、房租、保险……临近扣款会在「待处理」里提醒你。</p>
          <button id="__sub-add-empty" class="px-5 h-11 rounded-full bg-brand-500 hover:bg-brand-600 text-white font-medium shadow-soft">添加第一个订阅</button>
        </div>
      ` : `
        <!-- 费用卡片 -->
        <div class="grid grid-cols-3 gap-3">
          <div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-4 shadow-soft">
            <div class="text-xs text-ink-500">月均支出</div>
            <div class="text-xl font-bold text-indigo-700 mt-1">¥${monthly.toFixed(0)}</div>
          </div>
          <div class="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-4 shadow-soft">
            <div class="text-xs text-ink-500">年均支出</div>
            <div class="text-xl font-bold text-purple-700 mt-1">¥${yearly.toFixed(0)}</div>
          </div>
          <div class="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl p-4 shadow-soft">
            <div class="text-xs text-ink-500">生效订阅</div>
            <div class="text-xl font-bold text-emerald-700 mt-1">${normal.length}</div>
            ${paused.length ? `<div class="text-xs text-ink-500 mt-0.5">${paused.length} 已暂停</div>` : ''}
          </div>
        </div>

        ${Object.keys(byCategory).length > 0 ? `
          <section class="bg-white rounded-2xl shadow-soft p-4">
            <h3 class="text-sm font-semibold text-ink-900 mb-3">分类支出（月均）</h3>
            <div class="space-y-2">
              ${Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).map(([cid, cost]) => {
                const c = SUB_CATEGORIES.find(x => x.id === cid) || { name: cid, emoji: '•' };
                const pct = Math.round(cost / monthly * 100);
                return `
                  <div class="flex items-center gap-3">
                    <div class="w-24 text-xs text-ink-700 truncate">${c.emoji} ${esc(c.name)}</div>
                    <div class="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div class="h-full bg-gradient-to-r from-brand-500 to-indigo-500 rounded-full" style="width:${pct}%"></div>
                    </div>
                    <div class="w-20 text-xs text-ink-500 text-right">¥${cost.toFixed(0)}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </section>
        ` : ''}

        <!-- 订阅列表 -->
        <section class="bg-white rounded-2xl shadow-soft overflow-hidden">
          <div class="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <span class="text-sm font-semibold text-ink-900">订阅列表</span>
            <span class="chip">${normal.length}</span>
          </div>
          <div class="divide-y divide-slate-100">
            ${normal.map(s => {
              const cat = SUB_CATEGORIES.find(c => c.id === s.category) || { name: '其他', emoji: '📌' };
              const cyc = SUB_CYCLES.find(c => c.id === s.cycle)?.name || (s.cycle === 'custom' ? `每 ${s.cycleDays} 天` : '—');
              const remain = s.nextDueAt ? Math.ceil((new Date(s.nextDueAt + 'T23:59:59').getTime() - Date.now()) / (24 * 3600 * 1000)) : null;
              const remainCls = remain == null ? 'text-ink-500'
                : remain < 0 ? 'text-red-600 font-semibold'
                : remain <= 3 ? 'text-red-600 font-semibold'
                : remain <= 7 ? 'text-orange-600'
                : 'text-ink-500';
              const remainText = remain == null ? '—'
                : remain < 0 ? `逾期 ${-remain} 天`
                : remain === 0 ? '今天' : `${remain} 天后`;
              return `
                <button class="sub-row w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left" data-id="${s.id}">
                  <div class="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style="background:${subColorBg(s.name)}">${esc(s.icon || cat.emoji)}</div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-ink-900 truncate">${esc(s.name)}</div>
                    <div class="text-xs text-ink-500 truncate">${cat.emoji} ${esc(cat.name)} · ${esc(cyc)}${s.note ? ' · ' + esc(s.note) : ''}</div>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <div class="text-sm font-semibold text-ink-900">¥${(+s.amount || 0).toFixed(2)}</div>
                    <div class="text-xs ${remainCls} mt-0.5">${remainText}</div>
                  </div>
                </button>
              `;
            }).join('')}
          </div>
        </section>

        ${paused.length > 0 ? `
          <section class="bg-white rounded-2xl shadow-soft overflow-hidden opacity-75">
            <div class="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
              <span class="text-sm font-semibold text-ink-500">⏸ 已暂停</span>
              <span class="chip">${paused.length}</span>
            </div>
            <div class="divide-y divide-slate-100">
              ${paused.map(s => `
                <button class="sub-row w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left" data-id="${s.id}">
                  <div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl">${esc(s.icon || '📌')}</div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-ink-500 truncate">${esc(s.name)}</div>
                    <div class="text-xs text-ink-400 truncate">已暂停</div>
                  </div>
                  <div class="text-sm text-ink-500">¥${(+s.amount || 0).toFixed(2)}</div>
                </button>
              `).join('')}
            </div>
          </section>
        ` : ''}
      `}
    </div>
  `;

  const openNew = () => openSubscriptionDialog(null);
  $('#__sub-add')?.addEventListener('click', openNew);
  $('#__sub-add-empty')?.addEventListener('click', openNew);
  $('.sub-row').forEach(b => {
    b.onclick = async () => {
      const s = await db.get('subscriptions', b.dataset.id);
      if (s) openSubscriptionDialog(s);
    };
  });
}

function subColorBg(name) {
  const hue = nameToHue(name || 'sub');
  return `hsl(${hue},70%,92%)`;
}

function openSubscriptionDialog(existing) {
  const isEdit = !!existing;
  const s = existing || {
    id: uid(),
    name: '',
    icon: '',
    category: 'software',
    amount: '',
    currency: 'CNY',
    cycle: 'monthly',
    cycleDays: 30,
    nextDueAt: '',
    startedAt: new Date().toISOString().slice(0, 10),
    endAt: '',
    autoRenew: true,
    paymentMethod: '',
    url: '',
    note: '',
    status: 'active',
    createdAt: Date.now(),
  };

  const m = modal(`
    <div class="p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-ink-900">${isEdit ? '编辑订阅' : '新增订阅'}</h3>
        ${isEdit ? `<button id="sub-paid" class="text-xs px-3 h-7 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium">✓ 标记本期已付</button>` : ''}
      </div>

      <div class="flex items-center gap-3">
        <div class="w-14 h-14 rounded-xl flex items-center justify-center text-3xl flex-shrink-0" style="background:${subColorBg(s.name || 'x')}">
          <input id="sub-icon" type="text" maxlength="2" value="${esc(s.icon || '')}" placeholder="📌" class="w-full h-full text-center bg-transparent text-3xl outline-none"/>
        </div>
        <div class="flex-1">
          <input id="sub-name" type="text" value="${esc(s.name)}" placeholder="订阅名，如：Netflix / 房贷"
            class="w-full h-10 px-3 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm font-medium"/>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-xs text-ink-500">分类</label>
          <select id="sub-category" class="w-full mt-1 h-9 px-2 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm">
            ${SUB_CATEGORIES.map(c => `<option value="${c.id}" ${c.id === s.category ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-ink-500">周期</label>
          <select id="sub-cycle" class="w-full mt-1 h-9 px-2 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm">
            ${SUB_CYCLES.map(c => `<option value="${c.id}" ${c.id === s.cycle ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            <option value="custom" ${s.cycle === 'custom' ? 'selected' : ''}>自定义天数</option>
          </select>
        </div>
      </div>

      <div id="sub-cycle-custom" class="${s.cycle === 'custom' ? '' : 'hidden'}">
        <label class="text-xs text-ink-500">自定义周期(天)</label>
        <input id="sub-cycle-days" type="number" min="1" value="${s.cycleDays || 30}" class="w-full mt-1 h-9 px-3 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm"/>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-xs text-ink-500">金额 (CNY)</label>
          <input id="sub-amount" type="number" min="0" step="0.01" value="${esc(s.amount || '')}" placeholder="0.00"
            class="w-full mt-1 h-9 px-3 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm"/>
        </div>
        <div>
          <label class="text-xs text-ink-500">下次扣款日</label>
          <input id="sub-due" type="date" value="${esc(s.nextDueAt || '')}"
            class="w-full mt-1 h-9 px-3 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm"/>
        </div>
      </div>

      <details class="bg-slate-50 rounded-xl overflow-hidden">
        <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-ink-700 hover:bg-slate-100">⚡ 更多信息</summary>
        <div class="px-3 pb-3 pt-1 space-y-2">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-[11px] text-ink-500">开始日期</label>
              <input id="sub-start" type="date" value="${esc(s.startedAt || '')}" class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
            </div>
            <div>
              <label class="text-[11px] text-ink-500">结束日(贷款/会员)</label>
              <input id="sub-end" type="date" value="${esc(s.endAt || '')}" class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
            </div>
          </div>
          <div>
            <label class="text-[11px] text-ink-500">扣款方式</label>
            <input id="sub-pay" type="text" value="${esc(s.paymentMethod || '')}" placeholder="招行信用卡 *1234 / 支付宝"
              class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
          </div>
          <div>
            <label class="text-[11px] text-ink-500">管理链接</label>
            <input id="sub-url" type="url" value="${esc(s.url || '')}" placeholder="https://..."
              class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
          </div>
          <div>
            <label class="text-[11px] text-ink-500">备注</label>
            <input id="sub-note" type="text" value="${esc(s.note || '')}" class="w-full mt-0.5 h-8 px-2 rounded-lg bg-white border border-slate-200 focus:border-brand-500 outline-none text-xs"/>
          </div>
          <label class="inline-flex items-center gap-2 text-xs text-ink-700">
            <input id="sub-auto" type="checkbox" ${s.autoRenew ? 'checked' : ''}/> 自动续费
          </label>
        </div>
      </details>

      <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
        ${isEdit ? `
          <div class="flex gap-2">
            <button id="sub-toggle" class="text-xs px-3 h-9 rounded-lg ${s.status === 'paused' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}">${s.status === 'paused' ? '▶ 恢复' : '⏸ 暂停'}</button>
            <button id="sub-del" class="text-red-500 text-xs hover:text-red-700">🗑️ 删除</button>
          </div>
        ` : '<div></div>'}
        <div class="flex gap-2">
          <button id="sub-cancel" class="h-9 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm">取消</button>
          <button id="sub-save" class="h-9 px-5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium">${isEdit ? '保存' : '创建'}</button>
        </div>
      </div>
    </div>
  `);

  const cycleSel = m.root.querySelector('#sub-cycle');
  const customWrap = m.root.querySelector('#sub-cycle-custom');
  cycleSel.addEventListener('change', () => {
    customWrap.classList.toggle('hidden', cycleSel.value !== 'custom');
  });

  const readForm = () => ({
    name:         m.root.querySelector('#sub-name').value.trim(),
    icon:         m.root.querySelector('#sub-icon').value.trim(),
    category:     m.root.querySelector('#sub-category').value,
    cycle:        m.root.querySelector('#sub-cycle').value,
    cycleDays:    (+m.root.querySelector('#sub-cycle-days').value || 30),
    amount:       +m.root.querySelector('#sub-amount').value || 0,
    nextDueAt:    m.root.querySelector('#sub-due').value || '',
    startedAt:    m.root.querySelector('#sub-start').value || '',
    endAt:        m.root.querySelector('#sub-end').value || '',
    paymentMethod: m.root.querySelector('#sub-pay').value.trim(),
    url:          m.root.querySelector('#sub-url').value.trim(),
    note:         m.root.querySelector('#sub-note').value.trim(),
    autoRenew:    m.root.querySelector('#sub-auto').checked,
  });

  m.root.querySelector('#sub-cancel').onclick = () => m.close();

  m.root.querySelector('#sub-save').onclick = async () => {
    const f = readForm();
    if (!f.name) { toast('请填写订阅名'); return; }
    const updated = { ...s, ...f, status: s.status || 'active' };
    await db.put('subscriptions', updated);
    toast(isEdit ? '已保存' : '已创建');
    m.close();
    render();
  };

  m.root.querySelector('#sub-del')?.addEventListener('click', async () => {
    if (!confirm(`删除订阅「${s.name}」？`)) return;
    await db.del('subscriptions', s.id);
    toast('已删除');
    m.close();
    render();
  });

  m.root.querySelector('#sub-toggle')?.addEventListener('click', async () => {
    const next = s.status === 'paused' ? 'active' : 'paused';
    await db.put('subscriptions', { ...s, status: next });
    toast(next === 'paused' ? '已暂停' : '已恢复');
    m.close();
    render();
  });

  m.root.querySelector('#sub-paid')?.addEventListener('click', async () => {
    const advanced = advanceSubDue(s);
    await db.put('subscriptions', { ...advanced, lastPaidAt: new Date().toISOString().slice(0, 10) });
    toast('已记一期 · 下次扣款日已推进');
    m.close();
    render();
  });
}

/* ================================================================
 * 文件夹同步（File System Access API / ZIP）
 * ================================================================ */
const SyncState = {
  dirHandle: null,          // 已绑定的 FS handle
  dirName: '',
  autoSync: true,
  syncing: false,
  pendingSync: false,
  lastSyncedAt: 0,
};

async function initSync() {
  if (!HIStorage.FSA_SUPPORTED) return;
  try {
    const h = await HIStorage.loadHandle('root');
    if (h) {
      // 验证权限
      const perm = await h.queryPermission({ mode: 'readwrite' });
      SyncState.dirHandle = h;
      SyncState.dirName = h.name;
      SyncState.permStatus = perm;
    }
  } catch {}
}

async function ensurePermission() {
  if (!SyncState.dirHandle) return false;
  const perm = await SyncState.dirHandle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return true;
  const req = await SyncState.dirHandle.requestPermission({ mode: 'readwrite' });
  return req === 'granted';
}

async function doSyncNow() {
  if (!SyncState.dirHandle) return;
  if (!(await ensurePermission())) { toast('未获得文件夹写入权限'); return; }
  if (SyncState.syncing) { SyncState.pendingSync = true; return; }
  SyncState.syncing = true;
  try {
    const [rooms, photos, cabinets, items] = await Promise.all([
      db.all('rooms'), db.all('photos'), db.all('cabinets'), db.all('items')
    ]);
    const files = HIStorage.buildFileTree({ rooms, photos, cabinets, items });
    await HIStorage.writeTreeToDirectory(SyncState.dirHandle, files);
    SyncState.lastSyncedAt = Date.now();
  } catch (e) {
    console.error(e); toast('同步失败：' + e.message);
  } finally {
    SyncState.syncing = false;
    if (SyncState.pendingSync) { SyncState.pendingSync = false; doSyncNow(); }
    // 刷新设置页状态
    if (state.route.name === 'settings') render();
  }
}

/* 每次数据变更都尝试自动同步（debounced） */
let _syncTimer = null;
function scheduleAutoSync() {
  if (!SyncState.autoSync || !SyncState.dirHandle) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => doSyncNow(), 600);
}

// 把自动同步挂到 db 的写操作上
['add', 'put', 'del', 'clearAll'].forEach(m => {
  const orig = db[m];
  db[m] = async (...args) => {
    const r = await orig.apply(db, args);
    scheduleAutoSync();
    return r;
  };
});

async function bindDirectory() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'home-inventory-root' });
    SyncState.dirHandle = handle;
    SyncState.dirName = handle.name;
    await HIStorage.saveHandle('root', handle);
    toast('已绑定文件夹：' + handle.name);
    await doSyncNow();
    render();
  } catch (e) {
    if (e.name !== 'AbortError') toast('绑定失败：' + e.message);
  }
}

async function unbindDirectory() {
  await HIStorage.clearHandle('root');
  SyncState.dirHandle = null;
  SyncState.dirName = '';
  toast('已解除绑定');
  render();
}

async function exportAsZip() {
  const [rooms, photos, cabinets, items] = await Promise.all([
    db.all('rooms'), db.all('photos'), db.all('cabinets'), db.all('items')
  ]);
  const files = HIStorage.buildFileTree({ rooms, photos, cabinets, items });
  toast('打包中…');
  const blob = await HIStorage.filesToZipBlob(files);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 10);
  a.href = URL.createObjectURL(blob);
  a.download = `home-inventory-${ts}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('已导出 ZIP');
}

async function importFromZipOrFolder(files) {
  if (!confirm('导入会覆盖现有全部数据，确定继续？')) return false;
  try {
    const { rooms, photos, cabinets, items } = await HIStorage.parseFileTree(files);
    await db.clearAll();
    for (const r of rooms)    await db.add('rooms', r);
    for (const c of cabinets) await db.add('cabinets', c);
    for (const i of items)    await db.add('items', i);
    for (const p of photos)   await db.add('photos', p);
    toast(`导入成功：${rooms.length} 房间 · ${cabinets.length} 柜子 · ${items.length} 物品`);
    return true;
  } catch (e) {
    alert('导入失败：' + e.message);
    return false;
  }
}

async function importZipFile(file) {
  toast('解压中…');
  const files = await HIStorage.zipBlobToFiles(file);
  if (await importFromZipOrFolder(files)) render();
}

async function importFromFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    const files = await HIStorage.readTreeFromDirectory(handle);
    if (await importFromZipOrFolder(files)) render();
  } catch (e) {
    if (e.name !== 'AbortError') alert('导入失败：' + e.message);
  }
}

/* ================================================================
 * 页面：设置
 * ================================================================ */
async function renderSettings(app) {
  const [rooms, photos, cabinets, items] = await Promise.all([
    db.all('rooms'), db.all('photos'), db.all('cabinets'), db.all('items')
  ]);
  const totalBytes = photos.reduce((s, p) => s + (p.blob?.size || 0), 0);
  const mb = (totalBytes / 1024 / 1024).toFixed(2);
  const bound = !!SyncState.dirHandle;
  const supported = HIStorage.FSA_SUPPORTED;
  const lastSync = SyncState.lastSyncedAt
    ? new Date(SyncState.lastSyncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '从未同步';
  const claudeKey = await getConfig('claude_api_key');
  const proxyUrl = await getConfig('claude_proxy_url');
  const deepseekKey = await getConfig('deepseek_api_key');
  const deepseekModel = await getConfig('deepseek_model', 'deepseek-v4-flash');
  const openrouterKey = await getConfig('openrouter_api_key');

  app.innerHTML = `
    ${header({ title: '设置' })}
    <div class="px-4 md:px-6 py-4 space-y-4">
      <section class="bg-white rounded-2xl shadow-soft p-4">
        <h3 class="text-sm font-semibold mb-3">📊 数据概览</h3>
        <div class="grid grid-cols-4 gap-2 text-center">
          <div class="p-2"><div class="text-xl font-bold text-brand-600">${rooms.length}</div><div class="text-xs text-ink-500">房间</div></div>
          <div class="p-2"><div class="text-xl font-bold text-brand-600">${photos.length}</div><div class="text-xs text-ink-500">照片</div></div>
          <div class="p-2"><div class="text-xl font-bold text-brand-600">${cabinets.length}</div><div class="text-xs text-ink-500">柜子</div></div>
          <div class="p-2"><div class="text-xl font-bold text-brand-600">${items.length}</div><div class="text-xs text-ink-500">物品</div></div>
        </div>
        <div class="mt-2 text-xs text-ink-500 text-center">浏览器本地存储占用约 ${mb} MB</div>
      </section>

      <section class="bg-white rounded-2xl shadow-soft p-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-semibold">📁 同步到本地文件夹</h3>
          ${bound ? `<span class="chip" style="background:#dcfce7;color:#166534">已绑定</span>` : ''}
        </div>
        ${!supported ? `
          <p class="text-xs text-ink-500 mb-3">当前浏览器不支持 File System Access API（推荐用 Chrome/Edge/Arc）。请使用下方「ZIP 导出/导入」。</p>
        ` : bound ? `
          <div class="bg-slate-50 rounded-xl p-3 mb-3">
            <div class="text-sm font-medium mb-1">📂 ${esc(SyncState.dirName)}</div>
            <div class="text-xs text-ink-500">${SyncState.syncing ? '⏳ 同步中…' : `最近同步：${lastSync}`}</div>
          </div>
          <p class="text-xs text-ink-500 mb-3">每次添加/修改数据都会自动写入这个文件夹。用 Finder / 资源管理器打开就能直接看到全部数据。</p>
          <div class="flex flex-wrap gap-2">
            <button id="syncnow" class="h-10 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium">立即同步</button>
            <button id="unbind" class="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-medium">解除绑定</button>
          </div>
        ` : `
          <p class="text-xs text-ink-500 mb-3">选一个文件夹作为数据仓库，应用会把房间/柜子/物品以可读的 Markdown+JSON 格式写入。之后可直接把文件夹拖给 Claude / GPT 做分析。</p>
          <button id="bind" class="h-10 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium">选择文件夹</button>
        `}
      </section>

      <section class="bg-white rounded-2xl shadow-soft p-4">
        <h3 class="text-sm font-semibold mb-3">📦 导出 / 导入（ZIP）</h3>
        <p class="text-xs text-ink-500 mb-3">适合手机 / Safari 用户。ZIP 解压后就是完整的可读数据文件夹。</p>
        <div class="flex flex-wrap gap-2">
          <button id="zipexport" class="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-medium">导出 ZIP</button>
          <label class="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-medium cursor-pointer flex items-center">
            导入 ZIP
            <input id="zipimport" type="file" accept=".zip,application/zip" class="hidden"/>
          </label>
          ${supported ? `<button id="folderimport" class="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-medium">从文件夹导入</button>` : ''}
          <button id="loaddemo" class="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-medium">加载示例数据</button>
          <button id="reset" class="h-10 px-4 rounded-xl text-red-600 hover:bg-red-50 text-sm font-medium ml-auto">清空所有数据</button>
        </div>
      </section>

      <section class="bg-gradient-to-br from-brand-50 to-indigo-50 rounded-2xl shadow-soft p-4">
        <h3 class="text-sm font-semibold mb-2">🤖 给 AI 分析用</h3>
        <p class="text-xs text-ink-700 mb-2">导出的文件夹/ZIP 里包含 <code class="bg-white/70 px-1.5 py-0.5 rounded">.meta/ai-prompt.md</code>，把整个文件夹拖给 Claude / ChatGPT 即可直接问：</p>
        <ul class="text-xs text-ink-700 space-y-1 pl-4 list-disc">
          <li>"吸尘器在哪？"</li>
          <li>"耶诞灯还有几个？"</li>
          <li>"书房都有什么东西？"</li>
          <li>"帮我盘点重复或可以丢的物品"</li>
        </ul>
      </section>

      <section class="bg-white rounded-2xl shadow-soft p-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-semibold">🤖 AI 配置</h3>
          <button id="openapi" class="h-8 px-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium">配置 API</button>
        </div>
        <div class="flex gap-2 flex-wrap">
          ${openrouterKey ? `<span class="chip" style="background:#dcfce7;color:#166534">Gemini 已配置</span>` : `<span class="chip" style="background:#fef3c7;color:#92400e">Gemini 未配置</span>`}
          ${deepseekKey ? `<span class="chip" style="background:#dcfce7;color:#166534">DeepSeek 已配置</span>` : `<span class="chip" style="background:#fef3c7;color:#92400e">DeepSeek 未配置</span>`}
          ${claudeKey ? `<span class="chip" style="background:#dcfce7;color:#166534">Claude 已配置</span>` : `<span class="chip" style="background:#fef3c7;color:#92400e">Claude 未配置</span>`}
        </div>
        <p class="text-xs text-ink-500 mt-2">Gemini Vision (OpenRouter) 用于柜子图片识别，DeepSeek 用于文本分析，Claude 为备选。</p>
      </section>

      <section class="bg-white rounded-2xl shadow-soft p-4">
        <h3 class="text-sm font-semibold mb-2">📖 使用指南</h3>
        <ol class="list-decimal list-inside text-xs text-ink-700 space-y-1.5">
          <li>在「房间」页点「新房间」，给家里每个房间建档案</li>
          <li>进入房间添加照片，用「AI 识别」或「手动框选」标注柜子</li>
          <li>点柜子记录里面有什么物品（支持数量、备注、标签）</li>
          <li>绑定一个本地文件夹后，所有修改都会实时同步为可读的 Markdown 文件</li>
          <li>把整个文件夹拖给 AI，问"东西在哪"或做盘点</li>
        </ol>
      </section>

      <p class="text-center text-xs text-ink-500 pt-2">家居收纳 · 物品档案</p>
    </div>
  `;

  $('#bind')?.addEventListener('click', bindDirectory);
  $('#unbind')?.addEventListener('click', unbindDirectory);
  $('#syncnow')?.addEventListener('click', () => { doSyncNow(); toast('开始同步'); });
  $('#zipexport')?.addEventListener('click', exportAsZip);
  $('#zipimport')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (f) importZipFile(f);
  });
  $('#folderimport')?.addEventListener('click', importFromFolder);
  $('#reset')?.addEventListener('click', async () => {
    if (!confirm('确认清空所有房间、照片和物品？此操作不可恢复。')) return;
    if (!confirm('再确认一次：真的清空？')) return;
    await db.clearAll();
    localStorage.setItem('hi-demo-cleared', 'true');
    urlCache.forEach(u => URL.revokeObjectURL(u));
    urlCache.clear();
    toast('已清空');
    go('rooms');
  });
  $('#openapi')?.addEventListener('click', () => openApiConfigModal());
  $('#loaddemo')?.addEventListener('click', async () => {
    localStorage.removeItem('hi-demo-cleared');
    const loaded = await loadDemoData();
    if (!loaded) toast('已有示例数据，无需重复加载');
    render();
  });
}

/* ================================================================
 * DeepSeek API 集成（OpenAI 兼容格式）
 * ================================================================ */
const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';

async function callDeepSeek(messages, { model, apiKey, maxTokens = 1024, temperature = 0.7 } = {}) {
  const res = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'deepseek-v4-flash',
      messages,
      max_tokens: maxTokens,
      temperature,
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/* ================================================================
 * OpenRouter API 集成（Gemini Vision 图片识别）
 * ================================================================ */
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

async function callOpenRouter(messages, { model, apiKey, maxTokens = 1024 } = {}) {
  const res = await fetch(OPENROUTER_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'google/gemini-2.5-flash',
      messages,
      max_tokens: maxTokens,
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter API (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'OpenRouter 返回错误');
  return data.choices?.[0]?.message?.content || '';
}

async function detectCabinetsWithGemini(blob, { width, height }) {
  const apiKey = await getConfig('openrouter_api_key');
  if (!apiKey) throw new Error('请先在设置页填入 OpenRouter API Key');
  const model = await getConfig('openrouter_model', 'google/gemini-2.5-flash');

  // 压缩图片
  const maxSide = 1568;
  let imgBlob = blob;
  if (blob && blob.size > 100 && Math.max(width, height) > maxSide) {
    const ratio = maxSide / Math.max(width, height);
    const nw = Math.round(width * ratio), nh = Math.round(height * ratio);
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (bmp) {
      const c = document.createElement('canvas');
      c.width = nw; c.height = nh;
      c.getContext('2d').drawImage(bmp, 0, 0, nw, nh);
      imgBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      bmp.close();
    }
  }

  const base64 = await fileToBase64(imgBlob);
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const text = await callOpenRouter([{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: CABINET_DETECT_PROMPT }
    ]
  }], { model, apiKey, maxTokens: 8192 });

  return parseDetection(text);
}

/* ================================================================
 * AI 对话：收纳建议 + 重命名建议
 * ================================================================ */
async function chatWithAI(messages) {
  // 优先用 DeepSeek（纯文本对话），其次 OpenRouter
  const dk = await getConfig('deepseek_api_key');
  if (dk) {
    const model = await getConfig('deepseek_model', 'deepseek-v4-flash');
    return await callDeepSeek(messages, { model, apiKey: dk, maxTokens: 4096, temperature: 0.6 });
  }
  const orKey = await getConfig('openrouter_api_key');
  if (orKey) {
    const model = await getConfig('openrouter_model', 'google/gemini-2.5-flash');
    return await callOpenRouter(messages, { model, apiKey: orKey, maxTokens: 4096 });
  }
  throw new Error('请先在「设置 → 配置 API」中填入 DeepSeek 或 OpenRouter 的 API Key');
}

/* 流式聊天 —— SSE 解析，实时触发 onDelta(chunkText) 回调
 * 返回完整的拼接文本。abortSignal 可用于中途取消。
 */
async function streamChatWithAI(messages, onDelta, abortSignal) {
  const dk = await getConfig('deepseek_api_key');
  const orKey = await getConfig('openrouter_api_key');

  let url, apiKey, model;
  if (dk) {
    url = DEEPSEEK_API;
    apiKey = dk;
    model = await getConfig('deepseek_model', 'deepseek-v4-flash');
  } else if (orKey) {
    url = OPENROUTER_API;
    apiKey = orKey;
    model = await getConfig('openrouter_model', 'google/gemini-2.5-flash');
  } else {
    throw new Error('请先在「设置 → 配置 API」中填入 DeepSeek 或 OpenRouter 的 API Key');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4096,
      temperature: 0.6,
      stream: true,
    }),
    signal: abortSignal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API (${res.status}): ${err.slice(0, 200)}`);
  }
  if (!res.body) throw new Error('当前环境不支持流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE: 以 "\n\n" 分隔事件；每个事件内可能多行 "data: ..."
    let sepIdx;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const lines = rawEvent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') { return full; }
        if (!payload) continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content
                     ?? json.choices?.[0]?.message?.content
                     ?? '';
          if (delta) {
            full += delta;
            try { onDelta(delta, full); } catch (_) {}
          }
        } catch (_) {
          // OpenRouter 有时会发 ": OPENROUTER PROCESSING" 之类的注释行，忽略
        }
      }
    }
  }
  return full;
}

function buildChatSystemPrompt(rooms, cabinets, items) {
  // rooms: Array<{id,name,icon}>
  // cabinets: Array<cabinet>
  // items: Array<item>
  const itemsByCab = new Map();
  items.forEach(it => {
    if (!itemsByCab.has(it.cabinetId)) itemsByCab.set(it.cabinetId, []);
    itemsByCab.get(it.cabinetId).push(it);
  });

  const blocks = rooms.map(room => {
    const cabsInRoom = cabinets.filter(c => c.roomId === room.id && !isLooseCabinet(c));
    if (cabsInRoom.length === 0) return `### ${room.icon || '🏠'} ${room.name}\n（无储物单元）`;
    const lines = cabsInRoom.map((c, i) => {
      const its = itemsByCab.get(c.id) || [];
      const itemDesc = its.length === 0
        ? '（暂无物品）'
        : its.slice(0, 12).map(it => it.name + (it.qty > 1 ? `×${it.qty}` : '')).join('、')
          + (its.length > 12 ? `… 等共 ${its.length} 件` : '');
      return `${i + 1}. [id=${c.id}] ${c.name}：${itemDesc}`;
    }).join('\n');
    return `### ${room.icon || '🏠'} ${room.name}（${cabsInRoom.length} 个储物单元）\n${lines}`;
  }).join('\n\n');

  const totalCabs = cabinets.filter(c => !isLooseCabinet(c)).length;
  const totalItems = items.filter(i => i.status !== 'pending').length;
  return `你是家居收纳整理助手。用户家中共 ${rooms.length} 个房间、${totalCabs} 个储物单元、${totalItems} 件物品。

【全部储物单元清单（按房间分组）】
${blocks || '（用户还没有标注任何储物单元）'}

【你能帮用户做什么】
1. 给储物单元起更语义化的名字（基于里面的物品推断用途，比如"白色吊柜2"看到里面是杯子可以建议改为"杯具收纳柜"）
2. 推荐某类物品该放进哪个柜子（基于现有分类规律，可跨房间）
3. 整理建议：如何分类、哪些柜子适合放高频/低频物品、空间利用建议
4. 跨房间梳理：哪些物品可以归并到一起、哪些柜子明显偏离主题

【重要：重命名建议的输出格式】
当你建议重命名某些储物单元时，必须在回复正文之后追加一段 JSON 代码块（仅当确实有重命名建议时才输出，否则不要输出）：
\`\`\`rename
[{"id":"<上面清单里的id原值>","newName":"建议名"}]
\`\`\`
- id 必须严格使用上面清单中 [id=xxx] 的原值，不要修改、不要省略
- newName 控制在 12 个字以内，要语义清晰
- 一次回复最多建议 8 条
- 不要在 JSON 之外重复罗列这些 id

回答风格：简洁、有条理、说人话；列举建议时用编号或要点。`;
}

async function openChatPanel() {
  // 关闭旧的（如果存在）
  document.querySelectorAll('.chat-backdrop, .chat-drawer').forEach(el => el.remove());

  // 拉取全部数据
  const [rooms, cabinets, items] = await Promise.all([
    db.all('rooms'),
    db.all('cabinets'),
    db.all('items'),
  ]);

  const systemPrompt = buildChatSystemPrompt(rooms, cabinets, items);
  const messages = [{ role: 'system', content: systemPrompt }];

  // 展示用的"有效"计数（排除自由区和待处理物品）
  const displayCabs = cabinets.filter(c => !isLooseCabinet(c)).length;
  const displayItems = items.filter(i => i.status !== 'pending').length;

  const backdrop = document.createElement('div');
  backdrop.className = 'chat-backdrop';
  const drawer = document.createElement('div');
  drawer.className = 'chat-drawer';
  drawer.innerHTML = `
    <div class="chat-head">
      <div class="text-2xl">💬</div>
      <div class="flex-1">
        <div class="font-semibold text-ink-900 text-sm">AI 收纳助手</div>
        <div class="text-xs text-ink-500">${rooms.length} 个房间 · ${displayCabs} 个储物单元 · ${displayItems} 件物品</div>
      </div>
      <button class="chat-close w-8 h-8 rounded-full hover:bg-slate-100 text-ink-500" title="关闭">
        <svg class="mx-auto" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="chat-body" id="chat-body"></div>
    <div class="chat-input-area">
      <textarea id="chat-input" rows="1" placeholder="例如：帮我给这些柜子起更好的名字"
        class="flex-1 max-h-32 resize-none px-3 py-2 rounded-xl bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm"></textarea>
      <button id="chat-send" class="h-9 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium shadow-soft">发送</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    drawer.classList.add('open');
  });

  const bodyEl = drawer.querySelector('#chat-body');
  const inputEl = drawer.querySelector('#chat-input');
  const sendBtn = drawer.querySelector('#chat-send');

  let busy = false;

  const hint = document.createElement('div');
  hint.className = 'chat-msg ai';
  hint.textContent = `你好！我已经了解了你家中所有 ${rooms.length} 个房间、${displayCabs} 个储物单元的物品分布。可以问我：
• 帮所有/某个房间的柜子起更好的名字
• 我刚买的（某物品）应该放进哪个柜子
• 现在的收纳布局有什么改进建议
• 哪些柜子里堆得太杂需要整理`;
  bodyEl.appendChild(hint);

  const renderRenameCard = (suggestions) => {
    const card = document.createElement('div');
    card.className = 'rename-card';
    card.innerHTML = `
      <div class="text-xs text-amber-700 font-semibold mb-2">💡 重命名建议</div>
      ${suggestions.map((s, i) => {
        const cab = cabinets.find(c => c.id === s.id);
        if (!cab) return '';
        return `
          <div class="rename-row" data-idx="${i}">
            <span class="old-name">${esc(cab.name)}</span>
            <span class="text-amber-500">→</span>
            <span class="new-name">${esc(s.newName)}</span>
            <button class="adopt" data-cab-id="${s.id}" data-new-name="${esc(s.newName)}">采纳</button>
          </div>
        `;
      }).join('')}
      ${suggestions.length > 1 ? `<button class="adopt-all mt-2 w-full py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-medium">全部采纳</button>` : ''}
    `;
    card.querySelectorAll('button.adopt').forEach(btn => {
      btn.onclick = async () => {
        if (btn.classList.contains('adopted')) return;
        const cabId = btn.dataset.cabId;
        const newName = btn.dataset.newName;
        const cab = cabinets.find(c => c.id === cabId);
        if (!cab) return;
        cab.name = newName;
        await db.put('cabinets', cab);
        btn.textContent = '✓ 已采纳';
        btn.classList.add('adopted');
        toast('已重命名');
      };
    });
    const allBtn = card.querySelector('.adopt-all');
    if (allBtn) {
      allBtn.onclick = async () => {
        for (const btn of card.querySelectorAll('button.adopt')) {
          if (!btn.classList.contains('adopted')) btn.click();
        }
      };
    }
    return card;
  };

  const renderAIMessage = (text) => {
    const renameRe = /```rename\s*([\s\S]*?)```/i;
    const match = text.match(renameRe);
    let prose = text;
    let suggestions = null;
    if (match) {
      prose = text.replace(match[0], '').trim();
      try {
        const parsed = JSON.parse(match[1].trim());
        if (Array.isArray(parsed)) {
          suggestions = parsed
            .filter(s => s && typeof s.id === 'string' && typeof s.newName === 'string')
            .filter(s => cabinets.find(c => c.id === s.id))
            .slice(0, 8);
        }
      } catch (_) { /* 忽略解析错误 */ }
    }

    if (prose) {
      const msg = document.createElement('div');
      msg.className = 'chat-msg ai';
      msg.textContent = prose;
      bodyEl.appendChild(msg);
    }
    if (suggestions && suggestions.length > 0) {
      bodyEl.appendChild(renderRenameCard(suggestions));
    }
  };

  const send = async () => {
    if (busy) return;
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';

    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg user';
    userMsg.textContent = text;
    bodyEl.appendChild(userMsg);
    bodyEl.scrollTop = bodyEl.scrollHeight;

    messages.push({ role: 'user', content: text });

    // 流式气泡：先显示打字点，首个 chunk 到达时替换为文本
    const streamMsg = document.createElement('div');
    streamMsg.className = 'chat-msg ai streaming';
    streamMsg.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span>`;
    bodyEl.appendChild(streamMsg);
    bodyEl.scrollTop = bodyEl.scrollHeight;

    busy = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '停止';
    const prevOnClick = sendBtn.onclick;
    const abortCtrl = new AbortController();
    sendBtn.onclick = () => abortCtrl.abort();

    let firstChunk = true;
    // 在流式过程中隐藏 rename JSON 块，只显示正文部分
    const renderStream = (full) => {
      // 流中可能包含未闭合的 ```rename ... ，这里剥离已出现的 ```rename 块及之后的内容
      let display = full;
      const idx = display.indexOf('```rename');
      if (idx !== -1) display = display.slice(0, idx).trimEnd();
      streamMsg.textContent = display;
    };

    try {
      const reply = await streamChatWithAI(messages, (_delta, full) => {
        if (firstChunk) { streamMsg.innerHTML = ''; firstChunk = false; }
        renderStream(full);
        bodyEl.scrollTop = bodyEl.scrollHeight;
      }, abortCtrl.signal);

      // 流结束：最终展示——剥离 rename JSON、追加采纳卡片
      streamMsg.remove();
      messages.push({ role: 'assistant', content: reply });
      renderAIMessage(reply);
    } catch (e) {
      streamMsg.remove();
      if (e.name === 'AbortError') {
        const note = document.createElement('div');
        note.className = 'chat-msg ai';
        note.textContent = '（已停止）';
        note.style.opacity = '0.6';
        bodyEl.appendChild(note);
      } else {
        const err = document.createElement('div');
        err.className = 'chat-msg error';
        err.textContent = '⚠️ ' + e.message;
        bodyEl.appendChild(err);
      }
    } finally {
      busy = false;
      sendBtn.disabled = false;
      sendBtn.textContent = '发送';
      sendBtn.onclick = prevOnClick;
      bodyEl.scrollTop = bodyEl.scrollHeight;
      inputEl.focus();
    }
  };

  sendBtn.onclick = send;
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 128) + 'px';
  });

  const closePanel = () => {
    backdrop.classList.remove('open');
    drawer.classList.remove('open');
    setTimeout(() => { backdrop.remove(); drawer.remove(); }, 250);
    document.removeEventListener('keydown', onEsc);
  };
  const onEsc = (e) => { if (e.key === 'Escape') closePanel(); };
  drawer.querySelector('.chat-close').onclick = closePanel;
  backdrop.onclick = closePanel;
  document.addEventListener('keydown', onEsc);
}

/* ================================================================
 * API 配置弹窗（DeepSeek + Claude，含连通性测试）
 * ================================================================ */
async function openApiConfigModal() {
  const dk = await getConfig('deepseek_api_key');
  const dm = await getConfig('deepseek_model', 'deepseek-v4-flash');
  const orKey = await getConfig('openrouter_api_key');
  const orModel = await getConfig('openrouter_model', 'google/gemini-2.5-flash');
  const ck = await getConfig('claude_api_key');
  const px = await getConfig('claude_proxy_url');

  // 生成测试图片（带 3 个标注方块）
  async function makeTestBlob() {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = '#8b5cf6'; ctx.fillRect(20, 40, 160, 220);
    ctx.fillStyle = '#3b82f6'; ctx.fillRect(220, 40, 160, 100);
    ctx.fillStyle = '#10b981'; ctx.fillRect(220, 160, 160, 100);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('柜子A', 100, 160); ctx.fillText('柜子B', 300, 100); ctx.fillText('柜子C', 300, 220);
    return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  }

  const m = modal(`
    <div class="p-5 max-h-[85vh] overflow-y-auto">
      <h3 class="text-lg font-semibold mb-4">🤖 AI 配置</h3>

      <!-- OpenRouter / Gemini 配置 -->
      <div class="mb-5 p-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50/50">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-base">🟢</span>
          <h4 class="text-sm font-semibold">OpenRouter · Gemini Vision</h4>
          <span class="chip" style="background:#dcfce7;color:#166534">推荐 · 图片识别</span>
        </div>
        <label class="block text-xs text-ink-500 mb-1">API Key</label>
        <input id="or-key" type="password" value="${esc(orKey)}" placeholder="sk-or-v1-..."
          class="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none text-sm font-mono"/>
        <div class="flex gap-2 mt-2">
          <label class="block text-xs text-ink-500 mb-1 flex-1">模型</label>
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1">
          <label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" name="or-model" value="google/gemini-2.5-flash" ${orModel === 'google/gemini-2.5-flash' ? 'checked' : ''} class="accent-emerald-500"/>
            <span>2.5 Flash</span>
          </label>
          <label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" name="or-model" value="google/gemini-3.1-flash-lite" ${orModel === 'google/gemini-3.1-flash-lite' ? 'checked' : ''} class="accent-emerald-500"/>
            <span>3.1 Flash Lite</span>
          </label>
          <label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" name="or-model" value="google/gemini-3.1-pro-preview" ${orModel === 'google/gemini-3.1-pro-preview' ? 'checked' : ''} class="accent-emerald-500"/>
            <span>3.1 Pro</span>
          </label>
        </div>
        <div class="flex gap-2 mt-3">
          <button id="or-test" class="h-9 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium">测试连接（发送图片）</button>
          <span id="or-status" class="text-xs self-center"></span>
        </div>
      </div>

      <!-- DeepSeek 配置 -->
      <div class="mb-5">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-base">🔵</span>
          <h4 class="text-sm font-semibold">DeepSeek</h4>
          <span class="text-xs text-ink-500">文本分析</span>
        </div>
        <label class="block text-xs text-ink-500 mb-1">API Key</label>
        <input id="dk-key" type="password" value="${esc(dk)}" placeholder="sk-..."
          class="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none text-sm font-mono"/>
        <div class="flex gap-4 mt-2">
          <label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" name="dk-model" value="deepseek-v4-flash" ${dm === 'deepseek-v4-flash' ? 'checked' : ''} class="accent-brand-500"/>
            <span>v4-flash</span>
          </label>
          <label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" name="dk-model" value="deepseek-v4-pro" ${dm === 'deepseek-v4-pro' ? 'checked' : ''} class="accent-brand-500"/>
            <span>v4-pro</span>
          </label>
        </div>
        <div class="flex gap-2 mt-3">
          <button id="dk-test" class="h-9 px-4 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium">测试连接</button>
          <span id="dk-status" class="text-xs self-center"></span>
        </div>
      </div>

      <hr class="my-4 border-slate-100"/>

      <!-- Claude 配置 -->
      <div class="mb-5">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-base">🟣</span>
          <h4 class="text-sm font-semibold">Claude Vision</h4>
          <span class="text-xs text-ink-500">备选图片识别</span>
        </div>
        <label class="block text-xs text-ink-500 mb-1">API Key</label>
        <input id="ck-key" type="password" value="${esc(ck)}" placeholder="sk-ant-api03-..."
          class="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none text-sm font-mono"/>
        <label class="block text-xs text-ink-500 mb-1 mt-2">代理 URL（可选，解决 CORS）</label>
        <input id="ck-proxy" type="text" value="${esc(px)}" placeholder="https://your-proxy.com/"
          class="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none text-sm font-mono"/>
        <div class="flex gap-2 mt-3">
          <button id="ck-test" class="h-9 px-4 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-xs font-medium">测试连接（含图片）</button>
          <span id="ck-status" class="text-xs self-center"></span>
        </div>
      </div>

      <!-- 说明 -->
      <div class="bg-slate-50 rounded-xl p-3 mb-4">
        <p class="text-xs text-ink-500 leading-relaxed">
          <strong>OpenRouter</strong>：统一网关，一个 Key 调用多种模型。<a href="https://openrouter.ai/keys" target="_blank" class="text-brand-600 underline">获取 Key</a><br/>
          <strong>DeepSeek</strong>：文本对话和分析，价格低。<a href="https://platform.deepseek.com" target="_blank" class="text-brand-600 underline">获取 Key</a><br/>
          <strong>Claude Vision</strong>：备选图片识别。<a href="https://console.anthropic.com" target="_blank" class="text-brand-600 underline">获取 Key</a><br/>
          <span class="text-ink-400">图片识别优先级：Gemini (OpenRouter) → Claude → 启发式占位</span>
        </p>
      </div>

      <div class="flex justify-end gap-2">
        <button id="cancel" class="h-10 px-5 rounded-xl text-ink-700 font-medium hover:bg-slate-100">取消</button>
        <button id="save" class="h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-medium">保存</button>
      </div>
    </div>
  `);

  // ---- 测试 OpenRouter / Gemini Vision ----
  m.root.querySelector('#or-test').onclick = async () => {
    const status = m.root.querySelector('#or-status');
    const key = m.root.querySelector('#or-key').value.trim();
    const model = m.root.querySelector('input[name=or-model]:checked')?.value || 'google/gemini-2.5-flash';
    if (!key) { status.textContent = '❌ 请先填写 API Key'; status.className = 'text-xs self-center text-red-500'; return; }
    status.textContent = '⏳ 正在生成测试图片并识别…'; status.className = 'text-xs self-center text-ink-500';
    try {
      const testBlob = await makeTestBlob();
      const base64 = await fileToBase64(testBlob);
      const dataUrl = `data:image/jpeg;base64,${base64}`;
      const reply = await callOpenRouter([{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: '这张测试图片中有 3 个彩色方块（紫/蓝/绿），分别标注为柜子A、柜子B、柜子C。请识别它们的位置，只返回 JSON 数组：[{"name":"柜子名","rect":{"x":0,"y":0,"w":0.5,"h":0.5}}]' }
        ]
      }], { model, apiKey: key, maxTokens: 512 });
      const match = reply.match(/\[[\s\S]*\]/);
      const boxes = match ? JSON.parse(match[0]) : [];
      status.textContent = `✅ ${model.split('/').pop()} 识别到 ${boxes.length} 个柜子！${boxes.map(b => b.name).join('、')}`;
      status.className = 'text-xs self-center text-emerald-600';
    } catch (e) {
      status.textContent = `❌ ${e.message.slice(0, 100)}`;
      status.className = 'text-xs self-center text-red-500';
    }
  };

  // ---- 测试 DeepSeek ----
  m.root.querySelector('#dk-test').onclick = async () => {
    const status = m.root.querySelector('#dk-status');
    const key = m.root.querySelector('#dk-key').value.trim();
    const model = m.root.querySelector('input[name=dk-model]:checked')?.value || 'deepseek-v4-flash';
    if (!key) { status.textContent = '❌ 请先填写 API Key'; status.className = 'text-xs self-center text-red-500'; return; }
    status.textContent = '⏳ 测试中…'; status.className = 'text-xs self-center text-ink-500';
    try {
      const reply = await callDeepSeek([
        { role: 'system', content: '你是家居收纳助手。用一句话回复。' },
        { role: 'user', content: '请用一句话介绍你自己，并确认你是什么模型。' }
      ], { model, apiKey: key, maxTokens: 100 });
      status.textContent = `✅ ${reply.slice(0, 80)}`;
      status.className = 'text-xs self-center text-emerald-600';
    } catch (e) {
      status.textContent = `❌ ${e.message.slice(0, 100)}`;
      status.className = 'text-xs self-center text-red-500';
    }
  };

  // ---- 测试 Claude Vision ----
  m.root.querySelector('#ck-test').onclick = async () => {
    const status = m.root.querySelector('#ck-status');
    const key = m.root.querySelector('#ck-key').value.trim();
    const proxy = m.root.querySelector('#ck-proxy').value.trim();
    if (!key) { status.textContent = '❌ 请先填写 API Key'; status.className = 'text-xs self-center text-red-500'; return; }
    status.textContent = '⏳ 正在生成测试图片并识别…'; status.className = 'text-xs self-center text-ink-500';
    try {
      const testBlob = await makeTestBlob();
      const base64 = await fileToBase64(testBlob);
      const res = await fetch(proxy + ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              { type: 'text', text: '这张测试图片中有 3 个彩色方块，分别标注为柜子A、柜子B、柜子C。请识别它们的位置，返回 JSON 数组格式：[{"name":"柜子名","rect":{"x":0,"y":0,"w":0.5,"h":0.5}}]' }
            ]
          }]
        })
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`API 返回 ${res.status}: ${err.slice(0, 150)}`);
      }
      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      const match = text.match(/\[[\s\S]*\]/);
      const boxes = match ? JSON.parse(match[0]) : [];
      status.textContent = `✅ Claude 识别到 ${boxes.length} 个柜子！${boxes.map(b => b.name).join('、')}`;
      status.className = 'text-xs self-center text-emerald-600';
    } catch (e) {
      status.textContent = `❌ ${e.message.slice(0, 100)}`;
      status.className = 'text-xs self-center text-red-500';
    }
  };

  // ---- 保存 ----
  m.root.querySelector('#cancel').onclick = m.close;
  m.root.querySelector('#save').onclick = async () => {
    await setConfig('openrouter_api_key', m.root.querySelector('#or-key').value.trim());
    await setConfig('openrouter_model', m.root.querySelector('input[name=or-model]:checked')?.value || 'google/gemini-2.5-flash');
    await setConfig('deepseek_api_key', m.root.querySelector('#dk-key').value.trim());
    await setConfig('deepseek_model', m.root.querySelector('input[name=dk-model]:checked')?.value || 'deepseek-v4-flash');
    await setConfig('claude_api_key', m.root.querySelector('#ck-key').value.trim());
    await setConfig('claude_proxy_url', m.root.querySelector('#ck-proxy').value.trim());
    toast('API 配置已保存');
    m.close(); render();
  };
}

/* ================================================================
 * 启动
 * ================================================================ */
// 底部 tab（仅 storage 场景下有效）
document.addEventListener('click', (e) => {
  const tbtn = e.target.closest('.tab-btn');
  if (tbtn) { go(tbtn.dataset.route); return; }
  const sbtn = e.target.closest('.scene-btn');
  if (sbtn) { goScene(sbtn.dataset.scene); return; }
});

// 全局图片加载失败兜底：任何 <img> 解码失败时显示占位图
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.src !== PLACEHOLDER_SVG) {
    img.onerror = null; // 避免无限循环
    img.src = PLACEHOLDER_SVG;
  }
}, true);

// 从 hash 恢复路由（兼容旧 hash 或顶部 scene）
try {
  if (location.hash.length > 1) {
    const r = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    if (r && r.name) {
      if (STORAGE_ROUTES.has(r.name)) { state.scene = 'storage'; state.route = r; }
      else if (TOP_SCENES.has(r.name)) { state.scene = r.name; }
    }
  }
} catch {}

(async () => {
  await initSync();
  await loadDemoData();
  render();
})();
