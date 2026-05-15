import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  createLabel,
  labelToQrText,
  linkLabel,
  resolveLabel,
  type Label,
  type LabelTargetType,
} from '@home-inventory/core';
import { Header } from '../components/Header';
import { openModal } from '../components/Modal';
import { PinIcon } from '../components/PinIcon';
import { toast } from '../components/Toast';
import { getStorage, useStore } from '../stores/useStore';
import ItemDialog from './modals/ItemDialog';

function QrImage({ label }: { label: Label }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(labelToQrText(label), {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
      color: { dark: '#2b1b15', light: '#fffaf1' },
    }).then(setSrc);
  }, [label]);
  return src ? <img src={src} alt="" className="w-full aspect-square object-contain" /> : null;
}

export default function LabelsPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const labels = useStore((s) => s.labels);
  const photos = useStore((s) => s.photos);
  const reloadAll = useStore((s) => s.reloadAll);
  const [targetType, setTargetType] = useState<LabelTargetType>('cabinet');
  const [targetId, setTargetId] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [scannedLabel, setScannedLabel] = useState<Label | null>(null);

  const targetOptions = useMemo(() => {
    if (targetType === 'room') return rooms.map((room) => ({ id: room.id, name: room.name }));
    if (targetType === 'item') return items.map((item) => ({ id: item.id, name: item.name }));
    return cabinets
      .filter((cabinet) => !cabinet.type || cabinet.type === 'normal')
      .map((cabinet) => {
        const room = rooms.find((r) => r.id === cabinet.roomId);
        return { id: cabinet.id, name: `${room?.name || '未知'} · ${cabinet.name}` };
      });
  }, [targetType, rooms, cabinets, items]);

  useEffect(() => {
    setTargetId(targetOptions[0]?.id || '');
  }, [targetOptions]);

  const targetName = (label: Label) => {
    if (!label.targetId) return '未绑定';
    if (label.targetType === 'room') return rooms.find((room) => room.id === label.targetId)?.name || label.targetId;
    if (label.targetType === 'item') return items.find((item) => item.id === label.targetId)?.name || label.targetId;
    const cabinet = cabinets.find((item) => item.id === label.targetId);
    const room = rooms.find((item) => item.id === cabinet?.roomId);
    return cabinet ? `${room?.name || '未知'} · ${cabinet.name}` : label.targetId;
  };

  const makeOne = async (linked: boolean) => {
    await createLabel(getStorage(), linked && targetId ? { targetType, targetId } : {});
    await reloadAll();
    toast(linked ? '已创建并绑定标签' : '已创建空标签');
  };

  const makeBatch = async () => {
    for (let i = 0; i < 12; i += 1) await createLabel(getStorage());
    await reloadAll();
    toast('已生成 12 张空标签');
  };

  const openTarget = (label: Label) => {
    if (!label.targetId || label.status !== 'linked') {
      setScannedLabel(label);
      toast('这是未绑定标签，可以选择对象后绑定');
      return;
    }
    if (label.targetType === 'room') navigate(`/room/${label.targetId}`);
    else if (label.targetType === 'cabinet') {
      const cabinet = cabinets.find((item) => item.id === label.targetId);
      if (cabinet?.photoId) navigate(`/photo/${cabinet.photoId}`);
      else navigate('/items');
    } else if (label.targetType === 'item') {
      const item = items.find((x) => x.id === label.targetId);
      if (item) openModal((close) => <ItemDialog item={item} onClose={close} />);
    }
  };

  const resolveManual = async (code = manualCode) => {
    const label = await resolveLabel(getStorage(), code);
    if (!label) {
      toast('没有找到这个标签');
      return;
    }
    setScannedLabel(label);
    openTarget(label);
  };

  const bindScanned = async () => {
    if (!scannedLabel || !targetId) return;
    await linkLabel(getStorage(), scannedLabel.id, targetType, targetId);
    await reloadAll();
    setScannedLabel(null);
    toast('标签已绑定');
  };

  const scanImage = async (file?: File | null) => {
    if (!file) return;
    const BarcodeDetector = (window as any).BarcodeDetector;
    if (!BarcodeDetector) {
      toast('当前浏览器不支持离线二维码识别，可手动输入标签码');
      return;
    }
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      const raw = codes[0]?.rawValue;
      if (!raw) {
        toast('没有识别到二维码');
        return;
      }
      setManualCode(raw);
      await resolveManual(raw);
    } catch (err: any) {
      toast(err?.message || '二维码识别失败', 3000);
    }
  };

  const linkedLabels = labels.filter((label) => label.status === 'linked');
  const blanks = labels.filter((label) => label.status === 'unclaimed');

  return (
    <div>
      <Header
        title="二维码标签"
        subtitle={`${linkedLabels.length} 已绑定 · ${blanks.length} 空标签`}
        actions={
          <button onClick={() => window.print()} className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm">
            打印
          </button>
        }
      />

      <div className="px-4 md:px-6 py-4 space-y-5">
        <section className="bg-white rounded-2xl shadow-soft p-4">
          <h2 className="font-semibold inline-flex items-center gap-2 mb-3">
            <PinIcon name="tag" size={30} />生成标签
          </h2>
          <div className="grid md:grid-cols-[160px_1fr_auto_auto] gap-2">
            <select value={targetType} onChange={(e) => setTargetType(e.target.value as LabelTargetType)} className="border border-slate-200 rounded-lg px-3 py-2 bg-white">
              <option value="cabinet">柜子</option>
              <option value="room">房间</option>
              <option value="item">物品</option>
            </select>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 bg-white">
              {targetOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
            <button onClick={() => makeOne(true)} disabled={!targetId} className="px-4 py-2 rounded-lg bg-brand-500 text-white disabled:bg-ink-300">
              创建并绑定
            </button>
            <button onClick={makeBatch} className="px-4 py-2 rounded-lg bg-slate-100">
              生成空标签
            </button>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-4">
          <h2 className="font-semibold inline-flex items-center gap-2 mb-3">
            <PinIcon name="search" size={28} />扫描 / 绑定
          </h2>
          <div className="grid md:grid-cols-[1fr_auto_auto] gap-2">
            <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="扫码内容或标签码" className="border border-slate-200 rounded-lg px-3 py-2" />
            <button onClick={() => resolveManual()} className="px-4 py-2 rounded-lg bg-slate-100">解析</button>
            <button onClick={() => fileRef.current?.click()} className="px-4 py-2 rounded-lg bg-slate-100">识别图片</button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              scanImage(file);
            }}
          />
          {scannedLabel && scannedLabel.status === 'unclaimed' && (
            <div className="mt-3 rounded-xl bg-brand-50 border border-brand-100 p-3 flex items-center justify-between gap-3">
              <div className="text-sm text-brand-700">
                标签 {scannedLabel.code} 未绑定，可绑定到当前选择的对象。
              </div>
              <button onClick={bindScanned} className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm">
                绑定
              </button>
            </div>
          )}
        </section>

        <section>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 print:grid-cols-3">
            {labels.map((label) => (
              <button
                key={label.id}
                onClick={() => openTarget(label)}
                className="bg-white rounded-2xl shadow-soft p-3 text-left print:shadow-none print:border print:border-slate-200"
              >
                <QrImage label={label} />
                <div className="text-center mt-2">
                  <div className="font-semibold text-sm truncate">{targetName(label)}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">{label.labelNo || label.code}</div>
                  <div className="text-[10px] text-ink-400 mt-0.5">
                    {label.status === 'linked' ? '已绑定' : '空标签'}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!labels.length && (
            <div className="text-center py-16 text-ink-500 text-sm">
              还没有标签。先生成一批空标签，贴到箱子上后再扫码绑定。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
