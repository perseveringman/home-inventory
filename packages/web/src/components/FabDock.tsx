import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  compressImage,
  createScanSessionFromDetection,
  detectCabinetsAndItems,
  GLOBAL_ROOM_ID,
  uid,
  type Photo,
} from '@home-inventory/core';
import { openModal } from './Modal';
import { toast } from './Toast';
import { getStorage, useStore } from '../stores/useStore';
import QuickAddDialog from '../pages/modals/QuickAddDialog';
import { ChatDrawer } from './ChatDrawer';
import { PinIcon } from './PinIcon';

export function FabDock() {
  const location = useLocation();
  const navigate = useNavigate();
  const photos = useStore((s) => s.photos);
  const reloadAll = useStore((s) => s.reloadAll);
  const put = useStore((s) => s.put);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const targetRoomId = () => {
    const roomMatch = location.pathname.match(/^\/room\/([^/]+)/);
    if (roomMatch) return roomMatch[1];
    const photoMatch = location.pathname.match(/^\/photo\/([^/]+)/);
    if (photoMatch) return photos.find((photo) => photo.id === photoMatch[1])?.roomId || null;
    return null;
  };

  const quickAdd = () => openModal((close) => <QuickAddDialog defaultRoomId={targetRoomId() || undefined} onClose={close} />);

  const scan = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const storage = getStorage();
      toast('AI 正在识别物品…', 2500);
      const existingPhotoId = location.pathname.match(/^\/photo\/([^/]+)/)?.[1];
      const existingPhoto = existingPhotoId
        ? photos.find((photo) => photo.id === existingPhotoId) || null
        : null;
      const photo: Photo =
        existingPhoto ||
        {
          id: uid(),
          roomId: targetRoomId() || GLOBAL_ROOM_ID,
          blob: compressed.blob,
          width: compressed.width,
          height: compressed.height,
          createdAt: Date.now(),
        };
      if (!existingPhoto) await put('photos', photo);
      const result = await detectCabinetsAndItems(compressed.blob, compressed, {});
      const session = await createScanSessionFromDetection(storage, photo, result);
      await reloadAll();
      toast(`识别了 ${result.cabinets.length + result.items.length} 个候选，进入审核台`, 3000);
      navigate(`/scan/${session.id}`);
    } catch (err: any) {
      console.error(err);
      toast('识别失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    scan(file);
  };

  return (
    <>
      {/*
        Visual order is column-reverse: declare secondaries first (top of stack),
        primary last so it sits at the bottom and gets the highlighted treatment.
      */}
      <div className="fab-dock">
        <button onClick={() => setChatOpen(true)} className="fab-btn" title="AI 对话助手" aria-label="AI 对话助手"><PinIcon name="chat" size={32} tile={false} /></button>
        <button onClick={quickAdd} className="fab-btn" title="快速文字录入" aria-label="快速文字录入"><PinIcon name="edit" size={32} tile={false} /></button>
        <button onClick={() => pickRef.current?.click()} disabled={busy} className="fab-btn" title="选图即时识别" aria-label="选图即时识别">{busy ? <span className="fab-dot" /> : <PinIcon name="gallery" size={32} tile={false} />}</button>
        <button onClick={() => camRef.current?.click()} disabled={busy} className="fab-btn" title="拍照即时识别" aria-label="拍照即时识别">{busy ? <span className="fab-dot" /> : <PinIcon name="camera" size={32} tile={false} />}</button>
      </div>
      <input ref={pickRef} type="file" accept="image/*" hidden onChange={onFile} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
    </>
  );
}
