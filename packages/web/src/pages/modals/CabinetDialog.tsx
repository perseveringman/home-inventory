import { useState } from 'react';
import {
  compressImage,
  expiryInfo,
  generateItemThumb,
  uid,
  type Cabinet,
  type Item,
} from '@home-inventory/core';
import { useStore } from '../../stores/useStore';
import { toast } from '../../components/Toast';
import { BlobImage } from '../../components/BlobImage';
import { openModal } from '../../components/Modal';
import { PinIcon } from '../../components/PinIcon';
import { Glyph } from '../../components/Glyph';
import ItemDialog from './ItemDialog';

interface Props {
  cabinet: Cabinet;
  onClose: () => void;
}

export default function CabinetDialog({ cabinet, onClose }: Props) {
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const items = useStore((s) => s.items);
  const [name, setName] = useState(cabinet.name);
  const [itemName, setItemName] = useState('');
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [expiry, setExpiry] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);

  const inside = items
    .filter((i) => i.cabinetId === cabinet.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  const save = async (closeAfter = true) => {
    const n = name.trim();
    if (!n) {
      toast('请输入名称');
      return;
    }
    await put('cabinets', { ...cabinet, name: n });
    toast('已更新');
    if (closeAfter) onClose();
  };

  const remove = async () => {
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

  const addItem = async () => {
    const n = itemName.trim();
    if (!n) {
      toast('请输入物品名称');
      return;
    }
    const image = blob || (await generateItemThumb(n, 'box'));
    const item: Item = {
      id: uid(),
      homeId: cabinet.homeId,
      cabinetId: cabinet.id,
      roomId: cabinet.roomId,
      name: n,
      qty: +qty || 1,
      note: note.trim(),
      tags: [],
      image,
      expiry: expiry || undefined,
      status: 'placed',
      source: 'manual',
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
    };
    await put('items', item);
    setItemName('');
    setQty(1);
    setNote('');
    setExpiry('');
    setBlob(null);
    toast('已添加物品');
  };

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const compressed = await compressImage(file, 800, 0.78);
    setBlob(compressed.blob);
  };

  const removeItem = async (item: Item) => {
    if (!confirm(`删除物品「${item.name}」？`)) return;
    await del('items', item.id);
    toast('已删除');
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold inline-flex items-center gap-2"><PinIcon name="cabinet" size={30} />编辑柜子</h3>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-900 text-xl">
          ×
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">柜子名</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => save(false)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />
        </div>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium">柜内物品</h4>
            <span className="text-xs text-ink-500">{inside.length} 件</span>
          </div>
          {inside.length === 0 ? (
            <div className="text-center py-8 bg-slate-50 rounded-xl text-sm text-ink-400">还没有物品</div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {inside.map((item) => {
                const info = expiryInfo(item.expiry);
                return (
                  <button
                    key={item.id}
                    onClick={() => openModal((close) => <ItemDialog item={item} onClose={close} />)}
                    className="relative group text-left rounded-xl bg-slate-50 hover:bg-slate-100 p-1.5"
                  >
                    <BlobImage blob={item.image || null} emoji={item.aiEmoji || 'box'} className="w-full aspect-square rounded-lg object-cover" />
                    <div className="text-[11px] font-medium truncate mt-1">{item.name}</div>
                    <div className="text-[10px] text-ink-400">× {item.qty}</div>
                    {info && <div className={`mt-0.5 text-[9px] px-1 rounded border truncate ${info.cls}`}>{info.label}</div>}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(item);
                      }}
                      className="absolute -right-1 -top-1 hidden group-hover:flex w-5 h-5 rounded-full bg-red-500 text-white text-xs items-center justify-center"
                    >
                      ×
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl bg-brand-50 p-3 space-y-2">
          <h4 className="font-medium text-sm text-brand-700 inline-flex items-center gap-2"><PinIcon name="add" size={26} tile={false} />添加物品到这个柜子</h4>
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="名称" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={qty} onChange={(e) => setQty(+e.target.value || 1)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="备注" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <div className="flex items-center gap-2">
            {blob && <BlobImage blob={blob} className="w-12 h-12 rounded-lg object-cover" />}
            <label className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm cursor-pointer inline-flex items-center gap-1.5">
              <Glyph name="image" size={16} />选图
              <input type="file" accept="image/*" hidden onChange={pickPhoto} />
            </label>
            <label className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm cursor-pointer inline-flex items-center gap-1.5">
              <Glyph name="camera" size={16} />拍照
              <input type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
            </label>
            <button onClick={addItem} className="ml-auto px-4 py-2 rounded-lg bg-brand-500 text-white text-sm">添加</button>
          </div>
        </section>
      </div>

      <div className="flex gap-2 mt-5">
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
          onClick={() => save()}
          className="px-6 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium"
        >
          保存
        </button>
      </div>
    </div>
  );
}
