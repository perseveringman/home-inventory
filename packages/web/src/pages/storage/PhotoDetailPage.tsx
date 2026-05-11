import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/useStore';
import { Header } from '../../components/Header';
import { EmptyState } from '../../components/EmptyState';
import { openModal } from '../../components/Modal';
import ItemDialog from '../modals/ItemDialog';
import CabinetDialog from '../modals/CabinetDialog';
import { BlobImage } from '../../components/BlobImage';
import PhotoEditor from './PhotoEditor';
import { PinIcon } from '../../components/PinIcon';

export default function PhotoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const photos = useStore((s) => s.photos);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const rooms = useStore((s) => s.rooms);

  const photo = photos.find((p) => p.id === id);
  const room = photo ? rooms.find((r) => r.id === photo.roomId) : null;
  const photoCabinets = useMemo(
    () => cabinets.filter((c) => c.photoId === id),
    [cabinets, id]
  );

  if (!photo) {
    return (
      <div className="p-6">
        <EmptyState icon="photo" title="照片不存在" />
      </div>
    );
  }

  const openAddItem = () =>
    openModal((close) => (
      <ItemDialog
        defaultRoomId={photo.roomId}
        onClose={close}
      />
    ));

  return (
    <div>
      <Header
        title={room ? room.name : '照片'}
        subtitle={`${photoCabinets.length} 个柜子`}
        back
        actions={
            <button
              onClick={openAddItem}
              className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm"
            >
              <span className="inline-flex items-center gap-1"><PinIcon name="add" size={24} tile={false} />物品</span>
            </button>
        }
      />

      <div className="px-4 md:px-6 py-4">
        <PhotoEditor photo={photo} cabinets={photoCabinets} />

        {photoCabinets.length > 0 ? (
          <div className="mt-4 bg-white rounded-2xl shadow-soft p-4">
            <h2 className="font-semibold mb-3 inline-flex items-center gap-2"><PinIcon name="cabinet" size={28} /> 柜子列表</h2>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {photoCabinets.map((cabinet) => {
                const preview = items.filter((item) => item.cabinetId === cabinet.id).slice(0, 8);
                return (
                  <button
                    key={cabinet.id}
                    onClick={() => openModal((close) => <CabinetDialog cabinet={cabinet} onClose={close} />)}
                    className="min-w-44 text-left rounded-xl bg-slate-50 hover:bg-slate-100 p-3"
                  >
                    <div className="font-medium truncate">{cabinet.name}</div>
                    <div className="text-xs text-ink-500 mb-2">{preview.length} 件物品</div>
                    <div className="grid grid-cols-4 gap-1">
                      {preview.length ? preview.map((item) => (
                        <BlobImage key={item.id} blob={item.image || null} emoji={item.aiEmoji || 'box'} className="w-8 h-8 rounded object-cover" />
                      )) : <div className="col-span-4 text-xs text-ink-400 py-2">暂无物品</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-4 text-center text-ink-500 text-sm">这张照片还没有识别出柜子，可点「AI 识别」或手动框选。</div>
        )}
      </div>
    </div>
  );
}
