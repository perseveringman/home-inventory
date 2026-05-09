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
const DB_VERSION = 1;
const STORES = ['rooms', 'photos', 'cabinets', 'items'];

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
    await Promise.all(STORES.map(n => new Promise((res, rej) => {
      const r = d.transaction(n, 'readwrite').objectStore(n).clear();
      r.onsuccess = res; r.onerror = () => rej(r.error);
    })));
  }
};

/* ---------- 工具 ---------- */
const uid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = ts => { const d = new Date(ts); return `${d.getMonth()+1}月${d.getDate()}日`; };

function toast(msg, ms = 1800) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

/* Blob → Object URL 缓存，避免同一张图反复 createObjectURL */
const urlCache = new Map();
function blobURL(blob, key) {
  if (urlCache.has(key)) return urlCache.get(key);
  const u = URL.createObjectURL(blob);
  urlCache.set(key, u);
  return u;
}

/* 将图片压缩到合适尺寸再存，避免 IndexedDB 里堆几十 MB */
async function compressImage(file, maxSide = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
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

/* ---------- AI 识别接口（可替换） ----------
 * 当前占位实现：基于图片比例给出 2~3 个候选框，用户再手动微调。
 * 接入真 API 时，只需让 detectCabinets(blob) 返回 [{name, rect:{x,y,w,h}}]，x/y/w/h 为 0~1 归一化。
 */
async function detectCabinets(blob, { width, height }) {
  await new Promise(r => setTimeout(r, 600)); // 假装在识别
  // 启发式：把图片左中右各给一个候选框，用户可删除或调整
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
  return boxes;
}

/* ---------- 路由 ---------- */
const state = {
  route: { name: 'rooms' },
};

function go(route) {
  state.route = typeof route === 'string' ? { name: route } : route;
  render();
  history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(state.route)));
}

window.addEventListener('hashchange', () => {
  try {
    const r = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    if (r && r.name) { state.route = r; render(); }
  } catch {}
});

