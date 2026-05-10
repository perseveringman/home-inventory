import { useState } from 'react';
import type { Cabinet } from '@home-inventory/core';
import { useStore } from '../../stores/useStore';
import { toast } from '../../components/Toast';

interface Props {
  cabinet: Cabinet;
  onClose: () => void;
}

export default function CabinetDialog({ cabinet, onClose }: Props) {
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const items = useStore((s) => s.items);
  const [name, setName] = useState(cabinet.name);

  const save = async () => {
    const n = name.trim();
    if (!n) {
      toast('请输入名称');
      return;
    }
    await put('cabinets', { ...cabinet, name: n });
    toast('已更新');
    onClose();
  };

  const remove = async () => {
    const inside = items.filter((i) => i.cabinetId === cabinet.id);
    if (
      !confirm(
        `删除柜子「${cabinet.name}」？${
          inside.length ? `其中 ${inside.length} 件物品会一并删除。` : ''
        }`
      )
    )
      return;
    for (const it of inside) await del('items', it.id);
    await del('cabinets', cabinet.id);
    toast('已删除');
    onClose();
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">编辑柜子</h3>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-900 text-xl">
          ×
        </button>
      </div>

      <label className="block text-sm font-medium mb-1">柜子名</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-4"
      />

      <div className="flex gap-2">
        <button
          onClick={remove}
          className="px-4 py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
        >
          删除
        </button>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="px-4 py-2.5 rounded-lg border border-slate-200 text-ink-700"
        >
          取消
        </button>
        <button
          onClick={save}
          className="px-6 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium"
        >
          保存
        </button>
      </div>
    </div>
  );
}
