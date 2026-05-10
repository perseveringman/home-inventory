/* ================================================================
 * storage.js —— 文件夹式数据结构的序列化 / 反序列化
 *
 * 目标：把 IndexedDB 里的房间/照片/柜子/物品导出为以下文件树，
 *       或从该文件树读回 IndexedDB。
 *
 * home-inventory/
 * ├── inventory.json             总索引（AI 先读）
 * ├── README.md                  给人看的说明
 * ├── .meta/
 * │   ├── schema.json            JSON Schema
 * │   └── ai-prompt.md           拖给 AI 的提示词
 * ├── rooms/<room-slug>/
 * │   ├── room.md                房间元数据
 * │   ├── photos/
 * │   │   ├── <slug>.jpg
 * │   │   └── <slug>.json        柜子坐标
 * │   └── cabinets/<cab-slug>.md
 * └── items/index.json           反向索引
 * ================================================================ */

/* ---------- slug 工具 ---------- */
// 中文字符 → 尽量转拼音风格的可读 slug；无拼音库时退化成保留中文的 url-safe 字符
// 为了零依赖，中文会保留，非 ASCII 字符直接 URL 编码友好化处理
function toSlug(raw, fallback = 'item') {
  if (!raw) return fallback;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/[\s_/\\]+/g, '-');
  s = s.replace(/[^\p{L}\p{N}\-]/gu, ''); // 保留字母/数字/连字符（含中文）
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || fallback;
}
function uniqueSlug(base, taken) {
  let s = base, i = 2;
  while (taken.has(s)) s = `${base}-${i++}`;
  taken.add(s);
  return s;
}

