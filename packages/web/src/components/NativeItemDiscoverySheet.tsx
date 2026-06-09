import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  GLOBAL_ROOM_ID,
  createNativeItemRecognitionTask,
  cropItemFromPhoto,
  uid,
  type Photo,
  type RecognitionTaskNativeItem,
  type Rect,
} from '@home-inventory/core';
import { prepareNativeItemDiscovery, type NativeDiscoveredBox } from '../lib/nativeDiscovery';
import { removeBackgroundWithNativeVision } from '../lib/nativeVision';
import { getStorage, useStore } from '../stores/useStore';
import { toast } from './Toast';
import { Glyph } from './Glyph';

type Step = 'boxes' | 'items';
type ResizeMode = 'nw' | 'ne' | 'sw' | 'se';

interface Props {
  file: Blob;
  roomId?: string;
  onClose: () => void;
}

interface BoxDraft extends NativeDiscoveredBox {
  id: string;
}

interface CropDraft {
  id: string;
  rect: Rect;
  originalBlob: Blob;
  originalUrl: string;
  cutoutBlob?: Blob;
  cutoutUrl?: string;
  backgroundRemoved: boolean;
  rotation: number;
  confidence?: number;
  nameHint?: string;
}

interface PhotoDraft {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

interface DragState {
  id: string;
  mode: 'move' | ResizeMode;
  startX: number;
  startY: number;
  startRect: Rect;
}

const MIN_BOX = 0.045;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function clampRect(rect: Rect): Rect {
  let w = clamp(rect.w, MIN_BOX, 1);
  let h = clamp(rect.h, MIN_BOX, 1);
  let x = clamp(rect.x, 0, 1 - w);
  let y = clamp(rect.y, 0, 1 - h);
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x, y, w, h };
}

function itemBlob(item: CropDraft): Blob {
  return item.backgroundRemoved && item.cutoutBlob ? item.cutoutBlob : item.originalBlob;
}

function itemUrl(item: CropDraft): string {
  return item.backgroundRemoved && item.cutoutUrl ? item.cutoutUrl : item.originalUrl;
}

async function rotateBlob(blob: Blob, background?: string): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(bmp.width, bmp.height);
  canvas.height = canvas.width;
  const ctx = canvas.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close?.();
  return new Promise<Blob>((resolve) => canvas.toBlob((next) => resolve(next || blob), 'image/png'));
}

async function removeItemBackground(blob: Blob): Promise<Blob | null> {
  return removeBackgroundWithNativeVision(blob);
}

