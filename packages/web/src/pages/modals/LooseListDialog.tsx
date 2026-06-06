import type { Cabinet, Item, Room } from '@home-inventory/core';
import { GLOBAL_ROOM_ID } from '@home-inventory/core';
import { ItemThumb } from '../../components/ItemThumb';
import { openModal } from '../../components/Modal';
import { PinIcon } from '../../components/PinIcon';
import ItemDialog from './ItemDialog';

interface Props {
  room?: Room | null;
  cabinet?: Cabinet | null;
  items: Item[];
  onClose: () => void;
}

export default function LooseListDialog({ room, cabinet, items, onClose }: Props) {
  const sorted = items
    .slice()
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.createdAt - a.createdAt);
  const title = room
    ? `${room.name}自由区`
    : cabinet?.roomId === GLOBAL_ROOM_ID
    ? '全屋自由区'
    : '自由物品收纳处';

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold inline-flex items-center gap-2"><PinIcon name={room ? 'room' : 'box'} size={30} />{title}</h3>
          <p className="text-xs text-ink-500 mt-0.5">{sorted.length} 件物品，待归位优先显示</p>
        </div>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-900 text-xl">×</button>
      </div>
      {sorted.length === 0 ? (
        <div className="text-center py-10 text-sm text-ink-400">这里还没有自由物品</div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
          {sorted.map((item) => (
            <button
              key={item.id}
              onClick={() => openModal((close) => <ItemDialog item={item} onClose={close} />)}
              className="relative text-left bg-slate-50 rounded-xl p-2 hover:bg-slate-100"
            >
              {item.status === 'pending' && (
                <span className="absolute right-1 top-1 z-10 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
                  待归位
                </span>
              )}
              <ItemThumb item={item} className="w-full aspect-square rounded-lg" />
              <div className="text-xs font-medium truncate mt-1">{item.name}</div>
              <div className="text-[10px] text-ink-400">× {item.qty}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
