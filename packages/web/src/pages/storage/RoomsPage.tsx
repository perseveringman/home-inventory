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

export default function RoomsPage() {
  const navigate = useNavigate();
  const rooms = useStore((s) => s.rooms);
  const photos = useStore((s) => s.photos);
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);
  const del = useStore((s) => s.del);

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

  return (
    <div>
      <Header
        title="我的房间"
        subtitle={`${rooms.length} 个房间`}
        actions={
          <button
            onClick={addRoom}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm font-medium"
          >
            <span className="inline-flex items-center gap-1"><PinIcon name="add" size={24} tile={false} />新建</span>
          </button>
        }
      />

      <div className="px-4 md:px-6 py-4">
        <button
          onClick={() => openModal((close) => <LooseListDialog cabinet={globalCabinet} items={globalItems} onClose={close} />)}
          className="w-full mb-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-2xl shadow-soft p-4 text-left"
        >
          <div className="flex items-center justify-between gap-3">
            <PinIcon name="box" size={62} />
            <div className="flex-1 min-w-0">
              <div className="text-lg font-semibold">全屋自由区</div>
              <div className="text-xs opacity-90 mt-1">{globalItems.length} 件自由物品 · {globalPending} 件待归位</div>
            </div>
            {globalPending > 0 && <span className="px-2 py-1 rounded-full bg-white/20 text-xs">{globalPending}</span>}
          </div>
        </button>

        {rooms.length === 0 ? (
          <EmptyState
            icon="room"
            title="还没有房间"
            description="点击右上角「新建」，先把房间建起来"
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {rooms.map((r) => {
              const s = roomStats(r);
              return (
                <div
                  key={r.id}
                  className="bg-white rounded-2xl shadow-soft overflow-hidden hover:shadow-md transition cursor-pointer"
                  onClick={() => navigate(`/room/${r.id}`)}
                >
                  <div className="relative aspect-[4/3] bg-slate-100">
                    {s.cover ? (
                      <BlobImage blob={s.cover.blob} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><PinIcon name={roomIconName(r.icon)} size={96} /></div>
                    )}
                    <button
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 text-ink-500 hover:text-ink-900 shadow"
                      onClick={(e) => {
                        e.stopPropagation();
                        openModal((close) => <RoomMenu room={r} onEdit={editRoom} onDelete={removeRoom} onClose={close} />);
                      }}
                    >
                      ⋯
                    </button>
                    {s.pendingCnt > 0 && <span className="absolute left-2 top-2 px-2 py-1 rounded-full bg-orange-500 text-white text-xs">{s.pendingCnt} 待归位</span>}
                  </div>
                  <div className="p-4">
                    <div className="font-semibold text-ink-900">{r.name}</div>
                    <div className="enamel-meta text-xs text-ink-500 mt-2">
                      <span><PinIcon name="photo" size={18} tile={false} />{s.photoCnt}</span>
                      <span><PinIcon name="cabinet" size={18} tile={false} />{s.cabinetCnt}</span>
                      <span><PinIcon name="box" size={18} tile={false} />{s.itemCnt}</span>
                    </div>
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
