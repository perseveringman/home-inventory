import { useMemo, useState } from 'react';
import {
  PRESET_TAGS,
  type Item,
  type Cabinet,
  type Season,
  uid,
  compressImage,
  generateItemThumb,
} from '@home-inventory/core';
import { useStore } from '../../stores/useStore';
import { toast } from '../../components/Toast';
import { BlobImage } from '../../components/BlobImage';

interface Props {
  item?: Item;
  defaultCabinetId?: string;
  defaultRoomId?: string;
  onClose: () => void;
}

const SEASONS: Array<{ id: Season; label: string }> = [
  { id: '', label: '无' },
  { id: 'spring', label: '🌸 春' },
  { id: 'summer', label: '☀️ 夏' },
  { id: 'autumn', label: '🍂 秋' },
  { id: 'winter', label: '❄️ 冬' },
];

export default function ItemDialog({
  item,
  defaultCabinetId,
  defaultRoomId,
  onClose,
}: Props) {
  const put = useStore((s) => s.put);
  const cabinets = useStore((s) => s.cabinets);
  const rooms = useStore((s) => s.rooms);

  const [name, setName] = useState(item?.name || '');
  const [qty, setQty] = useState(item?.qty ?? 1);
  const [note, setNote] = useState(item?.note || '');
  const [expiry, setExpiry] = useState(item?.expiry || '');
  const [tags, setTags] = useState<string[]>(item?.tags || []);
  const [customTag, setCustomTag] = useState('');

  const [cabinetId, setCabinetId] = useState(
    item?.cabinetId || defaultCabinetId || ''
  );
  const [blob, setBlob] = useState<Blob | null>(item?.image || null);

  // 扩展字段
  const [showMore, setShowMore] = useState(false);
  const [openedAt, setOpenedAt] = useState(item?.openedAt || '');
  const [openedShelfDays, setOpenedShelfDays] = useState(
    item?.openedShelfDays ? String(item.openedShelfDays) : ''
  );
  const [purchasedAt, setPurchasedAt] = useState(item?.purchasedAt || '');
  const [warrantyMonths, setWarrantyMonths] = useState(
    item?.warrantyMonths ? String(item.warrantyMonths) : ''
  );
  const [minStock, setMinStock] = useState(
    item?.minStock != null ? String(item.minStock) : ''
  );
  const [season, setSeason] = useState<Season>(item?.season || '');

  const toggleTag = (t: string) => {
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  };
  const addCustomTag = () => {
    const t = customTag.trim();
    if (!t) return;
    if (!tags.includes(t)) setTags([...tags, t]);
    setCustomTag('');
  };

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const { blob: b } = await compressImage(f, 800, 0.78);
    setBlob(b);
  };

  const save = async () => {
    const n = name.trim();
    if (!n) {
      toast('请输入名称');
      return;
    }
    if (!cabinetId) {
      toast('请选择柜子');
      return;
    }
    const cab = cabinets.find((c) => c.id === cabinetId);
    if (!cab) {
      toast('柜子不存在');
      return;
    }
    let finalBlob = blob;
    if (!finalBlob && !item?.image) {
      finalBlob = await generateItemThumb(n, '📦');
    }

    const obj: Item = {
      id: item?.id || uid(),
      cabinetId,
      roomId: cab.roomId,
      name: n,
      qty: +qty || 1,
      note: note.trim(),
      tags,
      image: finalBlob || undefined,
      expiry: expiry || undefined,
      status: item?.status || 'placed',
      source: item?.source || 'manual',
      sourcePhotoId: item?.sourcePhotoId,
      aiEmoji: item?.aiEmoji,
      aiRect: item?.aiRect,
      openedAt: openedAt || undefined,
      openedShelfDays: openedShelfDays ? +openedShelfDays : null,
      purchasedAt: purchasedAt || undefined,
      warrantyMonths: warrantyMonths ? +warrantyMonths : null,
      minStock: minStock ? +minStock : null,
      season,
      createdAt: item?.createdAt || Date.now(),
      lastTouchedAt: Date.now(),
    };
    await put('items', obj);
    toast(item ? '已更新' : '已添加');
    onClose();
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{item ? '编辑物品' : '新增物品'}</h3>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-900 text-xl">
          ×
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
            placeholder="例如：维生素 C"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">数量</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(+e.target.value || 1)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">保质期</label>
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">所在柜子</label>
          <select
            value={cabinetId}
            onChange={(e) => setCabinetId(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
          >
            <option value="">—— 请选择 ——</option>
            {cabinets.map((c) => {
              const r = rooms.find((x) => x.id === c.roomId);
              const roomLabel = r ? r.name : '全屋';
              return (
                <option key={c.id} value={c.id}>
                  {roomLabel} · {c.name}
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">备注</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
            placeholder="选填"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">🏷️ 标签</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESET_TAGS.map((t) => (
              <button
                key={t.name}
                onClick={() => toggleTag(t.name)}
                className={`chip text-xs ${
                  tags.includes(t.name)
                    ? '!bg-brand-500 !text-white'
                    : '!bg-slate-100 !text-ink-700'
                }`}
              >
                {t.emoji} {t.name}
              </button>
            ))}
          </div>
          {tags.filter((t) => !PRESET_TAGS.find((p) => p.name === t)).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags
                .filter((t) => !PRESET_TAGS.find((p) => p.name === t))
                .map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className="chip !bg-brand-500 !text-white"
                  >
                    {t} ×
                  </button>
                ))}
            </div>
          )}
          <div className="flex gap-1">
            <input
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomTag()}
              placeholder="自定义标签"
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-sm"
            />
            <button
              onClick={addCustomTag}
              className="px-3 py-1 bg-slate-100 rounded-lg text-sm"
            >
              ＋
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">图片</label>
          <div className="flex items-center gap-3">
            {blob && (
              <BlobImage
                blob={blob}
                className="w-16 h-16 object-cover rounded-lg border border-slate-200"
              />
            )}
            <label className="cursor-pointer px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">
              选择图片
              <input type="file" accept="image/*" hidden onChange={pickPhoto} />
            </label>
            {blob && (
              <button
                onClick={() => setBlob(null)}
                className="text-sm text-red-500 hover:underline"
              >
                移除
              </button>
            )}
          </div>
        </div>

        <details open={showMore}>
          <summary
            className="cursor-pointer text-sm text-brand-600 py-1"
            onClick={(e) => {
              e.preventDefault();
              setShowMore(!showMore);
            }}
          >
            ⚡ 更多属性（开封期 / 保修 / 库存 / 季节）
          </summary>
          {showMore && (
            <div className="grid grid-cols-2 gap-3 mt-3 p-3 bg-slate-50 rounded-lg">
              <div>
                <label className="block text-xs text-ink-500 mb-1">开封日期</label>
                <input
                  type="date"
                  value={openedAt}
                  onChange={(e) => setOpenedAt(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">开封后可用天数</label>
                <input
                  type="number"
                  value={openedShelfDays}
                  onChange={(e) => setOpenedShelfDays(e.target.value)}
                  placeholder="如 90"
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">购买日期</label>
                <input
                  type="date"
                  value={purchasedAt}
                  onChange={(e) => setPurchasedAt(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">保修月数</label>
                <input
                  type="number"
                  value={warrantyMonths}
                  onChange={(e) => setWarrantyMonths(e.target.value)}
                  placeholder="如 12"
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">库存下限</label>
                <input
                  type="number"
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  placeholder="低于则提醒"
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">所属季节</label>
                <select
                  value={season}
                  onChange={(e) => setSeason(e.target.value as Season)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                >
                  {SEASONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </details>
      </div>

      <div className="flex gap-2 mt-5">
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
