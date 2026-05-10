import { useMemo, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Header } from '../../components/Header';
import { EmptyState } from '../../components/EmptyState';
import { BlobImage } from '../../components/BlobImage';
import { openModal } from '../../components/Modal';
import ItemDialog from '../modals/ItemDialog';
import { PRESET_TAGS, expiryInfo, type Item } from '@home-inventory/core';
import { toast } from '../../components/Toast';

type FilterKey = 'all' | 'pending' | 'placed' | string; // string = tag

export default function ItemsPage() {
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);
  const rooms = useStore((s) => s.rooms);
  const del = useStore((s) => s.del);
  const [filter, setFilter] = useState<FilterKey>('all');

  const allTags = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => i.tags?.forEach((t) => s.add(t)));
    return Array.from(s);
  }, [items]);

  const filtered = useMemo(() => {
    let list = items.slice();
    if (filter === 'pending') list = list.filter((i) => i.status === 'pending');
    else if (filter === 'placed') list = list.filter((i) => i.status === 'placed');
    else if (filter !== 'all')
      list = list.filter((i) => i.tags?.includes(filter as string));
    return list.sort((a, b) => (b.lastTouchedAt || b.createdAt) - (a.lastTouchedAt || a.createdAt));
  }, [items, filter]);

  const locateLabel = (it: Item) => {
    const cab = cabinets.find((c) => c.id === it.cabinetId);
    if (!cab) return '';
    const r = rooms.find((x) => x.id === cab.roomId);
    return `${r ? r.name : '全屋'} · ${cab.name}`;
  };

  const remove = async (it: Item) => {
    if (!confirm(`删除「${it.name}」？`)) return;
    await del('items', it.id);
    toast('已删除');
  };

  const add = () => openModal((close) => <ItemDialog onClose={close} />);

  const filterBtn = (key: FilterKey, label: string) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={`px-3 py-1 rounded-full text-xs ${
        filter === key
          ? 'bg-brand-500 text-white'
          : 'bg-slate-100 text-ink-700 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <Header
        title="📦 所有物品"
        subtitle={`${items.length} 件`}
        actions={
          <button
            onClick={add}
            className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm"
          >
            ＋ 新增
          </button>
        }
      />

      <div className="px-4 md:px-6 pt-3 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
        {filterBtn('all', `全部 ${items.length}`)}
        {filterBtn('pending', `待归位 ${items.filter((i) => i.status === 'pending').length}`)}
        {filterBtn('placed', `已归位 ${items.filter((i) => i.status === 'placed').length}`)}
        {allTags.map((t) => {
          const preset = PRESET_TAGS.find((p) => p.name === t);
          return filterBtn(t, `${preset?.emoji || '🏷️'} ${t}`);
        })}
      </div>

      <div className="px-4 md:px-6 py-3">
        {filtered.length === 0 ? (
          <EmptyState icon="📦" title="没有符合条件的物品" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filtered.map((it) => {
              const info = expiryInfo(it.expiry);
              return (
                <div
                  key={it.id}
                  onClick={() => openModal((close) => <ItemDialog item={it} onClose={close} />)}
                  className="bg-white rounded-2xl shadow-soft p-3 hover:shadow-md cursor-pointer"
                >
                  <BlobImage
                    blob={it.image || null}
                    emoji={it.aiEmoji || '📦'}
                    className="w-full aspect-square rounded-lg object-cover mb-2"
                  />
                  <div className="flex items-center gap-1">
                    {it.status === 'pending' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                        待归位
                      </span>
                    )}
                    <div className="font-medium text-sm truncate flex-1">{it.name}</div>
                  </div>
                  <div className="text-xs text-ink-500 truncate mt-0.5">
                    {locateLabel(it)}
                  </div>
                  {info && (
                    <span
                      className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border ${info.cls}`}
                    >
                      {info.label}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(it);
                    }}
                    className="absolute top-2 right-2"
                  >
                    {' '}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
