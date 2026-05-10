import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  compressImage,
  detectCabinetsAndItems,
  ensureLooseCabinet,
  cropItemFromPhoto,
  generateItemThumb,
  uid,
  getConfig,
  type Photo,
  type Cabinet,
  type Item,
} from '@home-inventory/core';
import { useStore, getStorage } from '../../stores/useStore';
import { Header } from '../../components/Header';
import { EmptyState } from '../../components/EmptyState';
import { BlobImage } from '../../components/BlobImage';
import { toast } from '../../components/Toast';

export default function RoomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const rooms = useStore((s) => s.rooms);
  const photos = useStore((s) => s.photos);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const room = rooms.find((r) => r.id === id);
  const myPhotos = useMemo(
    () => photos.filter((p) => p.roomId === id).sort((a, b) => b.createdAt - a.createdAt),
    [photos, id]
  );

  if (!room) {
    return (
      <div className="p-6">
        <EmptyState icon="🏠" title="房间不存在" />
      </div>
    );
  }

  const pickPhoto = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const { blob, width, height } = await compressImage(f);
      const photo: Photo = {
        id: uid(),
        roomId: id!,
        blob,
        width,
        height,
        createdAt: Date.now(),
      };
      await put('photos', photo);

      // AI 识别
      const storage = getStorage();
      const cfg = {
        openrouterKey: await getConfig<string>(storage, 'openrouterKey', ''),
        openrouterModel: await getConfig<string>(
          storage,
          'openrouterModel',
          'google/gemini-2.5-flash'
        ),
        claudeKey: await getConfig<string>(storage, 'claudeKey', ''),
      };
      toast('已上传，AI 识别中…', 2500);
      const result = await detectCabinetsAndItems(blob, { width, height }, cfg);

      // 创建柜子
      const cabinetIdMap = new Map<string, string>();
      for (const c of result.cabinets) {
        const cab: Cabinet = {
          id: uid(),
          photoId: photo.id,
          roomId: id!,
          name: c.name,
          rect: c.rect,
          type: 'normal',
          createdAt: Date.now(),
        };
        cabinetIdMap.set(c.name, cab.id);
        await put('cabinets', cab);
      }

      // 创建待处理物品（映射到自由区）
      if (result.items.length > 0) {
        const loose = await ensureLooseCabinet(storage, id!);
        // store 需要刷新 cabinets
        await put('cabinets', loose); // idempotent put
        for (const it of result.items) {
          const crop = await cropItemFromPhoto(blob, it.rect);
          const img = crop || (await generateItemThumb(it.name, it.emoji || '📦'));
          const itemObj: Item = {
            id: uid(),
            cabinetId: loose.id,
            roomId: id!,
            name: it.name,
            qty: 1,
            note: '',
            tags: [],
            image: img,
            status: 'pending',
            source: 'ai',
            sourcePhotoId: photo.id,
            aiEmoji: it.emoji,
            aiRect: it.rect,
            createdAt: Date.now(),
          };
          await put('items', itemObj);
        }
      }

      toast(
        `识别完成：${result.cabinets.length} 个柜子 · ${result.items.length} 件待归位`,
        3000
      );
    } catch (err: any) {
      console.error(err);
      toast('上传失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async (p: Photo) => {
    if (!confirm('删除这张照片及其柜子、物品？')) return;
    const cabs = cabinets.filter((c) => c.photoId === p.id);
    const its = items.filter((i) => i.sourcePhotoId === p.id);
    for (const c of cabs) await del('cabinets', c.id);
    for (const i of its) await del('items', i.id);
    await del('photos', p.id);
    toast('已删除');
  };

  return (
    <div>
      <Header
        title={`${room.icon} ${room.name}`}
        subtitle={`${myPhotos.length} 张照片`}
        back
        actions={
          <button
            onClick={pickPhoto}
            disabled={busy}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:bg-ink-300 text-white rounded-lg text-sm font-medium"
          >
            {busy ? '处理中…' : '📸 拍照'}
          </button>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onFile}
      />

      <div className="px-4 md:px-6 py-4">
        {myPhotos.length === 0 ? (
          <EmptyState
            icon="📸"
            title="还没有照片"
            description="拍一张照片，AI 会自动识别柜子和物品"
            action={
              <button
                onClick={pickPhoto}
                className="px-6 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg"
              >
                拍第一张
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myPhotos.map((p) => {
              const cabCnt = cabinets.filter((c) => c.photoId === p.id).length;
              const itemCnt = items.filter((i) => i.sourcePhotoId === p.id).length;
              return (
                <div
                  key={p.id}
                  className="relative bg-white rounded-2xl shadow-soft overflow-hidden group cursor-pointer"
                  onClick={() => navigate(`/photo/${p.id}`)}
                >
                  <BlobImage
                    blob={p.blob}
                    className="w-full aspect-[4/3] object-cover"
                  />
                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm text-ink-700">
                        📦 {cabCnt} 柜 · {itemCnt} 物
                      </div>
                      <div className="text-xs text-ink-500 mt-0.5">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removePhoto(p);
                      }}
                      className="text-ink-400 hover:text-red-500 px-2 py-1"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
