import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createScanSessionFromDetection,
  detectCabinetsAndItems,
  uid,
  type Cabinet,
  type Photo,
  type Rect,
} from '@home-inventory/core';
import { BlobImage } from '../../components/BlobImage';
import { openModal } from '../../components/Modal';
import { PinIcon } from '../../components/PinIcon';
import { toast } from '../../components/Toast';
import { getStorage, useStore } from '../../stores/useStore';
import CabinetDialog from '../modals/CabinetDialog';

type Mode = 'view' | 'draw' | 'edit';
type HandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

interface Props {
  photo: Photo;
  cabinets: Cabinet[];
}

interface DragState {
  id?: string;
  handle: HandleName;
  start: { x: number; y: number };
  rect: Rect;
}

const HANDLES: HandleName[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function clampRect(rect: Rect): Rect {
  let x = Math.max(0, Math.min(1, rect.x));
  let y = Math.max(0, Math.min(1, rect.y));
  let w = Math.max(0.02, Math.min(1, rect.w));
  let h = Math.max(0.02, Math.min(1, rect.h));
  if (x + w > 1) x = 1 - w;
  if (y + h > 1) y = 1 - h;
  return { x, y, w, h };
}

function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return clampRect({ x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
}

function applyDrag(rect: Rect, handle: HandleName, dx: number, dy: number): Rect {
  if (handle === 'move') return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy });
  let { x, y, w, h } = rect;
  if (handle.includes('w')) {
    x += dx;
    w -= dx;
  }
  if (handle.includes('e')) w += dx;
  if (handle.includes('n')) {
    y += dy;
    h -= dy;
  }
  if (handle.includes('s')) h += dy;
  return clampRect({ x, y, w, h });
}

export default function PhotoEditor({ photo, cabinets }: Props) {
  const navigate = useNavigate();
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const items = useStore((s) => s.items);
  const reloadAll = useStore((s) => s.reloadAll);
  const stageRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [selectedId, setSelectedId] = useState(cabinets[0]?.id || '');
  const [localRects, setLocalRects] = useState<Record<string, Rect>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => cabinets.find((cabinet) => cabinet.id === selectedId), [cabinets, selectedId]);

  const point = (e: React.PointerEvent) => {
    const box = stageRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    };
  };

  const runAI = async () => {
    if (!confirm('重新 AI 识别会生成一个新的审核台，现有柜子和物品会保留，继续？')) return;
    setBusy(true);
    try {
      const storage = getStorage();
      const detected = await detectCabinetsAndItems(photo.blob, { width: photo.width, height: photo.height }, {});
      const session = await createScanSessionFromDetection(storage, photo, detected);
      setLocalRects({});
      await reloadAll();
      toast(`识别完成：${detected.cabinets.length} 个柜子 · ${detected.items.length} 件候选`, 3000);
      navigate(`/scan/${session.id}`);
    } catch (err: any) {
      console.error(err);
      toast('识别失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const startDraw = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'draw') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    setDrag({ handle: 'move', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } });
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const movePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const p = point(e);
    if (mode === 'draw') {
      setDraft(rectFromPoints(drag.start, p));
      return;
    }
    if (mode === 'edit' && drag.id) {
      const next = applyDrag(drag.rect, drag.handle, p.x - drag.start.x, p.y - drag.start.y);
      setLocalRects((cur) => ({ ...cur, [drag.id!]: next }));
    }
  };

  const endPointer = async () => {
    if (!drag) return;
    if (mode === 'draw' && draft && draft.w > 0.03 && draft.h > 0.03) {
      const name = prompt('给这个柜子起个名字', `柜子 ${cabinets.length + 1}`)?.trim();
      if (name) {
        const cabinet: Cabinet = {
          id: uid(),
          photoId: photo.id,
          roomId: photo.roomId,
          name,
          rect: draft,
          type: 'normal',
          createdAt: Date.now(),
        };
        await put('cabinets', cabinet);
        setSelectedId(cabinet.id);
        toast('已添加柜子');
      }
      setDraft(null);
    }
    if (mode === 'edit' && drag.id) {
      const cabinet = cabinets.find((c) => c.id === drag.id);
      const rect = localRects[drag.id];
      if (cabinet && rect) await put('cabinets', { ...cabinet, rect });
    }
    setDrag(null);
  };

  const removePhoto = async () => {
    if (!confirm('删除这张照片及其柜子、来源物品？')) return;
    for (const item of items.filter((it) => it.sourcePhotoId === photo.id || cabinets.some((cab) => cab.id === it.cabinetId))) {
      await del('items', item.id);
    }
    for (const cabinet of cabinets) await del('cabinets', cabinet.id);
    await del('photos', photo.id);
    toast('已删除照片');
    navigate(-1);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={runAI} disabled={busy} className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm disabled:bg-ink-300">
          {busy ? '识别中…' : <span className="inline-flex items-center gap-1"><PinIcon name="ai" size={22} tile={false} />AI 识别</span>}
        </button>
        <button onClick={() => setMode(mode === 'draw' ? 'view' : 'draw')} className={`px-3 py-1.5 rounded-lg text-sm ${mode === 'draw' ? 'bg-emerald-500 text-white' : 'bg-white shadow-soft'}`}>
          ▣ 手动框选
        </button>
        <button onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')} className={`px-3 py-1.5 rounded-lg text-sm ${mode === 'edit' ? 'bg-amber-500 text-white' : 'bg-white shadow-soft'}`}>
          <span className="inline-flex items-center gap-1"><PinIcon name="edit" size={22} tile={false} />编辑边框</span>
        </button>
        <button onClick={removePhoto} className="ml-auto px-3 py-1.5 rounded-lg text-sm bg-red-50 text-red-600">
          <span className="inline-flex items-center gap-1"><PinIcon name="trash" size={22} tile={false} />删除照片</span>
        </button>
      </div>
      <div
        ref={stageRef}
        className={`photo-stage relative bg-black rounded-2xl overflow-hidden mx-auto ${mode !== 'view' ? 'touch-none' : ''}`}
        onPointerDown={startDraw}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <BlobImage blob={photo.blob} className="w-full max-h-[62vh] object-contain" />
        {cabinets.map((cabinet) => {
          const rect = localRects[cabinet.id] || cabinet.rect;
          const active = selectedId === cabinet.id;
          return (
            <div
              key={cabinet.id}
              className={`cabinet-box ${active ? 'is-active' : ''}`}
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setSelectedId(cabinet.id);
                if (mode === 'edit') {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDrag({ id: cabinet.id, handle: 'move', start: point(e), rect });
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (mode === 'view') openModal((close) => <CabinetDialog cabinet={cabinet} onClose={close} />);
              }}
            >
              <span className="label">{cabinet.name}</span>
              {mode === 'edit' && active && HANDLES.map((handle) => (
                <span
                  key={handle}
                  className={`box-handle box-handle-${handle}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDrag({ id: cabinet.id, handle, start: point(e), rect });
                  }}
                />
              ))}
            </div>
          );
        })}
        {draft && (
          <div className="cabinet-box is-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}>
            <span className="label">新柜子</span>
          </div>
        )}
      </div>
      <div className="mt-2 text-xs text-ink-500">
        {mode === 'draw' ? '在照片上拖拽出矩形添加柜子。' : mode === 'edit' ? '点选柜子后拖动边框手柄调整位置。' : '点击柜子打开物品管理。'}
      </div>
    </div>
  );
}
