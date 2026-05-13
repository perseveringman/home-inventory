import { useState } from 'react';
import {
  GLOBAL_ROOM_ID,
  PRESET_TAGS,
  compressImage,
  ensureGlobalLooseCabinet,
  ensureLooseCabinet,
  expiryInfo,
  generateItemThumb,
  suggestItemDraft,
  uid,
  type Item,
  type Season,
} from '@home-inventory/core';
import { BlobImage } from '../../components/BlobImage';
import { toast } from '../../components/Toast';
import { getStorage, useStore } from '../../stores/useStore';
import { PinIcon } from '../../components/PinIcon';

interface Props {
  item?: Item;
  defaultCabinetId?: string;
  defaultRoomId?: string;
  onClose: () => void;
}

const SEASONS: Array<{ id: Season; label: string }> = [
  { id: '', label: '无' },
  { id: 'spring', label: '春' },
  { id: 'summer', label: '夏' },
  { id: 'autumn', label: '秋' },
  { id: 'winter', label: '冬' },
];

export default function ItemDialog({ item, defaultCabinetId, defaultRoomId, onClose }: Props) {
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const cabinets = useStore((s) => s.cabinets);
  const rooms = useStore((s) => s.rooms);
  const photos = useStore((s) => s.photos);
  const items = useStore((s) => s.items);
  const initialCabinet = cabinets.find((c) => c.id === (item?.cabinetId || defaultCabinetId));
  const initialRoomId = item?.roomId || defaultRoomId || initialCabinet?.roomId || GLOBAL_ROOM_ID;
  const initialCabinetChoice =
    initialCabinet?.type === 'loose-global'
      ? '__global_loose__'
      : initialCabinet?.type === 'loose'
      ? '__room_loose__'
      : item?.cabinetId || defaultCabinetId || (initialRoomId === GLOBAL_ROOM_ID ? '__global_loose__' : '__room_loose__');

  const [name, setName] = useState(item?.name || '');
  const [qty, setQty] = useState(item?.qty ?? 1);
  const [note, setNote] = useState(item?.note || '');
  const [expiry, setExpiry] = useState(item?.expiry || '');
  const [tags, setTags] = useState<string[]>(item?.tags || []);
  const [customTag, setCustomTag] = useState('');
  const [roomId, setRoomId] = useState(initialRoomId);
  const [cabinetId, setCabinetId] = useState(initialCabinetChoice);
  const [blob, setBlob] = useState<Blob | null>(item?.image || null);
  const [showMore, setShowMore] = useState(false);
  const [openedAt, setOpenedAt] = useState(item?.openedAt || '');
  const [openedShelfDays, setOpenedShelfDays] = useState(item?.openedShelfDays ? String(item.openedShelfDays) : '');
  const [purchasedAt, setPurchasedAt] = useState(item?.purchasedAt || '');
  const [warrantyMonths, setWarrantyMonths] = useState(item?.warrantyMonths ? String(item.warrantyMonths) : '');
  const [minStock, setMinStock] = useState(item?.minStock != null ? String(item.minStock) : '');
  const [season, setSeason] = useState<Season>(item?.season || '');
  const [suggesting, setSuggesting] = useState(false);

  const roomCabinets = cabinets
    .filter((c) => c.roomId === roomId && (!c.type || c.type === 'normal'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sourcePhoto = item?.sourcePhotoId ? photos.find((p) => p.id === item.sourcePhotoId) : null;
  const expiryPreview = expiryInfo(expiry);

  const toggleTag = (tag: string) => {
    setTags((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]));
  };

  const addCustomTag = () => {
    const tag = customTag.trim().replace(/[,，]$/, '');
    if (!tag) return;
    if (!tags.includes(tag)) setTags((cur) => [...cur, tag]);
    setCustomTag('');
  };

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { blob: compressed } = await compressImage(file, 800, 0.78);
    setBlob(compressed);
  };

  const fillAISuggestion = async () => {
    if (suggesting) return;
    setSuggesting(true);
    toast('AI 正在思考…', 1800);
    try {
      const draftItem: Item = {
        id: item?.id || '__draft_item__',
        cabinetId,
        roomId,
        name: name.trim() || item?.name || '',
        qty: +qty || 1,
        note: note.trim(),
        tags,
        image: blob || item?.image,
        expiry: expiry || undefined,
        status: item?.status || 'pending',
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
        lastTouchedAt: item?.lastTouchedAt,
      };
      const suggestion = await suggestItemDraft(getStorage(), {
        item: draftItem,
        rooms,
        cabinets,
        items,
        today: new Date().toISOString().slice(0, 10),
      });

      let applied = 0;
      if (suggestion.name) {
        setName(suggestion.name);
        applied += 1;
      }
      if (suggestion.qty) {
        setQty(suggestion.qty);
        applied += 1;
      }
      if (suggestion.note) {
        setNote(suggestion.note);
        applied += 1;
      }
      if (suggestion.tags?.length) {
        setTags(suggestion.tags);
        applied += 1;
      }
      if (suggestion.expiry) {
        setExpiry(suggestion.expiry);
        applied += 1;
      }

      const suggestedCabinet = suggestion.cabinetId
        ? cabinets.find((cabinet) => cabinet.id === suggestion.cabinetId)
        : null;
      const nextRoomId = suggestedCabinet?.roomId || suggestion.roomId;
      if (nextRoomId) {
        setRoomId(nextRoomId);
        if (!suggestion.cabinetId) setCabinetId(nextRoomId === GLOBAL_ROOM_ID ? '__global_loose__' : '__room_loose__');
        applied += 1;
      }
      if (suggestion.cabinetId) {
        if (suggestedCabinet?.type === 'loose-global') setCabinetId('__global_loose__');
        else if (suggestedCabinet?.type === 'loose') setCabinetId('__room_loose__');
        else setCabinetId(suggestion.cabinetId);
        applied += 1;
      }

      let touchedMore = false;
      if (suggestion.openedShelfDays !== undefined) {
        setOpenedShelfDays(suggestion.openedShelfDays == null ? '' : String(suggestion.openedShelfDays));
        touchedMore = true;
        applied += 1;
      }
      if (suggestion.warrantyMonths !== undefined) {
        setWarrantyMonths(suggestion.warrantyMonths == null ? '' : String(suggestion.warrantyMonths));
        touchedMore = true;
        applied += 1;
      }
      if (suggestion.minStock !== undefined) {
        setMinStock(suggestion.minStock == null ? '' : String(suggestion.minStock));
        touchedMore = true;
        applied += 1;
      }
      if (suggestion.season) {
        setSeason(suggestion.season);
        touchedMore = true;
        applied += 1;
      }
      if (touchedMore) setShowMore(true);

      toast(
        applied
          ? suggestion.mode === 'local'
            ? '已用本地规则预填建议'
            : 'AI 建议已填入'
          : '暂时没有可采纳的建议',
        2400
      );
    } catch (err: any) {
      toast('AI 建议失败：' + (err?.message || 'unknown'), 3200);
    } finally {
      setSuggesting(false);
    }
  };

  const resolveCabinet = async () => {
    const storage = getStorage();
    if (cabinetId === '__global_loose__') return ensureGlobalLooseCabinet(storage);
    if (cabinetId === '__room_loose__') return ensureLooseCabinet(storage, roomId);
    return cabinets.find((c) => c.id === cabinetId);
  };

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast('请输入名称');
      return;
    }
    const cabinet = await resolveCabinet();
    if (!cabinet) {
      toast('请选择柜子');
      return;
    }
    if (cabinet.type === 'loose' || cabinet.type === 'loose-global') await put('cabinets', cabinet);
    const image = blob || item?.image || (await generateItemThumb(trimmedName, item?.aiEmoji || 'box'));
    const next: Item = {
      id: item?.id || uid(),
      cabinetId: cabinet.id,
      roomId: cabinet.roomId,
      name: trimmedName,
      qty: +qty || 1,
      note: note.trim(),
      tags,
      image,
      expiry: expiry || undefined,
      status: item?.status === 'pending' ? 'placed' : item?.status || 'placed',
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
    await put('items', next);
    toast(item?.status === 'pending' ? '已保存并归位' : item ? '已更新' : '已添加');
    onClose();
  };

  const remove = async () => {
    if (!item) return;
    if (!confirm(`删除物品「${item.name}」？`)) return;
    await del('items', item.id);
    toast('已删除');
    onClose();
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-lg font-semibold shrink-0">{item ? '编辑物品' : '新增物品'}</h3>
          {item?.status === 'pending' && (
            <button
              onClick={fillAISuggestion}
              disabled={suggesting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="AI 建议"
            >
              <PinIcon name="spark" size={18} tile={false} />
              <span className="whitespace-nowrap">{suggesting ? '思考中…' : 'AI 建议'}</span>
            </button>
          )}
        </div>
        <button onClick={onClose} className="text-ink-500 hover:text-ink-900 text-xl">×</button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" placeholder="例如：维生素 C" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">数量</label>
            <input type="number" value={qty} onChange={(e) => setQty(+e.target.value || 1)} className="w-full border border-slate-200 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">保质期</label>
            <div className="flex gap-1">
              <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2" />
              {expiry && <button onClick={() => setExpiry('')} className="px-2 rounded-lg bg-slate-100 text-xs">清除</button>}
            </div>
            {expiryPreview && <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border ${expiryPreview.cls}`}>{expiryPreview.label}</span>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">所在位置</label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={roomId}
              onChange={(e) => {
                const next = e.target.value;
                setRoomId(next);
                setCabinetId(next === GLOBAL_ROOM_ID ? '__global_loose__' : '__room_loose__');
              }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>{room.name}</option>
              ))}
              <option value={GLOBAL_ROOM_ID}>全屋自由区</option>
            </select>
            <select value={cabinetId} onChange={(e) => setCabinetId(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-white">
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

        <div>
          <label className="block text-sm font-medium mb-1">备注</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2" placeholder="选填" />
        </div>

        <div>
          <label className="text-sm font-medium mb-1 inline-flex items-center gap-2"><PinIcon name="tag" size={26} tile={false} />标签</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESET_TAGS.map((tag) => (
              <button key={tag.name} onClick={() => toggleTag(tag.name)} className={`chip text-xs ${tags.includes(tag.name) ? '!bg-brand-500 !text-white' : '!bg-slate-100 !text-ink-700'}`}>
                {tag.name}
              </button>
            ))}
          </div>
          {tags.filter((tag) => !PRESET_TAGS.find((preset) => preset.name === tag)).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags
                .filter((tag) => !PRESET_TAGS.find((preset) => preset.name === tag))
                .map((tag) => (
                  <button key={tag} onClick={() => toggleTag(tag)} className="chip !bg-brand-500 !text-white">{tag} ×</button>
                ))}
            </div>
          )}
          <div className="flex gap-1">
            <input
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
                  e.preventDefault();
                  addCustomTag();
                }
              }}
              placeholder="自定义标签"
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-sm"
            />
            <button onClick={addCustomTag} className="px-3 py-1 bg-slate-100 rounded-lg text-sm"><PinIcon name="add" size={22} tile={false} /></button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">图片</label>
          <div className="flex items-center gap-3">
            {blob && <BlobImage blob={blob} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />}
            <label className="cursor-pointer px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">
              选择图片
              <input type="file" accept="image/*" hidden onChange={pickPhoto} />
            </label>
            <label className="cursor-pointer px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">
              拍照
              <input type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
            </label>
            {blob && <button onClick={() => setBlob(null)} className="text-sm text-red-500 hover:underline">移除</button>}
          </div>
        </div>

        {sourcePhoto && item?.aiRect && (
          <details className="rounded-xl bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm text-brand-600">来源照片与 AI 框选</summary>
            <div className="relative mt-3 bg-black rounded-xl overflow-hidden">
              <BlobImage blob={sourcePhoto.blob} className="w-full max-h-64 object-contain" />
              <div
                className="absolute border-2 border-rose-400 bg-rose-400/20 rounded"
                style={{ left: `${item.aiRect.x * 100}%`, top: `${item.aiRect.y * 100}%`, width: `${item.aiRect.w * 100}%`, height: `${item.aiRect.h * 100}%` }}
              />
            </div>
          </details>
        )}

        <details open={showMore}>
          <summary
            className="cursor-pointer text-sm text-brand-600 py-1"
            onClick={(e) => {
              e.preventDefault();
              setShowMore(!showMore);
            }}
          >
            更多属性（开封期 / 保修 / 库存 / 季节）
          </summary>
          {showMore && (
            <div className="grid grid-cols-2 gap-3 mt-3 p-3 bg-slate-50 rounded-lg">
              <div>
                <label className="block text-xs text-ink-500 mb-1">开封日期</label>
                <input type="date" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">开封后可用天数</label>
                <input type="number" value={openedShelfDays} onChange={(e) => setOpenedShelfDays(e.target.value)} placeholder="如 90" className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">购买日期</label>
                <input type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">保修月数</label>
                <input type="number" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} placeholder="如 12" className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">库存下限</label>
                <input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} placeholder="低于则提醒" className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-ink-500 mb-1">所属季节</label>
                <select value={season} onChange={(e) => setSeason(e.target.value as Season)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                  {SEASONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </div>
          )}
        </details>
      </div>

      <div className="flex gap-2 mt-5">
        {item && <button onClick={remove} className="px-4 py-2.5 rounded-lg border border-red-200 text-red-600">删除</button>}
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-ink-700">取消</button>
        <button onClick={save} className="flex-1 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium">
          {item?.status === 'pending' ? '保存并归位' : '保存'}
        </button>
      </div>
    </div>
  );
}
