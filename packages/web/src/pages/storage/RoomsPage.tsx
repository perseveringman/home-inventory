import { useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/useStore';
import { Header } from '../../components/Header';
import { EmptyState } from '../../components/EmptyState';
import { openModal } from '../../components/Modal';
import RoomDialog from '../modals/RoomDialog';
import { toast } from '../../components/Toast';
import type { Room } from '@home-inventory/core';

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
    return { photoCnt, itemCnt };
  };

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
        title="🏠 我的房间"
        subtitle={`${rooms.length} 个房间`}
        actions={
          <button
            onClick={addRoom}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm font-medium"
          >
            ＋ 新建
          </button>
        }
      />

      <div className="px-4 md:px-6 py-4">
        {rooms.length === 0 ? (
          <EmptyState
            icon="🏠"
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
                  className="bg-white rounded-2xl shadow-soft p-4 hover:shadow-md transition cursor-pointer"
                  onClick={() => navigate(`/room/${r.id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="text-4xl mb-2">{r.icon}</div>
                    <div
                      className="text-ink-300 hover:text-ink-700 text-lg px-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        const act = prompt('输入 e 编辑 / d 删除', '');
                        if (act === 'e') editRoom(r);
                        else if (act === 'd') removeRoom(r);
                      }}
                    >
                      ⋯
                    </div>
                  </div>
                  <div className="font-semibold text-ink-900">{r.name}</div>
                  <div className="text-xs text-ink-500 mt-1">
                    📸 {s.photoCnt} · 📦 {s.itemCnt}
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
