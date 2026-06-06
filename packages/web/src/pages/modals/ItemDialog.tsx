import { useState } from 'react';
import {
  GLOBAL_ROOM_ID,
  PRESET_TAGS,
  compressImage,
  ensureGlobalLooseCabinet,
  ensureLooseCabinet,
  expiryInfo,
  generateSemanticThumb,
  suggestItemDraft,
  suggestItemSemantic,
  uid,
  type Item,
  type Season,
} from '@home-inventory/core';
import { BlobImage } from '../../components/BlobImage';
import { ItemThumb } from '../../components/ItemThumb';
import { toast } from '../../components/Toast';
import { getStorage, useStore } from '../../stores/useStore';
import { PinIcon } from '../../components/PinIcon';
import { Glyph } from '../../components/Glyph';
import { pickImage } from '../../lib/nativeImage';

interface Props {
  item?: Item;
  defaultCabinetId?: string;
  defaultRoomId?: string;
  defaultName?: string;
  defaultNote?: string;
  defaultTags?: string[];
  onClose: () => void;
}

const SEASONS: Array<{ id: Season; label: string }> = [
  { id: '', label: '无' },
  { id: 'spring', label: '春' },
  { id: 'summer', label: '夏' },
  { id: 'autumn', label: '秋' },
  { id: 'winter', label: '冬' },
];

