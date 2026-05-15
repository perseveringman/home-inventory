import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { semanticSearchInventory } from '@home-inventory/core';
import { useStore } from '../../stores/useStore';
import { Header } from '../../components/Header';
import { BlobImage } from '../../components/BlobImage';
import { openModal } from '../../components/Modal';
import ItemDialog from '../modals/ItemDialog';
import { PinIcon } from '../../components/PinIcon';

export default function SearchPage() {
  const navigate = useNavigate();
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);
  const rooms = useStore((s) => s.rooms);
  const photos = useStore((s) => s.photos);
  const [q, setQ] = useState('');

  const results = useMemo(() => {
    return semanticSearchInventory(q, rooms, cabinets, items, photos, 100);
  }, [q, items, cabinets, rooms, photos]);

  const loc = (cabinetId: string) => {
    const c = cabinets.find((x) => x.id === cabinetId);
    if (!c) return '';
    const r = rooms.find((x) => x.id === c.roomId);
    return `${r ? r.name : '全屋'} · ${c.name}`;
  };

  return (
    <div>
      <Header title="搜索" subtitle="按名称、备注、标签" />
      <div className="px-4 md:px-6 py-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入关键词"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-brand-500"
        />
      </div>
      <div className="px-4 md:px-6 py-2">
        {!q.trim() ? (
          <div className="text-center py-16 text-ink-500 text-sm">输入关键词开始搜索</div>
        ) : results.length === 0 ? (
          <div className="text-center py-16 text-ink-500 text-sm">没有找到</div>
        ) : (
          <ul className="space-y-3">
            {results.map((result) => (
              <li
                key={result.item.id}
                onClick={() => {
                  if (result.item.sourcePhotoId) navigate(`/photo/${result.item.sourcePhotoId}`);
                  else openModal((close) => <ItemDialog item={result.item} onClose={close} />);
                }}
                className="bg-white rounded-2xl shadow-soft overflow-hidden cursor-pointer hover:shadow-md transition"
              >
                <div className="flex gap-3 p-3">
                  <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                    {result.photo ? (
                      <>
                        <BlobImage blob={result.photo.blob} className="w-full h-full object-cover" />
                        {result.item.aiRect && (
                          <span
                            className="absolute border-2 border-brand-400 bg-brand-400/20 rounded"
                            style={{
                              left: `${result.item.aiRect.x * 100}%`,
                              top: `${result.item.aiRect.y * 100}%`,
                              width: `${result.item.aiRect.w * 100}%`,
                              height: `${result.item.aiRect.h * 100}%`,
                            }}
                          />
                        )}
                      </>
                    ) : (
                      <BlobImage
                        blob={result.item.image || null}
                        emoji={result.item.aiEmoji || 'box'}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold truncate">{result.item.name}</div>
                        <div className="text-xs text-ink-500 mt-0.5 truncate">
                          {result.room?.name || '全屋'} · {result.cabinet?.name || loc(result.item.cabinetId)}
                        </div>
                      </div>
                      <span className="text-[11px] px-2 py-1 rounded-full bg-brand-50 text-brand-700">
                        {Math.round(result.score)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {result.item.tags?.slice(0, 4).map((tag) => (
                        <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-ink-600">
                          {tag}
                        </span>
                      ))}
                      {result.matched.map((token) => (
                        <span key={token} className="text-[11px] px-2 py-0.5 rounded-full bg-clay-50 text-clay-700">
                          {token}
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] text-ink-500 mt-2 inline-flex items-center gap-1">
                      <PinIcon name="search" size={18} tile={false} />
                      {result.reason}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