/* ---------- frontmatter ---------- */
// 极简 YAML：只支持 key: value / key: [a, b] / 嵌套一层 dict
function toYAML(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${pad}${k}: [${v.map(x => yamlLeaf(x)).join(', ')}]`);
    } else if (typeof v === 'object') {
      lines.push(`${pad}${k}:`);
      lines.push(toYAML(v, indent + 2));
    } else {
      lines.push(`${pad}${k}: ${yamlLeaf(v)}`);
    }
  }
  return lines.join('\n');
}
function yamlLeaf(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  // 需要引号的情况：含冒号、井号、首字符特殊
  if (/[:#\[\]{}&*!|>'"%@`,]/.test(s) || /^\s|\s$/.test(s) || s === '') {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  const stack = [{ obj: meta, indent: -1 }];
  for (const rawLine of m[1].split('\n')) {
    if (!rawLine.trim()) continue;
    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.slice(indent);
    const mm = line.match(/^([^:]+):\s*(.*)$/);
    if (!mm) continue;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const key = mm[1].trim();
    const rest = mm[2].trim();
    if (rest === '') {
      const child = {};
      parent[key] = child;
      stack.push({ obj: child, indent });
    } else if (/^\[.*\]$/.test(rest)) {
      parent[key] = rest.slice(1, -1).split(',').map(x => parseLeaf(x.trim())).filter(x => x !== '');
    } else {
      parent[key] = parseLeaf(rest);
    }
  }
  return { meta, body: m[2] };
}
function parseLeaf(s) {
  if (s === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return s;
}

/* ---------- Blob ⇄ base64 ---------- */
function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
async function dataURLToBlob(dataUrl) { return (await fetch(dataUrl)).blob(); }

/* ================================================================
 * 序列化：从内存数据（rooms/photos/cabinets/items）构建文件描述列表
 * 返回 [{ path, content: string | Blob }]
 * 由 FS Access API 或 ZIP 层决定怎么落盘。
 * ================================================================ */
function buildFileTree({ rooms, photos, cabinets, items }) {
  const files = [];
  const roomSlugs = new Map();     // roomId -> slug
  const photoSlugs = new Map();    // photoId -> slug（仅文件名）
  const cabSlugs = new Map();      // cabId -> slug

  // 分配 slug（每个房间独立命名空间）
  const globalRoomSlugs = new Set();
  for (const r of rooms) {
    const base = toSlug(r.name, 'room');
    roomSlugs.set(r.id, uniqueSlug(base, globalRoomSlugs));
  }
  for (const r of rooms) {
    const rSlug = roomSlugs.get(r.id);
    const photoNS = new Set();
    const cabNS = new Set();
    const rPhotos = photos.filter(p => p.roomId === r.id)
                          .sort((a, b) => a.createdAt - b.createdAt);
    const rCabs = cabinets.filter(c => c.roomId === r.id);

    rPhotos.forEach((p, i) => {
      const d = new Date(p.createdAt);
      const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      photoSlugs.set(p.id, uniqueSlug(`${stamp}-photo-${i+1}`, photoNS));
    });
    rCabs.forEach(c => {
      const base = toSlug(c.name, 'cabinet');
      cabSlugs.set(c.id, uniqueSlug(base, cabNS));
    });
  }

  /* ---- inventory.json ---- */
  const stats = {
    rooms: rooms.length, photos: photos.length,
    cabinets: cabinets.length,
    items: items.length,
    total_qty: items.reduce((s, i) => s + (i.qty || 1), 0),
  };
  const inventory = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    stats,
    rooms: rooms.map(r => {
      const slug = roomSlugs.get(r.id);
      const rCabs = cabinets.filter(c => c.roomId === r.id);
      const rItems = items.filter(i => i.roomId === r.id);
      return {
        slug, name: r.name, icon: r.icon || '🏠',
        path: `rooms/${slug}/`,
        photos: photos.filter(p => p.roomId === r.id).length,
        cabinets: rCabs.length,
        items: rItems.length,
      };
    }),
  };
  files.push({ path: 'inventory.json', content: JSON.stringify(inventory, null, 2) });

  /* ---- README.md ---- */
  files.push({ path: 'README.md', content: buildReadme(inventory) });

  /* ---- .meta ---- */
  files.push({ path: '.meta/schema.json', content: JSON.stringify(SCHEMA, null, 2) });
  files.push({ path: '.meta/ai-prompt.md', content: AI_PROMPT });

  /* ---- 每个房间 ---- */
  for (const r of rooms) {
    const rSlug = roomSlugs.get(r.id);
    const rPath = `rooms/${rSlug}`;
    const rPhotos = photos.filter(p => p.roomId === r.id);
    const rCabs = cabinets.filter(c => c.roomId === r.id);
    const rItems = items.filter(i => i.roomId === r.id);

    // room.md
    const roomMeta = {
      id: r.id, slug: rSlug, name: r.name, icon: r.icon || '🏠',
      created_at: new Date(r.createdAt).toISOString(),
      cabinets: rCabs.length, items: rItems.length,
    };
    const roomBody = `# ${r.icon || '🏠'} ${r.name}\n\n` +
      `这个房间有 **${rCabs.length} 个柜子**，共记录了 **${rItems.length} 件物品**。\n\n` +
      `## 柜子列表\n\n` +
      (rCabs.length ? rCabs.map(c => `- [${c.name}](cabinets/${cabSlugs.get(c.id)}.md)`).join('\n') + '\n'
                    : '_尚未标注任何柜子。_\n');
    files.push({
      path: `${rPath}/room.md`,
      content: `---\n${toYAML(roomMeta)}\n---\n\n${roomBody}`
    });

    // 照片 + 同名 json
    for (const p of rPhotos) {
      const pSlug = photoSlugs.get(p.id);
      files.push({ path: `${rPath}/photos/${pSlug}.jpg`, content: p.blob });
      const pCabs = rCabs.filter(c => c.photoId === p.id).map(c => ({
        id: c.id, slug: cabSlugs.get(c.id), name: c.name,
        rect: [
          +c.rect.x.toFixed(4), +c.rect.y.toFixed(4),
          +c.rect.w.toFixed(4), +c.rect.h.toFixed(4)
        ],
      }));
      const pMeta = {
        id: p.id, photo: `${pSlug}.jpg`,
        width: p.width, height: p.height,
        taken_at: new Date(p.createdAt).toISOString(),
        cabinets: pCabs,
      };
      files.push({ path: `${rPath}/photos/${pSlug}.json`, content: JSON.stringify(pMeta, null, 2) });
    }

    // 柜子 md
    for (const c of rCabs) {
      const cSlug = cabSlugs.get(c.id);
      const cItems = items.filter(i => i.cabinetId === c.id);
      const photo = rPhotos.find(p => p.id === c.photoId);
      const meta = {
        id: c.id, slug: cSlug, name: c.name,
        room: r.name, room_slug: rSlug,
        photo: photo ? `../photos/${photoSlugs.get(photo.id)}.jpg` : '',
        rect: [
          +c.rect.x.toFixed(4), +c.rect.y.toFixed(4),
          +c.rect.w.toFixed(4), +c.rect.h.toFixed(4)
        ],
        updated_at: new Date(c.createdAt).toISOString(),
        item_count: cItems.length,
      };
      let body = `# 🗄️ ${c.name}\n\n`;
      body += `位于 **${r.icon || ''} ${r.name}**，共 **${cItems.length} 件物品**。\n\n`;
      body += `## 物品清单\n\n`;
      if (cItems.length === 0) {
        body += '_暂无物品。_\n';
      } else {
        for (const it of cItems) {
          const qty = (it.qty || 1) > 1 ? ` × ${it.qty}` : '';
          const note = it.note ? ` — ${it.note}` : '';
          const tags = (it.tags && it.tags.length) ? ` \`${it.tags.join('` `')}\`` : '';
          body += `- ${it.name}${qty}${note}${tags}\n`;
        }
      }
      files.push({
        path: `${rPath}/cabinets/${cSlug}.md`,
        content: `---\n${toYAML(meta)}\n---\n\n${body}`
      });
    }
  }

  /* ---- items/index.json ---- */
  const itemIndex = {};
  for (const it of items) {
    const cab = cabinets.find(c => c.id === it.cabinetId);
    const room = cab && rooms.find(r => r.id === cab.roomId);
    if (!cab || !room) continue;
    const location = `${roomSlugs.get(room.id)}/${cabSlugs.get(cab.id)}`;
    itemIndex[it.name] = itemIndex[it.name] || [];
    itemIndex[it.name].push({
      qty: it.qty || 1,
      location,
      room: room.name, cabinet: cab.name,
      note: it.note || '',
    });
  }
  files.push({ path: 'items/index.json', content: JSON.stringify(itemIndex, null, 2) });

  return files;
}