/* ---------- 渲染入口 ---------- */
async function render() {
  const app = $('#app');
  app.innerHTML = '<div class="p-8 text-center text-ink-500">加载中…</div>';
  // tab 高亮
  $$('.tab-btn').forEach(b => {
    const active = b.dataset.route === state.route.name
                || (state.route.name === 'room' && b.dataset.route === 'rooms')
                || (state.route.name === 'photo' && b.dataset.route === 'rooms');
    b.classList.toggle('text-brand-600', active);
    b.classList.toggle('md:bg-brand-50', active);
    b.classList.toggle('text-ink-500', !active);
  });

  const r = state.route;
  if (r.name === 'rooms')    return renderRooms(app);
  if (r.name === 'room')     return renderRoomDetail(app, r.id);
  if (r.name === 'photo')    return renderPhotoDetail(app, r.id);
  if (r.name === 'items')    return renderItems(app);
  if (r.name === 'search')   return renderSearch(app);
  if (r.name === 'settings') return renderSettings(app);
  app.innerHTML = '<div class="p-8">未知页面</div>';
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
    cabinets: cabinets.filter(c => c.roomId === id).length,
    items: items.filter(i => i.roomId === id).length,
  });

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
        </div>
      `}
    </div>
  `;

  $('#__add')?.addEventListener('click', () => openRoomDialog());
  $('#__empty-add')?.addEventListener('click', () => openRoomDialog());
  $$('.room-card').forEach(b => b.onclick = () => go({ name: 'room', id: b.dataset.id }));
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
          <label class="inline-block">
            <input type="file" accept="image/*" capture="environment" class="hidden" id="__addphoto1"/>
            <span class="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-brand-500 hover:bg-brand-600 text-white font-medium shadow-soft cursor-pointer">
              📷 拍照 / 选图
            </span>
          </label>
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
          <label class="aspect-[4/3] rounded-2xl border-2 border-dashed border-slate-300 hover:border-brand-500 text-ink-500 hover:text-brand-600 flex flex-col items-center justify-center cursor-pointer transition">
            <input type="file" accept="image/*" capture="environment" class="hidden" id="__addphoto2"/>
            <div class="text-3xl">＋</div>
            <div class="text-xs mt-1">添加照片</div>
          </label>
        </div>
      `}
    </div>
  `;

  bindBack(() => go('rooms'));
  $('#__edit').onclick = () => openRoomDialog(room);
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
  $('#__addphoto1')?.addEventListener('change', e => addPhoto(e.target));
  $('#__addphoto2')?.addEventListener('change', e => addPhoto(e.target));
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
        <button id="__draw" class="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium shadow-soft ml-2">
          <span>✏️</span> <span class="hidden md:inline">手动框选</span><span class="md:hidden">框选</span>
        </button>
      `
    })}

    <div class="px-4 md:px-6 py-4">
      <!-- 移动端工具条 -->
      <div class="md:hidden flex gap-2 mb-3">
        <button id="__detect-m" class="flex-1 h-10 rounded-xl bg-white border border-slate-200 text-sm font-medium flex items-center justify-center gap-1">
          ✨ AI 识别柜子
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

  function renderBoxes() {
    boxesEl.innerHTML = cabinets.map((c, idx) => {
      const r = c.rect;
      return `
        <div class="cabinet-box" data-id="${c.id}"
          style="left:${r.x*100}%;top:${r.y*100}%;width:${r.w*100}%;height:${r.h*100}%;">
          <span class="label">${esc(c.name)}</span>
        </div>
      `;
    }).join('');
    boxesEl.querySelectorAll('.cabinet-box').forEach(b => {
      b.onclick = (e) => { e.stopPropagation(); openCabinetDialog(cabinets.find(c => c.id === b.dataset.id)); };
    });
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
          <div class="flex items-center justify-between">
            <span class="font-medium text-sm text-ink-900">🗄️ ${esc(c.name)}</span>
            <span class="chip">${items.length} 件</span>
          </div>
          ${items.length > 0 ? `
            <p class="text-xs text-ink-500 mt-1 truncate">${items.slice(0,5).map(i => esc(i.name)).join(' · ')}${items.length > 5 ? ' …' : ''}</p>
          ` : `<p class="text-xs text-ink-500 mt-1">点击添加物品</p>`}
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
    hint.textContent = '✨ AI 正在识别柜子…';
    try {
      const detected = await detectCabinets(photo.blob, { width: photo.width, height: photo.height });
      for (const d of detected) {
        const cab = { id: uid(), photoId, roomId: photo.roomId, name: d.name, rect: d.rect, createdAt: Date.now() };
        await db.add('cabinets', cab);
        cabinets.push(cab);
      }
      renderBoxes(); renderList();
      hint.textContent = `已识别 ${detected.length} 个候选柜子，点击任一柜子可重命名或调整。`;
      toast('AI 识别完成');
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
        <div id="item-list" class="space-y-2 max-h-64 overflow-y-auto mb-3">
          ${items.length === 0 ? `<p class="text-sm text-ink-500 text-center py-4">还没有物品，在下方添加</p>` : items.map(it => `
            <div class="flex items-center gap-2 bg-slate-50 rounded-xl p-2.5" data-iid="${it.id}">
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">${esc(it.name)}${it.qty > 1 ? ` <span class="text-ink-500 text-xs">×${it.qty}</span>` : ''}</div>
                ${it.note ? `<div class="text-xs text-ink-500 truncate">${esc(it.note)}</div>` : ''}
              </div>
              <button class="del-item w-8 h-8 rounded-lg hover:bg-red-50 text-red-500" title="删除">
                <svg class="mx-auto" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
            </div>
          `).join('')}
        </div>

        <form id="add-item-form" class="flex gap-2 items-center bg-brand-50 rounded-xl p-2">
          <input id="in" type="text" placeholder="物品名称，例如：吸尘器"
            class="flex-1 h-10 px-3 rounded-lg bg-white border border-transparent focus:border-brand-500 outline-none text-sm"/>
          <input id="iq" type="number" min="1" value="1" class="w-16 h-10 px-2 rounded-lg bg-white border border-transparent focus:border-brand-500 outline-none text-sm text-center"/>
          <button type="submit" class="h-10 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium">加入</button>
        </form>
        <input id="inote" type="text" placeholder="备注（可选，例如：第二层抽屉）"
          class="mt-2 w-full h-10 px-3 rounded-xl bg-slate-50 border border-transparent focus:border-brand-500 focus:bg-white outline-none text-sm"/>

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

    m.root.querySelector('#add-item-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = m.root.querySelector('#in').value.trim();
      if (!name) { toast('请填物品名'); return; }
      const qty = parseInt(m.root.querySelector('#iq').value) || 1;
      const note = m.root.querySelector('#inote').value.trim();
      await db.add('items', {
        id: uid(), cabinetId: cab.id, roomId: cab.roomId,
        name, qty, note, tags: [], createdAt: Date.now()
      });
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
  const [rooms, cabinets, items] = await Promise.all([
    db.all('rooms'), db.all('cabinets'), db.all('items')
  ]);
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

  app.innerHTML = `
    ${header({
      title: '所有物品',
      subtitle: items.length
        ? `${rooms.length} 个房间 · ${cabinets.length} 个柜子 · ${totalItems} 件物品`
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
                  <div class="flex flex-wrap gap-1.5 pl-12">
                    ${ci.items.map(it => `
                      <span class="inline-flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1 text-xs">
                        ${esc(it.name)}${it.qty > 1 ? `<span class="text-ink-500">×${it.qty}</span>` : ''}
                      </span>
                    `).join('')}
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
      const photo = cab ? photos.find(p => p.id === cab.photoId) : null;
      return `
        <button class="result w-full bg-white rounded-xl shadow-soft hover:shadow-lg transition p-3 flex items-center gap-3 text-left" data-photo="${cab?.photoId || ''}">
          ${photo ? `<img src="${blobURL(photo.blob, photo.id)}" class="w-14 h-14 rounded-lg object-cover"/>` : `<div class="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center text-xl">📦</div>`}
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm text-ink-900 truncate">${esc(it.name)}${it.qty > 1 ? ` <span class="text-ink-500 text-xs">×${it.qty}</span>` : ''}</div>
            <div class="text-xs text-ink-500 truncate">
              ${room ? `${room.icon || '🏠'} ${esc(room.name)} › 🗄️ ${esc(cab.name)}` : '（柜子已删除）'}
            </div>
            ${it.note ? `<div class="text-xs text-ink-500 mt-0.5 truncate">💭 ${esc(it.note)}</div>` : ''}
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
        <h3 class="text-sm font-semibold mb-3">🤖 AI 柜子识别</h3>
        <p class="text-xs text-ink-500">当前使用启发式占位算法（给出 2~3 个候选框）。接入真实视觉模型（GPT-4V / Claude Vision）只需改 <code class="bg-slate-100 px-1.5 py-0.5 rounded">app.js</code> 中的 <code class="bg-slate-100 px-1.5 py-0.5 rounded">detectCabinets()</code>。</p>
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
    urlCache.forEach(u => URL.revokeObjectURL(u));
    urlCache.clear();
    toast('已清空');
    go('rooms');
  });
}

/* ================================================================
 * 启动
 * ================================================================ */
// 底部 tab
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (btn) go(btn.dataset.route);
});

// 从 hash 恢复路由
try {
  if (location.hash.length > 1) {
    const r = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    if (r && r.name) state.route = r;
  }
} catch {}

(async () => {
  await initSync();
  await loadDemoData();
  render();
})();
