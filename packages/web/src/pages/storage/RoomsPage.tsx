import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/useStore';
import { Header } from '../../components/Header';
import { EmptyState } from '../../components/EmptyState';
import { openModal } from '../../components/Modal';
import RoomDialog from '../modals/RoomDialog';
import { toast } from '../../components/Toast';
import { GLOBAL_ROOM_ID, type Room } from '@home-inventory/core';
import { BlobImage } from '../../components/BlobImage';
import { RoomMenu } from '../../components/RoomMenu';
import LooseListDialog from '../modals/LooseListDialog';
import { PinIcon, roomIconName } from '../../components/PinIcon';
import { Glyph } from '../../components/Glyph';
import { pickImage } from '../../lib/nativeImage';
import { captureNativeItemsIntoInbox } from '../../lib/nativeItemCapture';
import { canUseNativeVision } from '../../lib/nativeVision';
import { NativeItemDiscoverySheet } from '../../components/NativeItemDiscoverySheet';

export default function RoomsPage() {
  const navigate = useNavigate();
  const rooms = useStore((s) => s.rooms);
  const photos = useStore((s) => s.photos);
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);
  const del = useStore((s) => s.del);
  const reloadAll = useStore((s) => s.reloadAll);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeFile, setNativeFile] = useState<Blob | null>(null);

  const roomStats = (r: Room) => {
    const photoCnt = photos.filter((p) => p.roomId === r.id).length;
    const itemCnt = items.filter((i) => i.roomId === r.id).length;
    const cabinetCnt = cabinets.filter((c) => c.roomId === r.id && (!c.type || c.type === 'normal')).length;
    const pendingCnt = items.filter((i) => i.roomId === r.id && i.status === 'pending').length;
    const cover = photos.find((p) => p.roomId === r.id);
    return { photoCnt, itemCnt, cabinetCnt, pendingCnt, cover };
  };
  const globalCabinet = cabinets.find((c) => c.type === 'loose-global');
  const globalItems = items.filter((i) => i.roomId === GLOBAL_ROOM_ID);
  const globalPending = globalItems.filter((i) => i.status === 'pending').length;

  const addRoom = () =>
    openModal((close) => <RoomDialog onDone={() => {}} onClose={close} />);

  const editRoom = (r: Room) =>
    openModal((close) => <RoomDialog room={r} onDone={() => {}} onClose={close} />);

  const removeRoom = async (r: Room) => {
    if (!confirm(`删除房间「${r.name}」？其下的照片、柜子、物品都会级联删除。`)) return;
    const myPhotos = photos.filter((p) => p.roomId === r.id);
    const myCabinets = cabinets.filter((c) => c.roomId === r.id);
    const myItems = items.filter((i) => i.roomId === r.id);
    for (const p of myPhotos) await del('photos', p.id);
    for (const c of myCabinets) await del('cabinets', c.id);
    for (const i of myItems) await del('items', i.id);
    await del('rooms', r.id);
    toast('已删除');
  };

  const runNativeDiscovery = async () => {
    if (nativeBusy) return;
    setNativeBusy(true);
    try {
      if (canUseNativeVision()) {
        const result = await captureNativeItemsIntoInbox(GLOBAL_ROOM_ID);
        if (!result) return;
        await reloadAll();
        toast(`已放入收集箱 ${result.items.length} 件`, 3000);
        navigate('/inbox');
        return;
      }
      const file = await pickImage({ source: 'prompt' });
      if (!file) return;
      setNativeFile(file);
    } catch (err: any) {
      console.error(err);
      toast('打开图片失败：' + (err?.message || 'unknown'), 3200);
    } finally {
      setNativeBusy(false);
    }
  };

  return (
    <div>
      <Header
        title="我的房间"
        subtitle={`${rooms.length} 个房间`}
        actions={
          <div className="inline-flex items-center gap-2">
            <button
              onClick={runNativeDiscovery}
              disabled={nativeBusy}
              className="px-3 py-2 bg-white hover:bg-paper-100 text-ink-700 border border-paper-300 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Glyph name="sparkle" size={15} strokeWidth={1.8} />
              {nativeBusy ? '发现中' : '本机发现'}
            </button>
            <button
              onClick={addRoom}
              className="px-3.5 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5"
            >
              <Glyph name="plus" size={15} strokeWidth={1.8} />新建
            </button>
          </div>
        }
      />

      <div className="py-4 md:py-5">
        <button
          onClick={() => openModal((close) => <LooseListDialog cabinet={globalCabinet} items={globalItems} onClose={close} />)}
          className="loose-card w-full mb-4 text-left"
        >
          <div className="flex items-center gap-3">
            <PinIcon name="box" size={44} />
            <div className="flex-1 min-w-0">
              <div className="eyebrow">无房间归属</div>
              <div className="font-display text-[17px] md:text-xl text-ink-900 mt-0.5 leading-tight">全屋自由区</div>
              <div className="text-[11.5px] text-ink-500 mt-1">
                <span className="tabular-nums">{globalItems.length}</span> 件自由物品
                <span className="mx-2 text-ink-300">·</span>
                <span className="tabular-nums">{globalPending}</span> 件待归位
              </div>
            </div>
            {globalPending > 0 && <span className="loose-card-badge tabular-nums">{globalPending}</span>}
          </div>
        </button>

        {rooms.length === 0 ? (
          <EmptyState
            icon="room"
            title="还没有房间"
            description="点击右上角「新建」，先把房间建起来"
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
            {rooms.map((r) => {
              const s = roomStats(r);
              return (
                <div
                  key={r.id}
                  className="bg-white rounded-2xl shadow-soft overflow-hidden hover:shadow-md transition cursor-pointer"
                  onClick={() => navigate(`/room/${r.id}`)}
                >
                  <div className="relative aspect-[5/4] md:aspect-[4/3] bg-paper-200">
                    {s.cover ? (
                      <BlobImage blob={s.cover.blob} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><PinIcon name={roomIconName(r.icon)} size={72} className="md:!w-24 md:!h-24" /></div>
                    )}
                    <button
                      className="room-menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openModal((close) => <RoomMenu room={r} onEdit={editRoom} onDelete={removeRoom} onClose={close} />);
                      }}
                      aria-label="房间操作"
                    >
                      <Glyph name="more" size={16} />
                    </button>
                    {s.pendingCnt > 0 && (
                      <span className="room-pending-pill">
                        <span className="tabular-nums">{s.pendingCnt}</span> 待归位
                      </span>
                    )}
                  </div>
                  <div className="px-3 py-3 md:px-4 md:py-4">
                    <div className="font-display text-[15px] md:text-[17px] text-ink-900 leading-tight">{r.name}</div>
                    <div className="enamel-meta mt-2">
                      <span><PinIcon name="photo" size={16} tile={false} /><span className="tabular-nums">{s.photoCnt}</span></span>
                      <span><PinIcon name="cabinet" size={16} tile={false} /><span className="tabular-nums">{s.cabinetCnt}</span></span>
                      <span><PinIcon name="box" size={16} tile={false} /><span className="tabular-nums">{s.itemCnt}</span></span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {nativeFile && (
        <NativeItemDiscoverySheet
          file={nativeFile}
          roomId={GLOBAL_ROOM_ID}
          onClose={() => setNativeFile(null)}
        />
      )}
    </div>
  );
}
