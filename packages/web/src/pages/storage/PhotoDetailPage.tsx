import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../stores/useStore';
import { Header } from '../../components/Header';
import { EmptyState } from '../../components/EmptyState';
import { openModal } from '../../components/Modal';
import ItemDialog from '../modals/ItemDialog';
import CabinetDialog from '../modals/CabinetDialog';
import { BlobImage } from '../../components/BlobImage';
import { ItemThumb } from '../../components/ItemThumb';
import PhotoEditor from './PhotoEditor';
import { PinIcon } from '../../components/PinIcon';
import { Glyph } from '../../components/Glyph';

export default function PhotoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const photos = useStore((s) => s.photos);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const rooms = useStore((s) => s.rooms);
  const recognitionTasks = useStore((s) => s.recognitionTasks);
  const scanSessions = useStore((s) => s.scanSessions);

  const photo = photos.find((p) => p.id === id);
  const room = photo ? rooms.find((r) => r.id === photo.roomId) : null;
  const photoCabinets = useMemo(
    () => cabinets.filter((c) => c.photoId === id),
    [cabinets, id]
  );
  const reviewSession = useMemo(
    () =>
      scanSessions
        .filter((session) => session.photoId === id && session.status === 'reviewing')
        .sort((a, b) => b.createdAt - a.createdAt)[0],
    [scanSessions, id]
  );
  const activeRecognitionTask = useMemo(
    () =>
      recognitionTasks
        .filter(
          (task) =>
            task.photoId === id &&
            (task.status === 'queued' || task.status === 'processing' || task.status === 'failed')
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0],
    [recognitionTasks, id]
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
          <div className="flex gap-2">
            {reviewSession && (
              <button
                onClick={() => navigate(`/scan/${reviewSession.id}`)}
                className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg text-sm"
              >
                去整理
              </button>
            )}
            {!reviewSession && activeRecognitionTask && (
              <button
                onClick={() => navigate('/inbox')}
                className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg text-sm"
              >
                看队列
              </button>
            )}
            <button
              onClick={openAddItem}
              className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm"
            >
              <Glyph name="plus" size={15} strokeWidth={1.8} />物品
            </button>
          </div>
        }
      />

      <div className="px-4 md:px-6 py-4">
        {reviewSession && (
          <button
            onClick={() => navigate(`/scan/${reviewSession.id}`)}
            className="mb-4 w-full rounded-2xl bg-white border border-brand-100 shadow-soft p-4 text-left hover:shadow-md transition flex items-center gap-3"
          >
            <PinIcon name="spark" size={46} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-ink-900">这张照片已进入收集箱</div>
              <div className="text-xs text-ink-500 mt-0.5">
                {reviewSession.candidates.filter((candidate) => candidate.reviewStatus !== 'rejected').length} 个候选待整理
              </div>
            </div>
            <span className="text-sm text-brand-700">去整理</span>
          </button>
        )}

        {!reviewSession && activeRecognitionTask && (
          <button
            onClick={() => navigate('/inbox')}
            className="mb-4 w-full rounded-2xl bg-white border border-brand-100 shadow-soft p-4 text-left hover:shadow-md transition flex items-center gap-3"
          >
            <PinIcon name="spark" size={46} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-ink-900">
                {activeRecognitionTask.status === 'queued'
                  ? '这张照片正在排队'
                  : activeRecognitionTask.status === 'processing'
                    ? 'AI 正在识别这张照片'
                    : '这张照片识别失败'}
              </div>
              <div className="text-xs text-ink-500 mt-0.5">
                {activeRecognitionTask.status === 'failed'
                  ? activeRecognitionTask.errorMessage || '可在待处理页重试'
                  : '完成后会进入收集箱，等你再整理。'}
              </div>
            </div>
            <span className="text-sm text-brand-700">看队列</span>
          </button>
        )}

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
                        <ItemThumb key={item.id} item={item} className="w-8 h-8 rounded" />
                      )) : <div className="col-span-4 text-xs text-ink-400 py-2">暂无物品</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-4 text-center text-ink-500 text-sm">这张照片还没有已应用的柜子，可点「AI 识别」加入队列，或手动框选。</div>
        )}
      </div>
    </div>
  );
}