/* ---------- 模板常量 ---------- */
const SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Home Inventory Schema",
  description: "家居收纳数据结构。每个房间是 rooms/<slug>/ 下一个目录，每个柜子是一个 md 文件（含 frontmatter）。",
  files: {
    "inventory.json": "所有房间的总索引，AI 应先读此文件了解数据总览。",
    "rooms/<room-slug>/room.md": "房间元信息（YAML frontmatter）+ 柜子列表（markdown）。",
    "rooms/<room-slug>/photos/<slug>.jpg": "房间照片原图。",
    "rooms/<room-slug>/photos/<slug>.json": "照片元信息，关键字段 cabinets[].rect 是 [x,y,w,h] 归一化坐标 (0~1)。",
    "rooms/<room-slug>/cabinets/<slug>.md": "单个柜子的物品清单（Markdown），frontmatter 含 name/room/photo/rect。",
    "items/index.json": "以物品名为键的反向索引，value 是所在位置列表。"
  },
  rect_format: "[x, y, w, h]，均为 0~1 归一化浮点数。原点在图片左上角，x 向右、y 向下。"
};

const AI_PROMPT = `# 家居收纳数据 · AI 分析指南

你正在查看一个**家居物品档案**，结构如下：

- \`inventory.json\` — **先读这个**，了解有几个房间、每个房间多少柜子和物品。
- \`rooms/<房间 slug>/room.md\` — 每个房间的元数据和柜子索引。
- \`rooms/<房间 slug>/cabinets/<柜子 slug>.md\` — **每个柜子一个 Markdown 文件**，包含该柜子里的物品清单。这是核心内容。
- \`rooms/<房间 slug>/photos/<照片 slug>.json\` — 照片上柜子的归一化坐标。
- \`items/index.json\` — 以物品名为键的反向索引，**查找物品位置时先读这里**。

## 常见问题应答思路

**"XX 在哪？"**
→ 查 \`items/index.json\`，定位到 \`<房间>/<柜子>\`，读对应的 \`cabinets/*.md\` 给出完整上下文。

**"XX 还有几个？"**
→ \`items/index.json\` 里每条记录的 \`qty\` 字段直接给数量；如果有多个位置，分别列出。

**"XX 房间都有什么？"**
→ 读 \`rooms/<slug>/room.md\` 拿柜子列表，然后依次读 \`cabinets/*.md\` 汇总。

**"帮我盘点重复或可以丢的物品"**
→ 遍历所有 \`cabinets/*.md\` 提取物品清单，交叉分析重复项、低频物品、备注里提到"坏了/闲置"的条目。

## 数据格式约定

- 柜子 Markdown 的 frontmatter 里 \`rect: [x, y, w, h]\` 是该柜子在照片上的归一化坐标（0~1）。
- 物品清单在 \`## 物品清单\` 章节下，每行一个物品，格式：\`- 名称 [× 数量] [— 备注] [\\\`标签\\\`]\`
- 所有时间戳都是 ISO 8601 格式。

## 回复风格

回答"XX 在哪"类问题时，给出具体的**房间 → 柜子 → 备注位置**链路，比如：
> 吸尘器在 📚 书房 → 🗄️ 左侧书柜 → 第二层抽屉（1 件）
`;

