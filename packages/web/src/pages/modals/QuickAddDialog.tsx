import { useMemo, useState } from 'react';
import {
  GLOBAL_ROOM_ID,
  addQuickItems,
  ensureGlobalLooseCabinet,
  parseQuickAddText,
  resolveTargetCabinet,
} from '@home-inventory/core';
import { getStorage, useStore } from '../../stores/useStore';
import { toast } from '../../components/Toast';
import { PinIcon } from '../../components/PinIcon';

interface Props {
  defaultRoomId?: string;
  onClose: () => void;
}

export default function QuickAddDialog({ defaultRoomId = GLOBAL_ROOM_ID, onClose }: Props) {
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const reloadAll = useStore((s) => s.reloadAll);
  const [text, setText] = useState('');
  const [roomId, setRoomId] = useState(defaultRoomId);
  const [cabinetChoice, setCabinetChoice] = useState('__global_loose__');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);

  const roomCabinets = useMemo(
    () => cabinets.filter((cabinet) => cabinet.roomId === roomId && (!cabinet.type || cabinet.type === 'normal')),
    [cabinets, roomId]
  );

  const save = async () => {
    const lines = parseQuickAddText(text);
    if (!lines.length) {
      toast('请先输入物品');
      return;
    }
    setBusy(true);
    try {
      const storage = getStorage();
      if (roomId === GLOBAL_ROOM_ID) await ensureGlobalLooseCabinet(storage);
      const target = await resolveTargetCabinet(storage, cabinetChoice, roomId);
      if (!target) {
        toast('请选择目的地');
        return;
      }
      const added = await addQuickItems(storage, lines, target, expiry);
      await reloadAll();
      toast(`已添加 ${added.length} 件物品`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold inline-flex items-center gap-2"><PinIcon name="edit" size={30} />快速添加物品</h3>
          <p className="text-xs text-ink-500 mt-1">每行一件，支持「名称×数量, 备注」语法。</p>
        </div>
        <button onClick={onClose} className="text-ink-500 text-xl">×</button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        placeholder={'牙膏×2\n洗发水\n螺丝刀, 工具盒里\n感冒药×3'}
        className="w-full p-3 rounded-xl bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm font-mono"
      />
      <div className="bg-brand-50 rounded-xl p-3 space-y-2">
        <div className="text-xs font-semibold text-brand-700">放到哪里</div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={roomId}
            onChange={(e) => {
              const next = e.target.value;
              setRoomId(next);
              setCabinetChoice(next === GLOBAL_ROOM_ID ? '__global_loose__' : '__room_loose__');
            }}
            className="h-10 px-3 rounded-lg bg-white border border-slate-200 text-sm"
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
            <option value={GLOBAL_ROOM_ID}>全屋自由区</option>
          </select>
          <select
            value={cabinetChoice}
            onChange={(e) => setCabinetChoice(e.target.value)}
            className="h-10 px-3 rounded-lg bg-white border border-slate-200 text-sm"
          >
            {roomId === GLOBAL_ROOM_ID ? (
              <option value="__global_loose__">全屋自由区</option>
            ) : (
              <>
                {roomCabinets.map((cabinet) => (
                  <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>
                ))}
                <option value="__room_loose__">此房间自由区</option>
              </>
            )}
          </select>
        </div>
      </div>
      <label className="block text-sm">
        <span className="text-xs font-medium text-ink-500">统一保质期（可选）</span>
        <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-50 border border-slate-200 text-sm" />
      </label>
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-sm">取消</button>
        <button onClick={save} disabled={busy} className="px-5 py-2 rounded-lg bg-brand-500 text-white text-sm disabled:bg-ink-300">
          {busy ? '添加中…' : '添加'}
        </button>
      </div>
    </div>
  );
}
