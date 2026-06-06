import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GLOBAL_ROOM_ID,
  addQuickItems,
  ensureGlobalLooseCabinet,
  ensureLooseCabinet,
  formatQuickAddLines,
  parseQuickAddDraft,
  resolveTargetCabinet,
} from '@home-inventory/core';
import { getStorage, useStore } from '../../stores/useStore';
import { toast } from '../../components/Toast';
import { PinIcon } from '../../components/PinIcon';

interface Props {
  defaultRoomId?: string;
  onClose: () => void;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
}

interface SpeechRecognitionErrorLike {
  error?: string;
  message?: string;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
}

export default function QuickAddDialog({ defaultRoomId = GLOBAL_ROOM_ID, onClose }: Props) {
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const reloadAll = useStore((s) => s.reloadAll);
  const [text, setText] = useState('');
  const [roomId, setRoomId] = useState(defaultRoomId);
  const [cabinetChoice, setCabinetChoice] = useState('__global_loose__');
  const [expiry, setExpiry] = useState('');
  const [toInbox, setToInbox] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported = useMemo(() => !!getSpeechRecognitionCtor(), []);

  const roomCabinets = useMemo(
    () => cabinets.filter((cabinet) => cabinet.roomId === roomId && (!cabinet.type || cabinet.type === 'normal')),
    [cabinets, roomId]
  );
  const parsedPreview = useMemo(() => parseQuickAddDraft(text, { rooms }), [rooms, text]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const setInboxMode = (next: boolean, nextRoomId = roomId) => {
    setToInbox(next);
    if (next) setCabinetChoice(nextRoomId === GLOBAL_ROOM_ID ? '__global_loose__' : '__room_loose__');
  };

  const applyRecognizedText = (spoken: string) => {
    const parsed = parseQuickAddDraft(spoken, { rooms });
    setVoiceTranscript(spoken);
    if (!parsed.lines.length) {
      setText(spoken);
      return;
    }
    const nextRoomId = parsed.roomId || roomId || GLOBAL_ROOM_ID;
    setText(formatQuickAddLines(parsed.lines));
    setRoomId(nextRoomId);
    setInboxMode(true, nextRoomId);
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      toast('当前浏览器不支持语音输入');
      return;
    }
    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let spoken = '';
      for (let i = 0; i < event.results.length; i += 1) {
        spoken += event.results[i]?.[0]?.transcript || '';
      }
      if (spoken.trim()) applyRecognizedText(spoken.trim());
    };
    recognition.onerror = (event) => {
      const message = event.error === 'not-allowed' ? '请允许麦克风权限' : event.message || event.error || '语音识别失败';
      toast(message, 3000);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    try {
      recognitionRef.current = recognition;
      setListening(true);
      setVoiceTranscript('');
      recognition.start();
    } catch (err: any) {
      setListening(false);
      recognitionRef.current = null;
      toast(err?.message || '语音输入启动失败', 3000);
    }
  };

  const save = async () => {
    const parsed = parseQuickAddDraft(text, { rooms });
    const lines = parsed.lines;
    if (!lines.length) {
      toast('请先输入物品');
      return;
    }
    setBusy(true);
    try {
      const storage = getStorage();
      const targetRoomId = parsed.roomId || roomId || GLOBAL_ROOM_ID;
      const target = toInbox
        ? targetRoomId === GLOBAL_ROOM_ID
          ? await ensureGlobalLooseCabinet(storage)
          : await ensureLooseCabinet(storage, targetRoomId)
        : await resolveTargetCabinet(storage, cabinetChoice, targetRoomId);
      if (!target) {
        toast('请选择目的地');
        return;
      }
      const added = await addQuickItems(storage, lines, target, expiry, { status: toInbox ? 'pending' : 'placed' });
      await reloadAll();
      toast(toInbox ? `已放入收集箱 ${added.length} 件，待完善` : `已添加 ${added.length} 件物品`);
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
          <p className="text-xs text-ink-500 mt-1">每行一件，也可以直接说「书房里有一对真力 G1 音箱，四个充电宝」。</p>
        </div>
        <button onClick={onClose} className="text-ink-500 text-xl">×</button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
        <button
          type="button"
          onClick={toggleVoice}
          disabled={busy}
          className={`px-3 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 ${
            listening ? 'bg-red-500 text-white' : 'bg-white text-ink-700'
          } disabled:opacity-60`}
        >
          <span aria-hidden="true">🎙</span>{listening ? '停止识别' : '语音输入'}
        </button>
        <div className="flex-1 min-w-0 text-xs text-ink-500">
          {!speechSupported
            ? '当前浏览器不支持语音识别，可以继续手动输入。'
            : listening
              ? '正在听，识别结果会自动转成待完善清单。'
              : voiceTranscript
                ? `识别：${voiceTranscript}`
                : '识别后会默认放入收集箱待完善。'}
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        placeholder={'牙膏×2\n洗发水\n螺丝刀, 工具盒里\n感冒药×3'}
        className="w-full p-3 rounded-xl bg-slate-50 border border-transparent focus:bg-white focus:border-brand-500 outline-none text-sm font-mono"
      />
      {parsedPreview.lines.length > 0 && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-ink-500">
          已识别 {parsedPreview.lines.length} 类物品
          {parsedPreview.inferredRoomName ? ` · ${parsedPreview.inferredRoomName}` : ''}
          {toInbox ? ' · 将进入收集箱' : ''}
        </div>
      )}
      <div className="bg-brand-50 rounded-xl p-3 space-y-2">
        <label className="flex items-start gap-2 rounded-lg bg-white/80 border border-brand-100 p-2 text-sm">
          <input
            type="checkbox"
            checked={toInbox}
            onChange={(e) => setInboxMode(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-ink-800">放入收集箱待完善</span>
            <span className="block text-xs text-ink-500 mt-0.5">适合语音粗录，之后在「待处理」里补照片、备注和归位。</span>
          </span>
        </label>
        <div className="text-xs font-semibold text-brand-700">{toInbox ? '先归到哪个房间' : '放到哪里'}</div>
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
            disabled={toInbox}
            className="h-10 px-3 rounded-lg bg-white border border-slate-200 text-sm disabled:bg-slate-100 disabled:text-ink-400"
          >
            {toInbox ? (
              <option value={roomId === GLOBAL_ROOM_ID ? '__global_loose__' : '__room_loose__'}>
                {roomId === GLOBAL_ROOM_ID ? '全屋收集箱' : '此房间收集箱'}
              </option>
            ) : roomId === GLOBAL_ROOM_ID ? (
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
          {busy ? '添加中…' : toInbox ? '放入收集箱' : '添加'}
        </button>
      </div>
    </div>
  );
}
