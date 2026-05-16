import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  compressImage,
  createScanSessionFromDetection,
  detectCabinetsAndItems,
  uid,
  type Photo,
} from '@home-inventory/core';
import { BlobImage } from '../../components/BlobImage';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { openModal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import { getStorage, useStore } from '../../stores/useStore';
import LooseListDialog from '../modals/LooseListDialog';
import RoomDialog from '../modals/RoomDialog';
import { PinIcon } from '../../components/PinIcon';
import { Glyph } from '../../components/Glyph';

export default function RoomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const rooms = useStore((s) => s.rooms);
  const photos = useStore((s) => s.photos);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const scanSessions = useStore((s) => s.scanSessions);
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const reloadAll = useStore((s) => s.reloadAll);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const room = rooms.find((r) => r.id === id);
  const myPhotos = useMemo(
    () => photos.filter((p) => p.roomId === id).sort((a, b) => b.createdAt - a.createdAt),
    [photos, id]
  );
  const myReviewSessions = useMemo(
    () =>
      scanSessions
        .filter((session) => session.roomId === id && session.status === 'reviewing')
        .sort((a, b) => b.createdAt - a.createdAt),
    [scanSessions, id]
  );
  const latestReviewSession = myReviewSessions[0];
  const looseCabinet = cabinets.find((c) => c.roomId === id && c.type === 'loose');
  const looseItems = items
    .filter((item) => item.cabinetId === looseCabinet?.id || (item.roomId === id && item.status === 'pending'))
    .filter((item, index, list) => list.findIndex((x) => x.id === item.id) === index);

  if (!room || !id) {
    return (
      <div className="p-6">
        <EmptyState icon="room" title="房间不存在" />
      </div>
    );
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const { blob, width, height } = await compressImage(file);
      const photo: Photo = { id: uid(), homeId: room.homeId, roomId: id, blob, width, height, createdAt: Date.now() };
      await put('photos', photo);
      const storage = getStorage();
      toast('已上传，AI 识别中…', 2500);
      const result = await detectCabinetsAndItems(blob, { width, height }, {});
      const session = await createScanSessionFromDetection(storage, photo, result);
      await reloadAll();
      toast(`识别完成：${result.cabinets.length} 个柜子 · ${result.items.length} 件候选`, 3000);
      navigate(`/scan/${session.id}`);
    } catch (err: any) {
      console.error(err);
      toast('上传失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async (photo: Photo) => {
    if (!confirm('删除这张照片及其柜子、物品？')) return;
    const photoCabinets = cabinets.filter((cabinet) => cabinet.photoId === photo.id);
    const relatedItems = items.filter((item) => item.sourcePhotoId === photo.id || photoCabinets.some((cabinet) => cabinet.id === item.cabinetId));
    for (const item of relatedItems) await del('items', item.id);
    for (const cabinet of photoCabinets) await del('cabinets', cabinet.id);
    await del('photos', photo.id);
    toast('已删除');
  };

  return (
    <div>
      <Header
        title={room.name}
        subtitle={`${myPhotos.length} 张照片`}
        back
        actions={
          <div className="flex gap-2">
            <button onClick={() => openModal((close) => <RoomDialog room={room} onDone={() => {}} onClose={close} />)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm">
              编辑
            </button>
            <button onClick={() => cameraRef.current?.click()} disabled={busy} className="px-3 py-2 bg-brand-500 hover:bg-brand-600 disabled:bg-ink-300 text-white rounded-lg text-sm font-medium">
              {busy ? '处理中…' : <><Glyph name="camera" size={16} />拍照</>}
            </button>
          </div>
        }
      />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={pickerRef} type="file" accept="image/*" hidden onChange={onFile} />

      <div className="px-4 md:px-6 py-4">
        <div className="mb-4 rounded-2xl bg-brand-50 border border-brand-100 p-4 text-sm text-brand-700">
          拍几张平面照，AI 会生成柜子和物品候选；进入审核台确认后再写入档案。
        </div>

        {latestReviewSession && (
          <button
            onClick={() => navigate(`/scan/${latestReviewSession.id}`)}
            className="mb-4 w-full rounded-2xl bg-white border border-brand-100 shadow-soft p-4 text-left hover:shadow-md transition flex items-center gap-3"
          >
            <PinIcon name="spark" size={46} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-ink-900">还有 {myReviewSessions.length} 个 AI 审核未确认</div>
              <div className="text-xs text-ink-500 mt-0.5">
                最新一次包含 {latestReviewSession.candidates.filter((candidate) => candidate.reviewStatus !== 'rejected').length} 个候选
              </div>
            </div>
            <span className="text-sm text-brand-700">继续审核</span>
          </button>
        )}

        {myPhotos.length === 0 ? (
          <EmptyState
            icon="photo"
            title="还没有照片"
            description="拍一张照片，AI 会自动识别柜子和物品"
            action={
              <div className="flex justify-center gap-2">
                <button onClick={() => cameraRef.current?.click()} className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg"><Glyph name="camera" size={16} />拍照</button>
                <button onClick={() => pickerRef.current?.click()} className="px-5 py-2.5 bg-white border border-slate-200 rounded-lg"><Glyph name="image" size={16} />选图</button>
              </div>
            }
          />
        ) : (
          <>
            <div className="mb-4 rounded-2xl border-2 border-dashed border-slate-200 bg-white p-4 flex items-center justify-center gap-3">
              <button onClick={() => cameraRef.current?.click()} disabled={busy} className="px-4 py-2 rounded-lg bg-brand-500 text-white disabled:bg-ink-300"><Glyph name="camera" size={16} />加照片</button>
              <button onClick={() => pickerRef.current?.click()} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-100 disabled:bg-ink-100"><Glyph name="image" size={16} />从相册选</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {myPhotos.map((photo) => {
                const cabinetCount = cabinets.filter((cabinet) => cabinet.photoId === photo.id).length;
                const itemCount = items.filter((item) => item.sourcePhotoId === photo.id).length;
                const reviewSession = myReviewSessions.find((session) => session.photoId === photo.id);
                const reviewCandidateCount =
                  reviewSession?.candidates.filter((candidate) => candidate.reviewStatus !== 'rejected').length || 0;
                return (
                  <div key={photo.id} className="relative bg-white rounded-2xl shadow-soft overflow-hidden group cursor-pointer" onClick={() => navigate(`/photo/${photo.id}`)}>
                    <BlobImage blob={photo.blob} className="w-full aspect-[4/3] object-cover" />
                    {reviewSession && (
                      <span className="absolute top-2 left-2 px-2 py-1 rounded-full bg-brand-500 text-white text-xs inline-flex items-center gap-1">
                        <PinIcon name="spark" size={18} tile={false} />审核中
                      </span>
                    )}
                    <span className="absolute top-2 right-2 px-2 py-1 rounded-full bg-black/55 text-white text-xs inline-flex items-center gap-1"><PinIcon name="cabinet" size={18} tile={false} />{cabinetCount}</span>
                    <div className="p-3 flex items-center justify-between">
                      <div>
                        <div className="enamel-meta text-sm text-ink-700"><span><PinIcon name="cabinet" size={18} tile={false} />{cabinetCount} 柜</span><span><PinIcon name="box" size={18} tile={false} />{itemCount} 物</span></div>
                        <div className="text-xs text-ink-500 mt-0.5">
                          {reviewSession ? `${reviewCandidateCount} 个候选待确认` : new Date(photo.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {reviewSession && (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/scan/${reviewSession.id}`);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-xs"
                          >
                            继续
                          </button>
                        )}
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            removePhoto(photo);
                          }}
                          className="text-ink-400 hover:text-red-500 px-2 py-1"
                        >
                          <PinIcon name="trash" size={22} tile={false} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <button
          onClick={() => openModal((close) => <LooseListDialog room={room} cabinet={looseCabinet} items={looseItems} onClose={close} />)}
          className="mt-5 w-full bg-white rounded-2xl shadow-soft p-4 text-left hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-3">
            <PinIcon name="inbox" size={58} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">自由物品收纳处</div>
              <div className="text-xs text-ink-500 mt-0.5">{looseItems.length} 件自由物品，集中处理待归位</div>
            </div>
            <span className="text-ink-400">›</span>
          </div>
        </button>
      </div>
    </div>
  );
}
