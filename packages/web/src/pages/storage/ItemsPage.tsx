import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GLOBAL_ROOM_ID, PRESET_TAGS, expiryInfo, type Item } from '@home-inventory/core';
import { ItemThumb } from '../../components/ItemThumb';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { openModal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import { useStore } from '../../stores/useStore';
import ItemDialog from '../modals/ItemDialog';
import { PinIcon, roomIconName } from '../../components/PinIcon';
import { Glyph } from '../../components/Glyph';

type FilterKey = 'placed' | 'pending' | string;

export default function ItemsPage() {
  const navigate = useNavigate();
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);
  const rooms = useStore((s) => s.rooms);
  const del = useStore((s) => s.del);
  const [filter, setFilter] = useState<FilterKey>('placed');

  const allTags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags || []))), [items]);
  const filtered = useMemo(() => {
    let list = items.slice();
    if (filter === 'pending') list = list.filter((item) => item.status === 'pending');
    else if (filter === 'placed') list = list.filter((item) => item.status !== 'pending');
    else list = list.filter((item) => item.status !== 'pending' && item.tags?.includes(filter));
    return list.sort((a, b) => (b.lastTouchedAt || b.createdAt) - (a.lastTouchedAt || a.createdAt));
  }, [items, filter]);

  const grouped = useMemo(() => {
    const roomMap = new Map<string, Map<string, Item[]>>();
    for (const item of filtered) {
      const cabinet = cabinets.find((c) => c.id === item.cabinetId);
      const roomId = item.roomId || cabinet?.roomId || GLOBAL_ROOM_ID;
      const cabinetId = item.cabinetId || '__unknown__';
      if (!roomMap.has(roomId)) roomMap.set(roomId, new Map());
      const cabinetMap = roomMap.get(roomId)!;
      cabinetMap.set(cabinetId, [...(cabinetMap.get(cabinetId) || []), item]);
    }
    return Array.from(roomMap.entries());
  }, [filtered, cabinets]);

  const remove = async (item: Item) => {
    if (!confirm(`删除「${item.name}」？`)) return;
    await del('items', item.id);
    toast('已删除');
  };

  const add = () => openModal((close) => <ItemDialog onClose={close} />);
  const filterBtn = (key: FilterKey, label: string) => (
    <button key={key} onClick={() => setFilter(key)} className={`px-3 py-1 rounded-full text-xs ${filter === key ? 'bg-brand-500 text-white' : 'bg-slate-100 text-ink-700 hover:bg-slate-200'}`}>
      {label}
    </button>
  );

  return (
    <div>
      <Header title="所有物品" subtitle={`${items.filter((item) => item.status !== 'pending').length} 件已归位`} actions={<button onClick={add} className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm inline-flex items-center gap-1"><Glyph name="plus" size={15} strokeWidth={1.8} />新增</button>} />
      <div className="px-4 md:px-6 pt-3 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
        {filterBtn('placed', `已归位 ${items.filter((item) => item.status !== 'pending').length}`)}
        {filterBtn('pending', `待归位 ${items.filter((item) => item.status === 'pending').length}`)}
        {allTags.map((tag) => {
          const preset = PRESET_TAGS.find((p) => p.name === tag);
          return filterBtn(tag, preset?.name || tag);
        })}
      </div>
      <div className="px-4 md:px-6 py-3">
        {filtered.length === 0 ? (
          <EmptyState icon="items" title="没有符合条件的物品" />
        ) : (
          <div className="space-y-5">
            {grouped.map(([roomId, cabinetMap]) => {
              const room = rooms.find((r) => r.id === roomId);
              return (
                <section key={roomId}>
                  <button onClick={() => room && navigate(`/room/${room.id}`)} className="font-semibold mb-2 text-left">
                    <span className="inline-flex items-center gap-2"><PinIcon name={room ? roomIconName(room.icon) : 'box'} size={28} />{room ? room.name : '全屋自由区'}</span>
                  </button>
                  <div className="space-y-3">
                    {Array.from(cabinetMap.entries()).map(([cabinetId, list]) => {
                      const cabinet = cabinets.find((c) => c.id === cabinetId);
                      return (
                        <div key={cabinetId} className="bg-white rounded-2xl shadow-soft p-3">
                          <button onClick={() => cabinet?.photoId && navigate(`/photo/${cabinet.photoId}`)} className="text-sm font-medium text-ink-700 mb-2">
                            <span className="inline-flex items-center gap-2"><PinIcon name="cabinet" size={24} />{cabinet?.name || '未知柜子'} · {list.length} 件</span>
                          </button>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {list.map((item) => {
                              const info = expiryInfo(item.expiry);
                              return (
                                <button key={item.id} onClick={() => openModal((close) => <ItemDialog item={item} onClose={close} />)} className="relative text-left bg-slate-50 rounded-xl p-2 hover:bg-slate-100">
                                  <ItemThumb item={item} className="w-full aspect-square rounded-lg mb-2" />
                                  <div className="font-medium text-sm truncate">{item.name}</div>
                                  <div className="text-xs text-ink-500">× {item.qty}</div>
                                  {info && <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border ${info.cls}`}>{info.label}</span>}
                                  <span
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      remove(item);
                                    }}
                                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-red-500 text-xs flex items-center justify-center"
                                  >
                                    ×
                                  </span>
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
        )}
      </div>
    </div>
  );
}