export function NativeItemDiscoverySheet({ file, roomId = GLOBAL_ROOM_ID, onClose }: Props) {
  const reloadAll = useStore((s) => s.reloadAll);
  const [step, setStep] = useState<Step>('boxes');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [boxes, setBoxes] = useState<BoxDraft[]>([]);
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
  const [items, setItems] = useState<CropDraft[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const urlsRef = useRef<string[]>([]);

  const activeBox = useMemo(() => boxes.find((box) => box.id === activeBoxId), [activeBoxId, boxes]);

  const makeUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urlsRef.current.push(url);
    return url;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setStep('boxes');
    setItems([]);
    setBoxes([]);
    setActiveBoxId(null);

    void (async () => {
      try {
        const draft = await prepareNativeItemDiscovery(file);
        if (cancelled) return;
        const url = makeUrl(draft.blob);
        const nextBoxes = draft.boxes.map((box, index) => ({
          ...box,
          id: box.id || uid(),
          rect: clampRect(box.rect),
          nameHint: box.nameHint,
        }));
        setPhoto({ blob: draft.blob, width: draft.width, height: draft.height, url });
        setBoxes(nextBoxes);
        setActiveBoxId(nextBoxes[0]?.id || null);
        if (!nextBoxes.length) {
          setError('本机没有找到稳定物品框，可以点 + 手动添加。');
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || '本机识别失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const bounds = stageRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const dx = (event.clientX - drag.startX) / bounds.width;
      const dy = (event.clientY - drag.startY) / bounds.height;
      setBoxes((current) =>
        current.map((box) => {
          if (box.id !== drag.id) return box;
          const next = { ...drag.startRect };
          if (drag.mode === 'move') {
            next.x += dx;
            next.y += dy;
          } else {
            if (drag.mode.includes('e')) next.w += dx;
            if (drag.mode.includes('s')) next.h += dy;
            if (drag.mode.includes('w')) {
              next.x += dx;
              next.w -= dx;
            }
            if (drag.mode.includes('n')) {
              next.y += dy;
              next.h -= dy;
            }
          }
          return { ...box, rect: clampRect(next) };
        })
      );
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag]);

  const beginDrag = (event: ReactPointerEvent, box: BoxDraft, mode: 'move' | ResizeMode) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveBoxId(box.id);
    setDrag({
      id: box.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startRect: box.rect,
    });
  };

  const addBox = () => {
    const next: BoxDraft = {
      id: uid(),
      rect: { x: 0.18, y: 0.36, w: 0.64, h: 0.22 },
      source: 'foreground',
      nameHint: undefined,
      confidence: 0.5,
    };
    setBoxes((current) => [...current, next]);
    setActiveBoxId(next.id);
    setError('');
  };

  const deleteActiveBox = () => {
    if (!activeBoxId) return;
    setBoxes((current) => current.filter((box) => box.id !== activeBoxId));
    setActiveBoxId(null);
  };

  const makeCrops = async () => {
    if (!photo || !boxes.length) {
      setError('至少需要一个物品框。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const drafts: CropDraft[] = [];
      for (let index = 0; index < boxes.length; index += 1) {
        const box = boxes[index]!;
        const crop = await cropItemFromPhoto(photo.blob, box.rect, {
          maxSize: 860,
          paddingRatio: 0.08,
          contain: true,
          background: '#ffffff',
        });
        if (!crop) continue;
        const url = makeUrl(crop);
        drafts.push({
          id: uid(),
          rect: box.rect,
          originalBlob: crop,
          originalUrl: url,
          backgroundRemoved: false,
          rotation: 0,
          confidence: box.confidence,
          nameHint: box.nameHint,
        });
      }
      if (!drafts.length) {
        setError('没有成功裁出物品图，请调整识别框。');
        return;
      }
      setItems(drafts);
      setStep('items');
    } finally {
      setBusy(false);
    }
  };

  const rotateItem = async (itemId: string) => {
    const target = items.find((item) => item.id === itemId);
    if (!target) return;
    setBusy(true);
    try {
      const originalBlob = await rotateBlob(target.originalBlob, '#ffffff');
      const cutoutBlob = target.cutoutBlob ? await rotateBlob(target.cutoutBlob) : undefined;
      const originalUrl = makeUrl(originalBlob);
      const cutoutUrl = cutoutBlob ? makeUrl(cutoutBlob) : undefined;
      setItems((current) =>
        current.map((item) =>
          item.id === itemId
            ? {
                ...item,
                originalBlob,
                originalUrl,
                cutoutBlob,
                cutoutUrl,
                rotation: (item.rotation + 90) % 360,
              }
            : item
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = (itemId: string) => {
    setItems((current) => {
      const target = current.find((item) => item.id === itemId);
      if (target) {
        URL.revokeObjectURL(target.originalUrl);
        if (target.cutoutUrl) URL.revokeObjectURL(target.cutoutUrl);
      }
      return current.filter((item) => item.id !== itemId);
    });
  };

  const toggleBackgroundRemoval = async () => {
    if (!items.length || busy || backgroundBusy) return;
    const showingCutouts = items.some((item) => item.backgroundRemoved);
    if (showingCutouts) {
      setItems((current) => current.map((item) => ({ ...item, backgroundRemoved: false })));
      setError('');
      return;
    }

    setBackgroundBusy(true);
    setError('');
    try {
      const next: CropDraft[] = [];
      let failed = 0;
      for (const item of items) {
        if (item.cutoutBlob && item.cutoutUrl) {
          next.push({ ...item, backgroundRemoved: true });
          continue;
        }
        const cutoutBlob = await removeItemBackground(item.originalBlob);
        if (!cutoutBlob) {
          failed += 1;
          next.push(item);
          continue;
        }
        next.push({
          ...item,
          cutoutBlob,
          cutoutUrl: makeUrl(cutoutBlob),
          backgroundRemoved: true,
        });
      }
      setItems(next);
      if (failed) {
        setError(`有 ${failed} 件物品没有抠出清晰主体，已保留原图。`);
      }
    } finally {
      setBackgroundBusy(false);
    }
  };

  const confirm = async () => {
    if (!photo || !items.length) {
      setError('没有可提交的物品。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const storage = getStorage();
      const storedPhoto: Photo = {
        id: uid(),
        roomId,
        blob: photo.blob,
        width: photo.width,
        height: photo.height,
        createdAt: Date.now(),
      };
      await storage.put('photos', storedPhoto);
      const nativeItems: RecognitionTaskNativeItem[] = items.map((item) => ({
        id: uid(),
        image: itemBlob(item),
        rect: item.rect,
        rotation: item.rotation,
        confidence: item.confidence,
        nameHint: item.nameHint,
      }));
      await createNativeItemRecognitionTask(storage, {
        photo: storedPhoto,
        items: nativeItems,
      });
      await reloadAll();
      toast(`已提交 ${nativeItems.length} 件物品后台识别，可继续录入`, 3000);
      onClose();
    } catch (err: any) {
      setError(err?.message || '提交失败');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy || backgroundBusy) return;
    onClose();
  };

  const sheet = (
    <div className="fixed inset-0 z-[9999] h-[100dvh] w-[100dvw] bg-black/20 flex items-end" onClick={close}>
      <div
        className="w-full max-h-[94dvh] rounded-t-[34px] bg-[#fffdf8] shadow-[0_-12px_40px_rgba(30,24,18,0.18)] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 bg-[#fffdf8]">
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#e6dccc]" />
          <div className="flex items-start justify-between gap-4">
            <button onClick={step === 'items' ? () => setStep('boxes') : close} className="h-10 w-10 rounded-full flex items-center justify-center text-ink-600">
              <Glyph name="arrow-left" size={22} />
            </button>
            <div className="flex-1 text-center">
              <div className="font-display text-[22px] text-ink-900">
                {step === 'boxes' ? '调整物品框' : '发现的物品'}
              </div>
              <div className="mt-1 text-[13px] text-ink-400">
                {step === 'boxes' ? '拖动边框调整大小，点击 + 添加新框' : '调整方向或删除误裁物品'}
              </div>
            </div>
            <div className="h-10 min-w-16 rounded-full bg-[#f3f0f4] px-3 flex items-center justify-center gap-1 text-[17px] font-semibold text-ink-800">
              <span className="text-[#f3c85b]">✓</span>
              {step === 'boxes' ? boxes.length : items.length}
            </div>
          </div>
        </div>

        {step === 'boxes' && (
          <>
            <div className="relative bg-[#ece7dc]">
              {loading && (
                <div className="h-[52vh] flex items-center justify-center text-sm text-ink-500">
                  本机正在寻找物品框…
                </div>
              )}
              {!loading && photo && (
                <div
                  ref={stageRef}
                  className="relative mx-auto w-full max-h-[58vh] touch-none overflow-hidden"
                  style={{
                    aspectRatio: `${photo.width} / ${photo.height}`,
                    maxWidth: `${(photo.width / photo.height) * 58}vh`,
                  }}
                >
                  <img src={photo.url} alt="原图" className="absolute inset-0 h-full w-full object-contain select-none" draggable={false} />
                  {boxes.map((box, index) => {
                    const selected = activeBoxId === box.id;
                    const rect = box.rect;
                    return (
                      <div
                        key={box.id}
                        className={`absolute border-[3px] border-dashed ${selected ? 'border-[#f6c95f]' : 'border-[#f6c95f]/80'} bg-[#f6c95f]/5`}
                        style={{
                          left: `${rect.x * 100}%`,
                          top: `${rect.y * 100}%`,
                          width: `${rect.w * 100}%`,
                          height: `${rect.h * 100}%`,
                        }}
                        onPointerDown={(event) => beginDrag(event, box, 'move')}
                      >
                        <button
                          className="absolute left-1/2 top-[-42px] -translate-x-1/2 h-9 w-9 rounded-full bg-red-500 text-white text-2xl leading-none shadow-soft"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setBoxes((current) => current.filter((entry) => entry.id !== box.id));
                          }}
                        >
                          ×
                        </button>
                        <span className="absolute left-2 top-2 rounded-full bg-black/40 px-2 py-0.5 text-[12px] font-semibold text-white">
                          #{index + 1}
                        </span>
                        {(['nw', 'ne', 'sw', 'se'] as ResizeMode[]).map((mode) => (
                          <button
                            key={mode}
                            className={`absolute h-7 w-7 rounded-full bg-white border-2 border-[#f6c95f] shadow-soft ${
                              mode === 'nw'
                                ? '-left-4 -top-4'
                                : mode === 'ne'
                                  ? '-right-4 -top-4'
                                  : mode === 'sw'
                                    ? '-left-4 -bottom-4'
                                    : '-right-4 -bottom-4'
                            }`}
                            onPointerDown={(event) => beginDrag(event, box, mode)}
                            aria-label="调整大小"
                          />
                        ))}
                      </div>
                    );
                  })}
                  <button
                    onClick={addBox}
                    className="absolute right-5 top-5 h-20 w-20 rounded-full bg-[#f5ca60] text-white shadow-soft flex items-center justify-center"
                    aria-label="添加物品框"
                  >
                    <Glyph name="plus" size={42} strokeWidth={1.8} />
                  </button>
                </div>
              )}
            </div>

            <div className="px-6 pb-[calc(env(safe-area-inset-bottom)+22px)] pt-5 bg-[#fffdf8]">
              {error && <div className="mb-3 text-center text-[13px] text-amber-700">{error}</div>}
              <button
                onClick={makeCrops}
                disabled={busy || backgroundBusy || loading || boxes.length === 0}
                className="w-full h-16 rounded-2xl bg-[#f5ca60] text-white text-[20px] font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-3"
              >
                <span className="h-9 w-9 rounded-full bg-white text-[#f0b845] flex items-center justify-center">
                  <Glyph name="arrow-right" size={20} />
                </span>
                {busy ? '裁剪中…' : `下一步（${boxes.length} 个物品）`}
              </button>
              <button onClick={close} disabled={busy || backgroundBusy} className="mt-4 w-full text-center text-[16px] font-semibold text-ink-400">
                取消
              </button>
            </div>
          </>
        )}

        {step === 'items' && (
          <div className="px-5 pb-[calc(env(safe-area-inset-bottom)+22px)] pt-2 bg-[#fffdf8]">
            {error && <div className="mb-3 text-center text-[13px] text-amber-700">{error}</div>}
            <div className="mb-4 flex items-center gap-3">
              <button
                onClick={toggleBackgroundRemoval}
                disabled={busy || backgroundBusy || items.length === 0}
                className={`h-12 rounded-full px-5 inline-flex items-center justify-center gap-2 text-[16px] font-semibold disabled:opacity-50 ${
                  items.some((item) => item.backgroundRemoved)
                    ? 'bg-[#789a8e] text-white'
                    : 'bg-[#f4f0e8] text-ink-700'
                }`}
              >
                <Glyph name="sparkle" size={18} />
                {backgroundBusy
                  ? '处理中'
                  : items.some((item) => item.backgroundRemoved)
                    ? '原图'
                    : '去背景'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 max-h-[52vh] overflow-auto pr-1">
              {items.map((item, index) => (
                <div key={item.id} className="relative rounded-[24px] bg-white p-4 shadow-soft">
                  <div className="aspect-square rounded-[18px] bg-[#fbfaf6] flex items-center justify-center overflow-hidden">
                    <img src={itemUrl(item)} alt={`物品 ${index + 1}`} className="h-full w-full object-contain" />
                  </div>
                  <div className="mt-2 text-center text-[18px] font-display text-[#d7c4ad]">#{index + 1}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => rotateItem(item.id)}
                      disabled={busy || backgroundBusy}
                      className="h-10 rounded-xl bg-[#f4f0e8] text-ink-600 inline-flex items-center justify-center gap-1 text-[13px] font-semibold"
                    >
                      <Glyph name="arrow-right" size={15} />旋转
                    </button>
                    <button
                      onClick={() => deleteItem(item.id)}
                      disabled={busy || backgroundBusy}
                      className="h-10 rounded-xl bg-red-50 text-red-500 inline-flex items-center justify-center gap-1 text-[13px] font-semibold"
                    >
                      <Glyph name="trash" size={15} />删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={confirm}
              disabled={busy || backgroundBusy || items.length === 0}
              className="mt-5 w-full h-16 rounded-2xl bg-[#789a8e] text-white text-[20px] font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-3"
            >
              <span className="text-white">✦</span>
              {busy ? '提交中…' : `让 AI 识别资料（${items.length}）`}
            </button>
            <button onClick={() => setStep('boxes')} disabled={busy || backgroundBusy} className="mt-4 w-full text-center text-[16px] font-semibold text-ink-400">
              返回调整物品框
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