export default function ItemDialog({
  item,
  defaultCabinetId,
  defaultRoomId,
  defaultName = '',
  defaultNote = '',
  defaultTags = [],
  onClose,
}: Props) {
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

  const [name, setName] = useState(item?.name || defaultName);
  const [qty, setQty] = useState(item?.qty ?? 1);
  const [note, setNote] = useState(item?.note || defaultNote);
  const [expiry, setExpiry] = useState(item?.expiry || '');
  const [tags, setTags] = useState<string[]>(item?.tags || defaultTags);
  const [customTag, setCustomTag] = useState('');
  const [roomId, setRoomId] = useState(initialRoomId);
  const [cabinetId, setCabinetId] = useState(initialCabinetChoice);
  const [blob, setBlob] = useState<Blob | null>(item?.image || null);
  /** 用户是否在本次编辑里主动改过图片（拍照 / 选图 / 移除 / AI 配图）。
   *  保存时，如果没有 dirty 且原 item 已有图 → 保持原图不动，避免被默认图覆盖。 */
  const [imageDirty, setImageDirty] = useState(false);
  const [generatingThumb, setGeneratingThumb] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [openedAt, setOpenedAt] = useState(item?.openedAt || '');
  const [openedShelfDays, setOpenedShelfDays] = useState(item?.openedShelfDays ? String(item.openedShelfDays) : '');
  const [purchasedAt, setPurchasedAt] = useState(item?.purchasedAt || '');
  const [warrantyMonths, setWarrantyMonths] = useState(item?.warrantyMonths ? String(item.warrantyMonths) : '');
  const [minStock, setMinStock] = useState(item?.minStock != null ? String(item.minStock) : '');
  const [season, setSeason] = useState<Season>(item?.season || '');
  const [brand, setBrand] = useState(item?.brand || '');
  const [modelNumber, setModelNumber] = useState(item?.modelNumber || '');
  const [serialNumber, setSerialNumber] = useState(item?.serialNumber || '');
  const [purchasePrice, setPurchasePrice] = useState(item?.purchasePrice != null ? String(item.purchasePrice) : '');
  const [manualUrl, setManualUrl] = useState(item?.manualUrl || '');
  const [receiptNote, setReceiptNote] = useState(item?.receiptNote || '');
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

  const pickPhoto = async (source: 'camera' | 'gallery') => {
    try {
      const file = await pickImage({ source });
      if (!file) return;
      const { blob: compressed } = await compressImage(file, 800, 0.78);
      setBlob(compressed);
      setImageDirty(true);
    } catch (err: any) {
      console.error(err);
      toast('打开相机失败：' + (err?.message || 'unknown'));
    }
  };

  const removePhoto = () => {
    setBlob(null);
    setImageDirty(true);
  };

  const aiGenerateThumb = async () => {
    if (generatingThumb) return;
    if (!name.trim()) {
      toast('请先填写物品名称');
      return;
    }
    setGeneratingThumb(true);
    try {
      const guess = await suggestItemSemantic(getStorage(), {
        name: name.trim(),
        tags,
        note,
      });
      const thumb = await generateSemanticThumb(guess.emoji, name.trim(), guess.hue);
      setBlob(thumb);
      setImageDirty(true);
      toast(guess.source === 'ai' ? `AI 配图：${guess.emoji}` : `本地配图：${guess.emoji}`);
    } catch (err: any) {
      console.error(err);
      toast('AI 配图失败：' + (err?.message || 'unknown'));
    } finally {
      setGeneratingThumb(false);
    }
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
        brand: brand.trim() || undefined,
        modelNumber: modelNumber.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        purchasePrice: purchasePrice ? +purchasePrice : null,
        manualUrl: manualUrl.trim() || undefined,
        receiptNote: receiptNote.trim() || undefined,
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
      if (suggestion.brand) {
        setBrand(suggestion.brand);
        touchedMore = true;
        applied += 1;
      }
      if (suggestion.modelNumber) {
        setModelNumber(suggestion.modelNumber);
        touchedMore = true;
        applied += 1;
      }
      if (suggestion.serialNumber) {
        setSerialNumber(suggestion.serialNumber);
        touchedMore = true;
        applied += 1;
      }
      if (suggestion.purchasePrice !== undefined) {
        setPurchasePrice(suggestion.purchasePrice == null ? '' : String(suggestion.purchasePrice));
        touchedMore = true;
        applied += 1;
      }
      if (suggestion.manualUrl) {
        setManualUrl(suggestion.manualUrl);
        touchedMore = true;
        applied += 1;
      }
      if (suggestion.receiptNote) {
        setReceiptNote(suggestion.receiptNote);
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
    // 图片决策：
    // 1) 用户在本次编辑里改过 → 用 blob（可能为 null，表示主动移除）
    // 2) 否则保留原 item 的图（编辑时不要被覆盖成默认图）
    // 3) 全新物品且没有图 → 不再生成丑的默认贴纸图，留空让 ItemThumb 显示语义图
    let image: Blob | undefined;
    if (imageDirty) {
      image = blob || undefined;
    } else {
      image = item?.image || blob || undefined;
    }
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
      brand: brand.trim() || undefined,
      modelNumber: modelNumber.trim() || undefined,
      serialNumber: serialNumber.trim() || undefined,
      purchasePrice: purchasePrice ? +purchasePrice : null,
      manualUrl: manualUrl.trim() || undefined,
      receiptNote: receiptNote.trim() || undefined,
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
    <div className="item-dialog">
      <div className="item-dialog__grabber" aria-hidden="true" />

      <div className="item-dialog__header">
        <div className="min-w-0">
          <div className="item-dialog__eyebrow">{item ? '物品档案' : '新物品'}</div>
          <h3>{item ? '编辑物品' : '新增物品'}</h3>
          <p>{name.trim() || item?.name || '先填名称，再补照片、位置和保质期'}</p>
        </div>
        <div className="item-dialog__header-actions">
          {item?.status === 'pending' && (
            <button
              type="button"
              onClick={fillAISuggestion}
              disabled={suggesting}
              className="item-dialog__ai-button"
              aria-label="AI 建议"
            >
              <PinIcon name="spark" size={18} tile={false} />
              <span>{suggesting ? '思考中' : 'AI 建议'}</span>
            </button>
          )}
          <button type="button" onClick={onClose} className="item-dialog__icon-button" aria-label="关闭">
            <Glyph name="close" size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="item-dialog__body">
        <section className="item-dialog__section">
          <div className="item-dialog__section-heading">
            <span>基础信息</span>
          </div>
          <div className="item-dialog__hero-row">
            <div className="item-dialog__thumb">
              {blob ? (
                <BlobImage blob={blob} className="h-full w-full object-cover" />
              ) : (
                <ItemThumb
                  item={{ name: name || item?.name || '', tags, aiEmoji: item?.aiEmoji, image: undefined }}
                  className="h-full w-full"
                  preferBlob={false}
                />
              )}
            </div>
            <label className="item-dialog__field item-dialog__field--grow">
              <span>名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="item-dialog__input item-dialog__input--title"
                placeholder="例如：维生素 C"
              />
            </label>
          </div>

          <div className="item-dialog__grid item-dialog__grid--quantity">
            <label className="item-dialog__field">
              <span>数量</span>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(+e.target.value || 1)}
                className="item-dialog__input"
                inputMode="numeric"
              />
            </label>
            <label className="item-dialog__field">
              <span className="item-dialog__label-row">
                保质期
                {expiryPreview && <em className={`item-dialog__date-badge ${expiryPreview.cls}`}>{expiryPreview.label}</em>}
              </span>
              <div className="item-dialog__inline-control">
                <input
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="item-dialog__input"
                />
                {expiry && (
                  <button type="button" onClick={() => setExpiry('')} className="item-dialog__mini-button">
                    清除
                  </button>
                )}
              </div>
            </label>
          </div>
        </section>

        <section className="item-dialog__section">
          <div className="item-dialog__section-heading">
            <span>位置</span>
          </div>
          <div className="item-dialog__grid">
            <label className="item-dialog__field">
              <span>房间</span>
              <select
                value={roomId}
                onChange={(e) => {
                  const next = e.target.value;
                  setRoomId(next);
                  setCabinetId(next === GLOBAL_ROOM_ID ? '__global_loose__' : '__room_loose__');
                }}
                className="item-dialog__input"
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
                <option value={GLOBAL_ROOM_ID}>全屋自由区</option>
              </select>
            </label>
            <label className="item-dialog__field">
              <span>收纳处</span>
              <select value={cabinetId} onChange={(e) => setCabinetId(e.target.value)} className="item-dialog__input">
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
            </label>
          </div>
        </section>

        <section className="item-dialog__section">
          <div className="item-dialog__section-heading">
            <span>备注</span>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="item-dialog__input item-dialog__textarea"
            placeholder="选填：规格、放置细节、使用提醒"
          />
        </section>

        <section className="item-dialog__section">
          <div className="item-dialog__section-heading">
            <span>标签</span>
            <PinIcon name="tag" size={22} tile={false} />
          </div>
          <div className="item-dialog__chips" aria-label="预设标签">
            {PRESET_TAGS.map((tag) => (
              <button
                key={tag.name}
                type="button"
                onClick={() => toggleTag(tag.name)}
                className={`item-dialog__chip ${tags.includes(tag.name) ? 'is-selected' : ''}`}
              >
                {tag.name}
              </button>
            ))}
          </div>
          {tags.filter((tag) => !PRESET_TAGS.find((preset) => preset.name === tag)).length > 0 && (
            <div className="item-dialog__chips item-dialog__chips--selected" aria-label="自定义标签">
              {tags
                .filter((tag) => !PRESET_TAGS.find((preset) => preset.name === tag))
                .map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="item-dialog__chip is-selected"
                  >
                    {tag} ×
                  </button>
                ))}
            </div>
          )}
          <div className="item-dialog__tag-row">
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
              className="item-dialog__input"
            />
            <button type="button" onClick={addCustomTag} className="item-dialog__icon-button" aria-label="添加标签">
              <Glyph name="plus" size={18} strokeWidth={1.8} />
            </button>
          </div>
        </section>

        <section className="item-dialog__section">
          <div className="item-dialog__section-heading">
            <span>图片</span>
            <small>{blob ? '已使用自定义图片' : '当前显示语义图标'}</small>
          </div>
          <div className="item-dialog__photo-actions">
            <button type="button" onClick={() => pickPhoto('gallery')} className="item-dialog__action-pill">
              <Glyph name="image" size={17} />
              选图
            </button>
            <button type="button" onClick={() => pickPhoto('camera')} className="item-dialog__action-pill">
              <Glyph name="camera" size={17} />
              拍照
            </button>
            <button
              type="button"
              onClick={aiGenerateThumb}
              disabled={generatingThumb}
              className="item-dialog__action-pill item-dialog__action-pill--accent"
            >
              <PinIcon name="spark" size={16} tile={false} />
              {generatingThumb ? '配图中' : 'AI 配图'}
            </button>
            {blob && (
              <button type="button" onClick={removePhoto} className="item-dialog__action-pill item-dialog__action-pill--danger">
                移除
              </button>
            )}
          </div>
          {!blob && <p className="item-dialog__hint">没有图片时，会按物品名称自动生成识别度更高的缩略图。</p>}
        </section>

        {sourcePhoto && item?.aiRect && (
          <details className="item-dialog__details">
            <summary>来源照片与 AI 框选</summary>
            <div className="item-dialog__source-photo">
              <BlobImage blob={sourcePhoto.blob} className="h-full max-h-64 w-full object-contain" />
              <div
                className="absolute rounded border-2 border-rose-400 bg-rose-400/20"
                style={{ left: `${item.aiRect.x * 100}%`, top: `${item.aiRect.y * 100}%`, width: `${item.aiRect.w * 100}%`, height: `${item.aiRect.h * 100}%` }}
              />
            </div>
          </details>
        )}

        <details open={showMore} className="item-dialog__details">
          <summary
            onClick={(e) => {
              e.preventDefault();
              setShowMore(!showMore);
            }}
          >
            更多属性
            <span>开封期 / 保修 / 库存 / 资产档案</span>
          </summary>
          {showMore && (
            <div className="item-dialog__more-grid">
              <label className="item-dialog__field">
                <span>开封日期</span>
                <input type="date" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} className="item-dialog__input" />
              </label>
              <label className="item-dialog__field">
                <span>开封后可用天数</span>
                <input type="number" value={openedShelfDays} onChange={(e) => setOpenedShelfDays(e.target.value)} placeholder="如 90" className="item-dialog__input" inputMode="numeric" />
              </label>
              <label className="item-dialog__field">
                <span>购买日期</span>
                <input type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} className="item-dialog__input" />
              </label>
              <label className="item-dialog__field">
                <span>保修月数</span>
                <input type="number" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} placeholder="如 12" className="item-dialog__input" inputMode="numeric" />
              </label>
              <label className="item-dialog__field">
                <span>库存下限</span>
                <input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} placeholder="低于则提醒" className="item-dialog__input" inputMode="numeric" />
              </label>
              <label className="item-dialog__field">
                <span>所属季节</span>
                <select value={season} onChange={(e) => setSeason(e.target.value as Season)} className="item-dialog__input">
                  {SEASONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="item-dialog__field">
                <span>品牌</span>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="如 Apple" className="item-dialog__input" />
              </label>
              <label className="item-dialog__field">
                <span>型号</span>
                <input value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} placeholder="Model" className="item-dialog__input" />
              </label>
              <label className="item-dialog__field">
                <span>序列号</span>
                <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="Serial" className="item-dialog__input" />
              </label>
              <label className="item-dialog__field">
                <span>购买价</span>
                <input type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="金额" className="item-dialog__input" inputMode="decimal" />
              </label>
              <label className="item-dialog__field item-dialog__field--span">
                <span>说明书链接</span>
                <input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://..." className="item-dialog__input" />
              </label>
              <label className="item-dialog__field item-dialog__field--span">
                <span>收据 / 资产备注</span>
                <textarea value={receiptNote} onChange={(e) => setReceiptNote(e.target.value)} rows={2} placeholder="小票位置、铭牌照片、保险备注等" className="item-dialog__input item-dialog__textarea" />
              </label>
            </div>
          )}
        </details>
      </div>

      <div className="item-dialog__footer">
        {item && (
          <button type="button" onClick={remove} className="item-dialog__footer-button item-dialog__footer-button--danger">
            <Glyph name="trash" size={17} />
            删除
          </button>
        )}
        <button type="button" onClick={onClose} className="item-dialog__footer-button item-dialog__footer-button--secondary">
          取消
        </button>
        <button type="button" onClick={save} className="item-dialog__footer-button item-dialog__footer-button--primary">
          {item?.status === 'pending' ? '保存并归位' : '保存'}
        </button>
      </div>
    </div>
  );
}
