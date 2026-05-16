import { useState } from 'react';
import {
  ROOM_ICONS,
  ROOM_PRESETS,
  uid,
  type Room,
} from '@home-inventory/core';
import { useStore } from '../../stores/useStore';
import { toast } from '../../components/Toast';
import { PinIcon, roomIconName } from '../../components/PinIcon';

interface Props {
  room?: Room;
  onDone: () => void;
  onClose: () => void;
}

export default function RoomDialog({ room, onDone, onClose }: Props) {
  const put = useStore((s) => s.put);
  const currentHomeId = useStore((s) => s.currentHomeId);
  const [name, setName] = useState(room?.name || '');
  const [icon, setIcon] = useState(room?.icon || ROOM_ICONS[0]);

  const pickPreset = (p: { name: string; icon: string }) => {
    setName(p.name);
    setIcon(p.icon);
  };

  const save = async () => {
    const n = name.trim();
    if (!n) {
      toast('请输入房间名');
      return;
    }
    const obj: Room = room
      ? { ...room, name: n, icon }
      : { id: uid(), homeId: currentHomeId, name: n, icon, createdAt: Date.now() };
    await put('rooms', obj);
    toast(room ? '已更新' : '已添加');
    onDone();
    onClose();
  };

  return (
    <div className="p-5 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{room ? '编辑房间' : '新建房间'}</h3>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-900 text-xl">
          ×
        </button>
      </div>

      {!room && (
        <>
          <div className="text-xs text-ink-500 mb-2">常见房间</div>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {ROOM_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => pickPreset(p)}
                className="py-3 rounded-xl border border-slate-200 hover:border-brand-500 hover:bg-brand-50 flex flex-col items-center gap-1"
              >
                <PinIcon name={roomIconName(p.icon)} size={38} />
                <span className="text-xs text-ink-700">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <label className="block text-sm font-medium mb-1">房间名</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-4"
        placeholder="例如：主卧"
      />

      <label className="block text-sm font-medium mb-2">图标</label>
      <div className="grid grid-cols-5 gap-2 mb-6">
        {ROOM_ICONS.map((i) => (
          <button
            key={i}
            onClick={() => setIcon(i)}
            className={`py-2 rounded-lg border flex justify-center ${
              icon === i
                ? 'border-brand-500 bg-brand-50'
                : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <PinIcon name={roomIconName(i)} size={34} />
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 rounded-lg border border-slate-200 text-ink-700"
        >
          取消
        </button>
        <button
          onClick={save}
          className="flex-1 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium"
        >
          保存
        </button>
      </div>
    </div>
  );
}
