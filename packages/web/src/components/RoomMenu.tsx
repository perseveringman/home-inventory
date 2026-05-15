import type { Room } from '@home-inventory/core';
import { PinIcon, roomIconName } from './PinIcon';
import { Glyph } from './Glyph';

interface Props {
  room: Room;
  onEdit: (room: Room) => void;
  onDelete: (room: Room) => void;
  onClose: () => void;
}

export function RoomMenu({ room, onEdit, onDelete, onClose }: Props) {
  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold inline-flex items-center gap-2"><PinIcon name={roomIconName(room.icon)} size={30} />{room.name}</h3>
          <p className="text-xs text-ink-500 mt-0.5">选择要执行的操作</p>
        </div>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-900 text-xl">×</button>
      </div>
      <div className="space-y-2">
        <button
          onClick={() => {
            onClose();
            onEdit(room);
          }}
          className="w-full text-left px-4 py-3 rounded-xl bg-slate-50 hover:bg-slate-100 inline-flex items-center gap-2"
        >
          <Glyph name="pencil" size={16} />编辑房间名称和图标
        </button>
        <button
          onClick={() => {
            onClose();
            onDelete(room);
          }}
          className="w-full text-left px-4 py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 inline-flex items-center gap-2"
        >
          <Glyph name="trash" size={16} />删除房间及其所有数据
        </button>
      </div>
    </div>
  );
}