function buildReadme(inventory) {
  const lines = [];
  lines.push(`# 🏠 家居物品档案`);
  lines.push('');
  lines.push(`> 生成于 ${inventory.generated_at}`);
  lines.push('');
  lines.push(`共 **${inventory.stats.rooms}** 个房间 · **${inventory.stats.cabinets}** 个柜子 · **${inventory.stats.total_qty}** 件物品`);
  lines.push('');
  lines.push('## 房间列表');
  lines.push('');
  for (const r of inventory.rooms) {
    lines.push(`- ${r.icon} **[${r.name}](${r.path}room.md)** — ${r.cabinets} 个柜子 · ${r.items} 件物品`);
  }
  lines.push('');
  lines.push('## 数据结构');
  lines.push('');
  lines.push('```');
  lines.push('inventory.json         总索引（AI 先读这个）');
  lines.push('rooms/<slug>/');
  lines.push('  ├── room.md          房间元数据');
  lines.push('  ├── photos/*.jpg     原图');
  lines.push('  ├── photos/*.json    柜子坐标');
  lines.push('  └── cabinets/*.md    每个柜子的物品清单');
  lines.push('items/index.json       反向索引（按物品名查位置）');
  lines.push('.meta/ai-prompt.md     给 AI 的分析指南（拖进 Claude/ChatGPT 即可用）');
  lines.push('```');
  lines.push('');
  lines.push('## 给 AI 用');
  lines.push('');
  lines.push('把整个文件夹（或 ZIP）拖给任意大模型，并附上 `.meta/ai-prompt.md` 作为系统提示，即可问：');
  lines.push('');
  lines.push('- "吸尘器在哪？"');
  lines.push('- "耶诞灯还有几个？"');
  lines.push('- "书房都有什么东西？"');
  lines.push('- "帮我盘点有哪些重复的物品"');
  return lines.join('\n');
}

/* ================================================================
 * 反序列化：从文件树重建内存对象
 * 输入：[{ path, getText(): Promise<string>, getBlob(): Promise<Blob> }]
 * 输出：{ rooms, photos, cabinets, items }
 * ================================================================ */
