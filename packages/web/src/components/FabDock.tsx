import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  compressImage,
  createRecognitionTask,
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
import { pickImage } from '../lib/nativeImage';
import { captureNativeItemsIntoInbox } from '../lib/nativeItemCapture';
import { canUseNativeVision } from '../lib/nativeVision';
import { NativeItemDiscoverySheet } from './NativeItemDiscoverySheet';

interface NativeDiscoveryInput {
  file: Blob;
  roomId: string;
}

export function FabDock() {
  const location = useLocation();
  const navigate = useNavigate();
  const photos = useStore((s) => s.photos);
  const reloadAll = useStore((s) => s.reloadAll);
  const put = useStore((s) => s.put);
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [nativeDiscovery, setNativeDiscovery] = useState<NativeDiscoveryInput | null>(null);

  const targetRoomId = () => {
    const roomMatch = location.pathname.match(/^\/room\/([^/]+)/);
    if (roomMatch) return roomMatch[1];
    const photoMatch = location.pathname.match(/^\/photo\/([^/]+)/);
    if (photoMatch) return photos.find((photo) => photo.id === photoMatch[1])?.roomId || null;
    return null;
  };

  const quickAdd = () => openModal((close) => <QuickAddDialog defaultRoomId={targetRoomId() || undefined} onClose={close} />);

  const enqueueRecognition = async (file: File | null | undefined, source: 'camera' | 'gallery') => {
    if (!file) return;
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const storage = getStorage();
      const photo: Photo = {
        id: uid(),
        roomId: targetRoomId() || GLOBAL_ROOM_ID,
        blob: compressed.blob,
        width: compressed.width,
        height: compressed.height,
        createdAt: Date.now(),
      };
      await put('photos', photo);
      await createRecognitionTask(storage, photo, source);
      await reloadAll();
      toast('已加入识别队列，完成后会进入收集箱', 3000);
      navigate('/inbox');
    } catch (err: any) {
      console.error(err);
      toast('入队失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const captureNativeItems = async () => {
    setBusy(true);
    try {
      const result = await captureNativeItemsIntoInbox(targetRoomId() || GLOBAL_ROOM_ID);
      if (!result) return;
      await reloadAll();
      toast(`已放入收集箱 ${result.items.length} 件`, 3000);
      navigate('/inbox');
    } catch (err: any) {
      console.error(err);
      toast('本机识别失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const triggerPick = async (source: 'camera' | 'gallery') => {
    if (busy) return;
    try {
      if (source === 'camera' && canUseNativeVision()) {
        await captureNativeItems();
        return;
      }
      const file = await pickImage({ source });
      if (!file) return;
      if (canUseNativeVision()) {
        setNativeDiscovery({
          file,
          roomId: targetRoomId() || GLOBAL_ROOM_ID,
        });
        return;
      }
      await enqueueRecognition(file, source);
    } catch (err: any) {
      console.error(err);
      toast('打开相机失败：' + (err?.message || 'unknown'), 3000);
    }
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
        <button onClick={() => triggerPick('gallery')} disabled={busy} className="fab-btn" title="选图加入识别队列" aria-label="选图加入识别队列">{busy ? <span className="fab-dot" /> : <PinIcon name="gallery" size={32} tile={false} />}</button>
        <button onClick={() => triggerPick('camera')} disabled={busy} className="fab-btn" title="拍照加入识别队列" aria-label="拍照加入识别队列">{busy ? <span className="fab-dot" /> : <PinIcon name="camera" size={32} tile={false} />}</button>
      </div>
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
      {nativeDiscovery && (
        <NativeItemDiscoverySheet
          file={nativeDiscovery.file}
          roomId={nativeDiscovery.roomId}
          onClose={() => setNativeDiscovery(null)}
        />
      )}
    </>
  );
}
