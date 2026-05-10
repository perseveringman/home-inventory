import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/useStore';
import { Header } from '../../components/Header';
import { BlobImage } from '../../components/BlobImage';
import { EmptyState } from '../../components/EmptyState';
import { openModal } from '../../components/Modal';
import ItemDialog from '../modals/ItemDialog';
import CabinetDialog from '../modals/CabinetDialog';
import type { Cabinet, Item } from '@home-inventory/core';
import { expiryInfo } from '@home-inventory/core';
import { toast } from '../../components/Toast';

export default function PhotoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const photos = useStore((s) => s.photos);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const rooms = useStore((s) => s.rooms);
  const del = useStore((s) => s.del);

  const photo = photos.find((p) => p.id === id);
  const room = photo ? rooms.find((r) => r.id === photo.roomId) : null;
  const photoCabinets = useMemo(
    () => cabinets.filter((c) => c.photoId === id),
    [cabinets, id]
  );
  const [activeCabinet, setActiveCabinet] = useState<Cabinet | null>(null);
  const shown = activeCabinet || photoCabinets[0] || null;
  const cabinetItems = shown
    ? items.filter((i) => i.cabinetId === shown.id).sort((a, b) => b.createdAt - a.createdAt)
    : [];

  if (!photo) {
    return (
      <div className="p-6">
        <EmptyState icon="📸" title="照片不存在" />
      </div>
    );
  }

  const openEditItem = (it: Item) =>
    openModal((close) => <ItemDialog item={it} onClose={close} />);

  const openAddItem = () =>
    openModal((close) => (
      <ItemDialog
        defaultCabinetId={shown?.id}
        defaultRoomId={photo.roomId}
        onClose={close}
      />
    ));

  const delItem = async (it: Item) => {
    if (!confirm(`删除物品「${it.name}」？`)) return;
    await del('items', it.id);
    toast('已删除');
  };

  return (
    <div>
      <Header
        title={room ? `${room.icon} ${room.name}` : '照片'}
        subtitle={`${photoCabinets.length} 个柜子`}
        back
        actions={
          shown && (
            <button
              onClick={openAddItem}
              className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm"
            >
              ＋ 物品
            </button>
          )
        }
      />

      <div className="px-4 md:px-6 py-4">
        <div className="photo-stage relative bg-black rounded-2xl overflow-hidden mx-auto">
          <BlobImage blob={photo.blob} className="w-full max-h-[60vh] object-contain" />
          {photoCabinets.map((c) => (
            <div
              key={c.id}
              className="cabinet-box"
              style={{
                left: `${c.rect.x * 100}%`,
                top: `${c.rect.y * 100}%`,
                width: `${c.rect.w * 100}%`,
                height: `${c.rect.h * 100}%`,
                borderColor: shown?.id === c.id ? '#fb7185' : '#5b6cff',
                background:
                  shown?.id === c.id
                    ? 'rgba(251,113,133,0.22)'
                    : 'rgba(91,108,255,0.18)',
              }}
              onClick={() => setActiveCabinet(c)}
            >
              <span
                className="label"
                style={{ background: shown?.id === c.id ? '#fb7185' : '#5b6cff' }}
              >
                {c.name}
              </span>
            </div>
          ))}
        </div>

        {shown ? (
          <div className="mt-4 bg-white rounded-2xl shadow-soft p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm text-ink-500">当前柜子</div>
                <div className="text-lg font-semibold">{shown.name}</div>
              </div>
              <button
                onClick={() =>
                  openModal((close) => (
                    <CabinetDialog cabinet={shown} onClose={close} />
                  ))
                }
                className="text-sm text-brand-600"
              >
                重命名/删除
              </button>
            </div>

            {cabinetItems.length === 0 ? (
              <div className="text-center py-6 text-ink-400 text-sm">
                还没有物品。点右上「＋ 物品」新增
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {cabinetItems.map((it) => {
                  const info = expiryInfo(it.expiry);
                  return (
                    <li
                      key={it.id}
                      className="py-2 flex items-center gap-3 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                      onClick={() => openEditItem(it)}
                    >
                      <BlobImage
                        blob={it.image || null}
                        emoji={it.aiEmoji || '📦'}
                        className="w-12 h-12 rounded-lg object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{it.name}</span>
                          <span className="text-xs text-ink-400">× {it.qty}</span>
                        </div>
                        {info && (
                          <span
                            className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded border ${info.cls}`}
                          >
                            {info.label}
                          </span>
                        )}
                        {it.note && (
                          <div className="text-xs text-ink-500 truncate">{it.note}</div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          delItem(it);
                        }}
                        className="text-ink-300 hover:text-red-500 px-2"
                      >
                        🗑️
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <div className="mt-4 text-center text-ink-500 text-sm">
            这张照片还没有识别出柜子
          </div>
        )}
      </div>
    </div>
  );
}
