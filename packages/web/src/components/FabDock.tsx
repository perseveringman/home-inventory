import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  compressImage,
  getConfig,
  scanLooseItemsFromPhoto,
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
  const photos = useStore((s) => s.photos);
  const reloadAll = useStore((s) => s.reloadAll);
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
      const cfg = {
        openrouterKey: await getConfig<string>(storage, 'openrouterKey', ''),
        openrouterModel: await getConfig<string>(storage, 'openrouterModel', 'google/gemini-2.5-flash'),
        claudeKey: await getConfig<string>(storage, 'claudeKey', ''),
      };
      let sourcePhoto: Photo | null = null;
      const photoId = location.pathname.match(/^\/photo\/([^/]+)/)?.[1];
      if (photoId) sourcePhoto = photos.find((photo) => photo.id === photoId) || null;
      toast('AI 正在识别物品…', 2500);
      const added = await scanLooseItemsFromPhoto(storage, compressed.blob, compressed, cfg, targetRoomId(), sourcePhoto);
      await reloadAll();
      toast(added.length ? `识别了 ${added.length} 件物品，已放入待处理` : '没识别到可记录的物品', 3000);
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
      <div className="fab-dock">
        <button onClick={() => setChatOpen(true)} className="fab-btn" title="AI 对话助手"><PinIcon name="chat" size={42} tile={false} /></button>
        <button onClick={quickAdd} className="fab-btn" title="快速文字录入"><PinIcon name="edit" size={42} tile={false} /></button>
        <button onClick={() => pickRef.current?.click()} disabled={busy} className="fab-btn" title="选图即时识别">{busy ? '…' : <PinIcon name="gallery" size={42} tile={false} />}</button>
        <button onClick={() => camRef.current?.click()} disabled={busy} className="fab-btn" title="拍照即时识别">{busy ? '…' : <PinIcon name="camera" size={42} tile={false} />}</button>
      </div>
      <input ref={pickRef} type="file" accept="image/*" hidden onChange={onFile} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
    </>
  );
}