async function parseFileTree(files) {
  const rooms = [], photos = [], cabinets = [], items = [];
  const byPath = new Map(files.map(f => [f.path, f]));

  // 1. inventory.json 拿房间列表
  const invFile = byPath.get('inventory.json');
  if (!invFile) throw new Error('缺少 inventory.json');
  const inv = JSON.parse(await invFile.getText());

  const slugToRoomId = new Map();
  const slugToCabId = new Map();

  // 2. 每个房间
  for (const rMeta of inv.rooms) {
    // room.md
    const roomFile = byPath.get(`rooms/${rMeta.slug}/room.md`);
    if (!roomFile) continue;
    const { meta: rm } = parseFrontmatter(await roomFile.getText());
    const roomId = rm.id || ('r-' + rMeta.slug);
    slugToRoomId.set(rMeta.slug, roomId);
    rooms.push({
      id: roomId,
      name: rm.name || rMeta.name,
      icon: rm.icon || rMeta.icon || '🏠',
      createdAt: rm.created_at ? new Date(rm.created_at).getTime() : Date.now(),
    });

    // 照片
    const photoFiles = files.filter(f => f.path.startsWith(`rooms/${rMeta.slug}/photos/`) && f.path.endsWith('.jpg'));
    for (const pf of photoFiles) {
      const base = pf.path.replace(/\.jpg$/, '');
      const metaFile = byPath.get(base + '.json');
      if (!metaFile) continue;
      const pm = JSON.parse(await metaFile.getText());
      const photoId = pm.id || ('p-' + base);
      photos.push({
        id: photoId,
        roomId,
        blob: await pf.getBlob(),
        width: pm.width, height: pm.height,
        createdAt: pm.taken_at ? new Date(pm.taken_at).getTime() : Date.now(),
      });
      // 照片里的柜子坐标 —— 柜子实际内容由 md 决定，这里只记录 rect
      for (const c of (pm.cabinets || [])) {
        slugToCabId.set(`${rMeta.slug}/${c.slug}`, c.id || ('c-' + rMeta.slug + '-' + c.slug));
      }
    }

    // 柜子 md
    const cabFiles = files.filter(f => f.path.startsWith(`rooms/${rMeta.slug}/cabinets/`) && f.path.endsWith('.md'));
    for (const cf of cabFiles) {
      const text = await cf.getText();
      const { meta: cm, body } = parseFrontmatter(text);
      const slug = cm.slug || cf.path.split('/').pop().replace(/\.md$/, '');
      const cabId = cm.id || slugToCabId.get(`${rMeta.slug}/${slug}`) || ('c-' + rMeta.slug + '-' + slug);
      slugToCabId.set(`${rMeta.slug}/${slug}`, cabId);

      // 找到对应的 photoId（通过 cm.photo 字段回查）
      let photoId = '';
      if (cm.photo) {
        const phName = cm.photo.split('/').pop().replace(/\.jpg$/, '');
        const p = photos.find(pp => pp.roomId === roomId &&
          files.some(f => f.path === `rooms/${rMeta.slug}/photos/${phName}.jpg`) && pp.id);
        // 更可靠：从 photos/*.json 里匹配 cabinets[].id === cabId
        for (const pf of photoFiles) {
          const base = pf.path.replace(/\.jpg$/, '');
          const metaFile = byPath.get(base + '.json');
          if (!metaFile) continue;
          const pm = JSON.parse(await metaFile.getText());
          if ((pm.cabinets || []).some(cc => cc.id === cabId || cc.slug === slug)) {
            photoId = pm.id || ('p-' + base);
            break;
          }
        }
      }

      const rect = Array.isArray(cm.rect) ? cm.rect : [0.1, 0.1, 0.3, 0.3];
      cabinets.push({
        id: cabId,
        photoId,
        roomId,
        name: cm.name || slug,
        rect: { x: +rect[0], y: +rect[1], w: +rect[2], h: +rect[3] },
        createdAt: cm.updated_at ? new Date(cm.updated_at).getTime() : Date.now(),
      });

      // 解析物品清单（## 物品清单 章节）
      const itemsSection = body.split(/^##\s+物品清单\s*$/m)[1];
      if (itemsSection) {
        const lines = itemsSection.split('\n').map(l => l.trim());
        for (const line of lines) {
          const m = line.match(/^-\s+(.+)$/);
          if (!m) continue;
          let rest = m[1];
          // 提取 tags（反引号里的）
          const tags = [...rest.matchAll(/`([^`]+)`/g)].map(x => x[1]);
          rest = rest.replace(/`[^`]+`/g, '').trim();
          // 备注（— 之后）
          let note = '';
          const noteMatch = rest.match(/\s+[—\-]\s+(.+)$/);
          if (noteMatch) { note = noteMatch[1].trim(); rest = rest.slice(0, noteMatch.index).trim(); }
          // 数量（× N）
          let qty = 1;
          const qtyMatch = rest.match(/\s*[×x]\s*(\d+)\s*$/);
          if (qtyMatch) { qty = parseInt(qtyMatch[1]); rest = rest.slice(0, qtyMatch.index).trim(); }
          const name = rest.trim();
          if (!name) continue;
          items.push({
            id: 'i-' + Math.random().toString(36).slice(2, 10),
            cabinetId: cabId,
            roomId,
            name, qty, note, tags,
            createdAt: Date.now(),
          });
        }
      }
    }
  }

  return { rooms, photos, cabinets, items };
}

/* ================================================================
 * File System Access API 适配层（Chrome / Edge）
 * ================================================================ */
const FSA_SUPPORTED = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

async function writeTreeToDirectory(rootHandle, files, onProgress) {
  // 先清空旧内容（只清理我们管理的目录，避免误删用户其他文件）
  const ours = new Set(['inventory.json', 'README.md', '.meta', 'rooms', 'items']);
  for await (const [name, handle] of rootHandle.entries()) {
    if (ours.has(name)) {
      await rootHandle.removeEntry(name, { recursive: true }).catch(() => {});
    }
  }
  let done = 0;
  for (const f of files) {
    await writeFile(rootHandle, f.path, f.content);
    done++;
    onProgress && onProgress(done, files.length, f.path);
  }
}

async function writeFile(root, path, content) {
  const parts = path.split('/');
  const name = parts.pop();
  let dir = root;
  for (const seg of parts) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const w = await fileHandle.createWritable();
  if (content instanceof Blob) {
    await w.write(content);
  } else {
    await w.write(new Blob([content], { type: guessMime(path) }));
  }
  await w.close();
}

function guessMime(path) {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return 'text/plain';
}

async function readTreeFromDirectory(rootHandle) {
  const files = [];
  await walk(rootHandle, '', files);
  return files.map(({ path, handle }) => ({
    path,
    getText: async () => (await handle.getFile()).text(),
    getBlob: async () => handle.getFile(),
  }));
}

async function walk(dirHandle, prefix, out) {
  for await (const [name, handle] of dirHandle.entries()) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'file') out.push({ path: p, handle });
    else if (handle.kind === 'directory') await walk(handle, p, out);
  }
}

