import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  GLOBAL_ROOM_ID,
  PRESET_TAGS,
  createItemList,
  expiryInfo,
  getItemLists,
  isLooseCabinet,
  type ItemList,
} from '@home-inventory/core';
import { Header } from '../components/Header';
import { ItemThumb } from '../components/ItemThumb';
import { EmptyState } from '../components/EmptyState';
import { PinIcon, roomIconName } from '../components/PinIcon';
import { Glyph } from '../components/Glyph';
import { openModal } from '../components/Modal';
import { toast } from '../components/Toast';
import { getStorage, useStore } from '../stores/useStore';
import ItemDialog from './modals/ItemDialog';

type Tab = 'lists' | 'tags' | 'cabinets';
const TAB_LABEL: Record<Tab, string> = {
  lists: '清单',
  tags: '标签',
  cabinets: '收纳柜',
};
const TABS: Tab[] = ['lists', 'tags', 'cabinets'];

const SUGGESTED_EMOJIS = ['🧳', '🌞', '❄️', '🏕️', '🏃', '💊', '👶', '🐶', '📚', '🎁', '🍳', '🛠️', '✈️', '🩹', '⛺'];

function CreateListDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (list: ItemList) => void }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🧳');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('请输入清单名称');
      return;
    }
    setBusy(true);
    try {
      const created = await createItemList(getStorage(), {
        name: trimmed,
        emoji,
        note: note.trim() || undefined,
      });
      onCreated(created);
      toast('已创建清单');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold inline-flex items-center gap-2">
          <PinIcon name="tag" size={28} />新建清单
        </h3>
        <button onClick={onClose} className="text-ink-500 text-xl">×</button>
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">清单名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：旅行必备清单"
            autoFocus
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">封面 Emoji</label>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`text-2xl w-10 h-10 rounded-lg border ${
                  emoji === e ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white'
                }`}
              >
                {e}
              </button>
            ))}
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
              placeholder="自定义"
              className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-center"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">备注（可选）</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="例如：出差 3 天必备"
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-ink-700">
          取消
        </button>
        <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-lg bg-brand-500 text-white font-medium disabled:opacity-50">
          创建
        </button>
      </div>
    </div>
  );
}

export default function ListsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const tab = (search.get('tab') as Tab) || 'lists';
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);
  const rooms = useStore((s) => s.rooms);

  const [lists, setLists] = useState<ItemList[]>([]);
  const [loadedLists, setLoadedLists] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagMode, setTagMode] = useState<'any' | 'all'>('any');

  const reloadLists = async () => {
    const data = await getItemLists(getStorage());
    setLists(data);
    setLoadedLists(true);
  };

  useEffect(() => {
    reloadLists();
  }, []);

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(search);
    params.set('tab', next);
    setSearch(params, { replace: true });
  };

  const allTags = useMemo(() => {
    const tagCount = new Map<string, number>();
    for (const it of items) {
      for (const t of it.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    }
    const presetNames = new Set(PRESET_TAGS.map((p) => p.name));
    return Array.from(tagCount.entries())
      .sort((a, b) => {
        const aPreset = presetNames.has(a[0]) ? 1 : 0;
        const bPreset = presetNames.has(b[0]) ? 1 : 0;
        if (aPreset !== bPreset) return bPreset - aPreset;
        return b[1] - a[1];
      })
      .map(([name, count]) => ({ name, count }));
  }, [items]);

  const toggleTag = (name: string) => {
    setSelectedTags((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const tagFilteredItems = useMemo(() => {
    if (selectedTags.size === 0) return [];
    return items.filter((it) => {
      const tags = it.tags || [];
      if (tagMode === 'all') return Array.from(selectedTags).every((t) => tags.includes(t));
      return tags.some((t) => selectedTags.has(t));
    });
  }, [items, selectedTags, tagMode]);

  const cabinetGroups = useMemo(() => {
    const normalCabs = cabinets.filter((c) => !isLooseCabinet(c));
    const byRoom = new Map<string, typeof normalCabs>();
    for (const cab of normalCabs) {
      const list = byRoom.get(cab.roomId) || [];
      list.push(cab);
      byRoom.set(cab.roomId, list);
    }
    return Array.from(byRoom.entries());
  }, [cabinets]);

  const onCreateList = () => {
    openModal((close) => (
      <CreateListDialog
        onClose={close}
        onCreated={(created) => {
          reloadLists();
          navigate(`/views/list/${created.id}`);
        }}
      />
    ));
  };

  return (
    <div>
      <Header
        title="视图"
        subtitle="清单 · 标签 · 收纳柜"
        actions={
          tab === 'lists' ? (
            <button
              onClick={onCreateList}
              className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm inline-flex items-center gap-1"
            >
              <Glyph name="plus" size={15} strokeWidth={1.8} />新建清单
            </button>
          ) : null
        }
      />

      <div className="px-4 md:px-6">
        {/* Segmented control */}
        <div className="inline-flex rounded-full bg-paper-200 p-1 mb-4">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-1.5 rounded-full text-sm font-medium transition ${
                tab === t ? 'bg-white shadow-soft text-ink-900' : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {tab === 'lists' && (
          <ListsTab lists={lists} items={items} loaded={loadedLists} onCreate={onCreateList} navigate={navigate} />
        )}

        {tab === 'tags' && (
          <TagsTab
            allTags={allTags}
            selectedTags={selectedTags}
            tagMode={tagMode}
            setTagMode={setTagMode}
            toggleTag={toggleTag}
            tagFilteredItems={tagFilteredItems}
            rooms={rooms}
            cabinets={cabinets}
          />
        )}

        {tab === 'cabinets' && (
          <CabinetsTab cabinetGroups={cabinetGroups} rooms={rooms} items={items} navigate={navigate} />
        )}
      </div>
    </div>
  );
}

/* ---------------- 清单 tab ---------------- */
function ListsTab({
  lists,
  items,
  loaded,
  onCreate,
  navigate,
}: {
  lists: ItemList[];
  items: ReturnType<typeof useStore.getState>['items'];
  loaded: boolean;
  onCreate: () => void;
  navigate: (path: string) => void;
}) {
  if (!loaded) {
    return <div className="py-12 text-center text-sm text-ink-400">加载中…</div>;
  }
  if (lists.length === 0) {
    return (
      <EmptyState
        icon="tag"
        title="还没有清单"
        description="把「旅行必备 / 急救包 / 出差包」建成清单，手动添加物品，一键查看"
        action={
          <button
            onClick={onCreate}
            className="px-5 py-2.5 rounded-full bg-brand-500 text-white inline-flex items-center gap-2 text-sm"
          >
            <Glyph name="plus" size={15} strokeWidth={1.8} />新建清单
          </button>
        }
      />
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {lists.map((list) => {
        const validIds = list.itemIds.filter((id) => items.some((it) => it.id === id));
        return (
          <button
            key={list.id}
            onClick={() => navigate(`/views/list/${list.id}`)}
            className="text-left bg-white rounded-2xl shadow-soft p-4 hover:shadow-md transition flex items-start gap-3"
          >
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl"
              style={{
                background: `linear-gradient(135deg, hsl(${(list.id.length * 31) % 360},88%,90%), hsl(${
                  (list.id.length * 31 + 30) % 360
                },80%,80%))`,
              }}
            >
              {list.emoji || '🧳'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{list.name}</div>
              {list.note && <div className="text-[11px] text-ink-400 mt-1 truncate">{list.note}</div>}
              <div className="text-[11px] text-brand-700 mt-2">{validIds.length} 件物品 ›</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- 标签 tab ---------------- */
function TagsTab({
  allTags,
  selectedTags,
  tagMode,
  setTagMode,
  toggleTag,
  tagFilteredItems,
  rooms,
  cabinets,
}: {
  allTags: Array<{ name: string; count: number }>;
  selectedTags: Set<string>;
  tagMode: 'any' | 'all';
  setTagMode: (m: 'any' | 'all') => void;
  toggleTag: (n: string) => void;
  tagFilteredItems: ReturnType<typeof useStore.getState>['items'];
  rooms: ReturnType<typeof useStore.getState>['rooms'];
  cabinets: ReturnType<typeof useStore.getState>['cabinets'];
}) {
  if (allTags.length === 0) {
    return (
      <EmptyState
        icon="tag"
        title="还没有标签"
        description="去物品页给物品打上「药品 / 食品 / 数码」等标签，这里就会出现"
      />
    );
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-ink-500">命中规则</span>
        <div className="inline-flex rounded-full bg-paper-200 p-0.5">
          <button
            onClick={() => setTagMode('any')}
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              tagMode === 'any' ? 'bg-white shadow-soft text-ink-900' : 'text-ink-500'
            }`}
          >
            任一
          </button>
          <button
            onClick={() => setTagMode('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              tagMode === 'all' ? 'bg-white shadow-soft text-ink-900' : 'text-ink-500'
            }`}
          >
            全包含
          </button>
        </div>
        {selectedTags.size > 0 && (
          <button
            onClick={() => selectedTags.forEach((t) => toggleTag(t))}
            className="ml-auto text-xs text-ink-500 underline"
          >
            清空 ({selectedTags.size})
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {allTags.map(({ name, count }) => {
          const active = selectedTags.has(name);
          const presetEmoji = PRESET_TAGS.find((p) => p.name === name)?.emoji;
          return (
            <button
              key={name}
              onClick={() => toggleTag(name)}
              className={`chip text-xs ${active ? '!bg-brand-500 !text-white' : '!bg-slate-100 !text-ink-700'}`}
            >
              {presetEmoji && <span className="mr-1">{presetEmoji}</span>}
              {name}
              <span className={`ml-1 ${active ? 'text-white/80' : 'text-ink-400'}`}>·{count}</span>
            </button>
          );
        })}
      </div>

      {selectedTags.size === 0 ? (
        <div className="py-12 text-center text-sm text-ink-400">选择标签查看物品</div>
      ) : tagFilteredItems.length === 0 ? (
        <EmptyState icon="tag" title="没有命中的物品" description="试试切换「任一」模式或选择其他标签" />
      ) : (
        <ItemGrid items={tagFilteredItems} rooms={rooms} cabinets={cabinets} />
      )}
    </div>
  );
}

/* ---------------- 收纳柜 tab ---------------- */
function CabinetsTab({
  cabinetGroups,
  rooms,
  items,
  navigate,
}: {
  cabinetGroups: Array<[string, ReturnType<typeof useStore.getState>['cabinets']]>;
  rooms: ReturnType<typeof useStore.getState>['rooms'];
  items: ReturnType<typeof useStore.getState>['items'];
  navigate: (path: string) => void;
}) {
  if (cabinetGroups.length === 0) {
    return (
      <EmptyState
        icon="cabinet"
        title="还没有收纳柜"
        description="先到房间页拍照建立柜子，这里会显示所有柜子的入口"
      />
    );
  }
  return (
    <div className="space-y-5">
      {cabinetGroups.map(([roomId, cabs]) => {
        const room = rooms.find((r) => r.id === roomId);
        const roomName = roomId === GLOBAL_ROOM_ID ? '全屋自由区' : room?.name || '未知房间';
        return (
          <section key={roomId}>
            <div className="font-semibold mb-2 inline-flex items-center gap-2">
              <PinIcon name={room ? roomIconName(room.icon) : 'box'} size={26} />
              {roomName}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {cabs.map((cab) => {
                const cnt = items.filter((it) => it.cabinetId === cab.id).length;
                return (
                  <button
                    key={cab.id}
                    onClick={() => navigate(`/room/${cab.roomId}`)}
                    className="text-left bg-white rounded-2xl shadow-soft p-3 hover:shadow-md transition"
                  >
                    <div className="inline-flex items-center gap-2 mb-1">
                      <PinIcon name="cabinet" size={22} />
                      <span className="font-medium truncate">{cab.name}</span>
                    </div>
                    <div className="text-xs text-ink-500">{cnt} 件物品</div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------- 物品网格（按房间→柜子分组） ---------------- */
function ItemGrid({
  items,
  rooms,
  cabinets,
}: {
  items: ReturnType<typeof useStore.getState>['items'];
  rooms: ReturnType<typeof useStore.getState>['rooms'];
  cabinets: ReturnType<typeof useStore.getState>['cabinets'];
}) {
  const grouped = useMemo(() => {
    const roomMap = new Map<string, Map<string, typeof items>>();
    for (const item of items) {
      const cabinet = cabinets.find((c) => c.id === item.cabinetId);
      const roomId = item.roomId || cabinet?.roomId || GLOBAL_ROOM_ID;
      const cabinetId = item.cabinetId || '__unknown__';
      if (!roomMap.has(roomId)) roomMap.set(roomId, new Map());
      const cabMap = roomMap.get(roomId)!;
      cabMap.set(cabinetId, [...(cabMap.get(cabinetId) || []), item]);
    }
    return Array.from(roomMap.entries());
  }, [items, cabinets]);

  return (
    <div className="space-y-5">
      {grouped.map(([roomId, cabMap]) => {
        const room = rooms.find((r) => r.id === roomId);
        return (
          <section key={roomId}>
            <div className="font-semibold mb-2 inline-flex items-center gap-2">
              <PinIcon name={room ? roomIconName(room.icon) : 'box'} size={26} />
              {room ? room.name : '全屋自由区'}
            </div>
            <div className="space-y-3">
              {Array.from(cabMap.entries()).map(([cabinetId, list]) => {
                const cabinet = cabinets.find((c) => c.id === cabinetId);
                return (
                  <div key={cabinetId} className="bg-white rounded-2xl shadow-soft p-3">
                    <div className="text-sm font-medium text-ink-700 mb-2 inline-flex items-center gap-2">
                      <PinIcon name="cabinet" size={22} />
                      {cabinet?.name || '未知柜子'} · {list.length} 件
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {list.map((item) => {
                        const info = expiryInfo(item.expiry);
                        return (
                          <button
                            key={item.id}
                            onClick={() => openModal((close) => <ItemDialog item={item} onClose={close} />)}
                            className="text-left bg-slate-50 rounded-xl p-2 hover:bg-slate-100"
                          >
                            <ItemThumb item={item} className="w-full aspect-square rounded-lg mb-2" />
                            <div className="font-medium text-sm truncate">{item.name}</div>
                            <div className="text-xs text-ink-500">× {item.qty}</div>
                            {info && (
                              <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border ${info.cls}`}>
                                {info.label}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
