import { useMemo, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Header } from '../../components/Header';
import { BlobImage } from '../../components/BlobImage';
import { openModal } from '../../components/Modal';
import ItemDialog from '../modals/ItemDialog';

export default function SearchPage() {
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);
  const rooms = useStore((s) => s.rooms);
  const [q, setQ] = useState('');

  const results = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return items.slice(0, 30);
    return items
      .filter(
        (i) =>
          i.name.toLowerCase().includes(key) ||
          i.note?.toLowerCase().includes(key) ||
          i.tags?.some((t) => t.toLowerCase().includes(key))
      )
      .slice(0, 100);
  }, [q, items]);

  const loc = (cabinetId: string) => {
    const c = cabinets.find((x) => x.id === cabinetId);
    if (!c) return '';
    const r = rooms.find((x) => x.id === c.roomId);
    return `${r ? r.name : '全屋'} · ${c.name}`;
  };

  return (
    <div>
      <Header title="🔍 搜索" subtitle="按名称、备注、标签" />
      <div className="px-4 md:px-6 py-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入关键词"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-brand-500"
        />
      </div>
      <div className="px-4 md:px-6 py-2">
        {results.length === 0 ? (
          <div className="text-center py-16 text-ink-500 text-sm">没有找到</div>
        ) : (
          <ul className="bg-white rounded-2xl shadow-soft divide-y divide-slate-100 overflow-hidden">
            {results.map((it) => (
              <li
                key={it.id}
                onClick={() => openModal((close) => <ItemDialog item={it} onClose={close} />)}
                className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer"
              >
                <BlobImage
                  blob={it.image || null}
                  emoji={it.aiEmoji || '📦'}
                  className="w-12 h-12 rounded-lg object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{it.name}</div>
                  <div className="text-xs text-ink-500 truncate">{loc(it.cabinetId)}</div>
                </div>
                <span className="text-xs text-ink-400">× {it.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