/* ---------- Handle 持久化（IndexedDB） ---------- */
const HANDLE_DB = 'home-inventory-handles';
function openHandleDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(HANDLE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function saveHandle(key, handle) {
  const db = await openHandleDB();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(handle, key);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
async function loadHandle(key) {
  const db = await openHandleDB();
  return new Promise((res, rej) => {
    const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function clearHandle(key) {
  const db = await openHandleDB();
  return new Promise((res) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').delete(key);
    t.oncomplete = res;
  });
}

/* ================================================================
 * ZIP 导出（手搓最小 ZIP，无依赖）
 * 兼容 Safari / 手机浏览器
 * ================================================================ */
async function filesToZipBlob(files) {
  // CRC32
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (u8) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = encoder.encode(f.path);
    let dataBytes;
    if (f.content instanceof Blob) {
      dataBytes = new Uint8Array(await f.content.arrayBuffer());
    } else {
      dataBytes = encoder.encode(String(f.content));
    }
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);     // signature
    dv.setUint16(4, 20, true);              // version
    dv.setUint16(6, 0x0800, true);          // flags (UTF-8)
    dv.setUint16(8, 0, true);               // method: stored
    dv.setUint16(10, 0, true);              // time
    dv.setUint16(12, 0, true);              // date
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);           // compressed size
    dv.setUint32(22, size, true);           // uncompressed size
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local, dataBytes);

    // Central directory entry
    const cd = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + dataBytes.length;
  }

  const cdStart = offset;
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, cdStart, true);

  return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}

async function zipBlobToFiles(zipBlob) {
  const buf = new Uint8Array(await zipBlob.arrayBuffer());
  const decoder = new TextDecoder();
  const files = [];
  // 找 EOCD（从尾部向前）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x05 && buf[i+3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
  const edv = new DataView(buf.buffer, eocd);
  const cdCount = edv.getUint16(10, true);
  const cdSize = edv.getUint32(12, true);
  const cdStart = edv.getUint32(16, true);
  let p = cdStart;
  for (let i = 0; i < cdCount; i++) {
    const cdv = new DataView(buf.buffer, p);
    if (cdv.getUint32(0, true) !== 0x02014b50) throw new Error('中央目录损坏');
    const method = cdv.getUint16(10, true);
    const size = cdv.getUint32(24, true);
    const nameLen = cdv.getUint16(28, true);
    const extraLen = cdv.getUint16(30, true);
    const commentLen = cdv.getUint16(32, true);
    const localOffset = cdv.getUint32(42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (method !== 0) throw new Error(`不支持的压缩方法（${name}），请确认 ZIP 由本应用导出`);
    const ldv = new DataView(buf.buffer, localOffset);
    const localNameLen = ldv.getUint16(26, true);
    const localExtraLen = ldv.getUint16(28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + size);
    files.push({
      path: name,
      getText: async () => decoder.decode(data),
      getBlob: async () => new Blob([data], { type: guessMime(name) }),
    });
  }
  return files;
}

/* ---------- 导出给外部使用 ---------- */
window.HIStorage = {
  // 序列化
  buildFileTree,
  parseFileTree,
  // FS Access
  FSA_SUPPORTED,
  writeTreeToDirectory,
  readTreeFromDirectory,
  saveHandle, loadHandle, clearHandle,
  // ZIP
  filesToZipBlob,
  zipBlobToFiles,
  // 工具
  toSlug,
};
