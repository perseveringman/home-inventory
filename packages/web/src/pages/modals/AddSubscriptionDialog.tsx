import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SUB_CATEGORIES,
  SUB_CYCLES,
  advanceSubDue,
  buildVoiceSubscriptionDraft,
  compressImage,
  fetchIconAsDataUrl,
  inferSubCategory,
  recognizeSubscriptionFromImage,
  recognizeSubscriptionFromVoice,
  searchAppStoreApps,
  uid,
  type AppStoreResult,
  type SubCategory,
  type SubCycle,
  type SubscriptionDraftFields,
  type SubscriptionSource,
  type Subscription,
} from '@home-inventory/core';
import { toast } from '../../components/Toast';
import { useStore } from '../../stores/useStore';
import { pickImage } from '../../lib/nativeImage';
import {
  isNativeSpeechPlatform,
  startNativeSpeechRecognition,
  type NativeSpeechSession,
} from '../../lib/nativeSpeech';
import { Glyph } from '../../components/Glyph';
import { SubIcon } from '../../components/SubIcon';

interface Props {
  onClose: () => void;
}

type Tab = 'search' | 'image' | 'voice';

const VOICE_CONTEXTUAL_STRINGS = [
  '订阅',
  '会员',
  '续费',
  '扣款',
  '包月',
  '包年',
  '微信',
  '支付宝',
  'Apple Pay',
  'Netflix',
  'iCloud',
  'ChatGPT',
  'Cursor',
  'Notion',
  '爱奇艺',
  '腾讯视频',
  '优酷',
  'B站',
];

interface DraftState {
  name: string;
  iconUrl?: string;
  appStoreId?: number;
  category: SubCategory;
  amount: string;
  cycle: SubCycle;
  nextDueAt: string;
  autoRenew: boolean;
  planName: string;
  paymentMethod: string;
  source: SubscriptionSource;
  evidenceText?: string;
  confidence?: number;
}

const EMPTY_DRAFT: DraftState = {
  name: '',
  category: 'software',
  amount: '',
  cycle: 'monthly',
  nextDueAt: '',
  autoRenew: true,
  planName: '',
  paymentMethod: '',
  source: 'manual',
};

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function getSpeechCtor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

export default function AddSubscriptionDialog({ onClose }: Props) {
  const put = useStore((s) => s.put);
  const [tab, setTab] = useState<Tab>('search');
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [hasDraft, setHasDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const setField = <K extends keyof DraftState>(key: K, value: DraftState[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /* ---------------- Tab 1: App Store 搜索 ---------------- */
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AppStoreResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    if (tab !== 'search') return;
    const q = query.trim();
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      setSearching(true);
      try {
        const list = await searchAppStoreApps(q, { limit: 14, signal: controller.signal });
        if (!controller.signal.aborted) setResults(list);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (searchAbort.current === controller) setSearching(false);
      }
    }, 320);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query, tab]);

  const pickApp = async (app: AppStoreResult) => {
    setQuery('');
    setResults([]);
    // 远程图标内联成 dataURL，做到离线可用；失败就保留远程 url
    let iconUrl: string | undefined = app.iconUrl;
    const inline = await fetchIconAsDataUrl(app.iconUrl).catch(() => null);
    if (inline) iconUrl = inline;
    setDraft({
      ...EMPTY_DRAFT,
      name: app.name,
      iconUrl,
      appStoreId: app.trackId,
      category: inferSubCategory(`${app.name} ${app.genre || ''}`),
      source: 'manual',
      evidenceText: app.seller ? `App Store · ${app.seller}` : undefined,
    });
    setHasDraft(true);
  };

  /* ---------------- Tab 2: 图片识别 ---------------- */
  const recognizeImage = async (file: File) => {
    setBusy(true);
    try {
      const { blob } = await compressImage(file, 1280, 0.8);
      const fields = await recognizeSubscriptionFromImage(blob);
      if (!fields?.name) {
        toast('没从图片里识别到订阅信息，可手动填写', 3000);
        setTab('search');
        return;
      }
      await applyRecognized(fields);
      toast('已识别，请确认信息');
    } catch (err: any) {
      toast('图片识别失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const startImagePick = async (source: 'camera' | 'gallery') => {
    if (busy) return;
    const file = await pickImage({ source });
    if (file) await recognizeImage(file);
  };

  /* ---------------- Tab 3: 语音 ---------------- */
  const [listening, setListening] = useState(false);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceText, setVoiceText] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | NativeSpeechSession | null>(null);
  const nativeSpeechPlatform = useMemo(() => isNativeSpeechPlatform(), []);
  const webSpeechSupported = useMemo(() => !!getSpeechCtor(), []);
  const speechSupported = nativeSpeechPlatform || webSpeechSupported;

  useEffect(() => () => {
    void recognitionRef.current?.abort();
  }, []);

  const handleVoiceText = async (spoken: string) => {
    setTranscript(spoken);
    setVoiceText(spoken);
    const local = buildVoiceSubscriptionDraft(spoken);
    if (local?.name) {
      await applyRecognized(local);
    }
    // 本地没抽全（缺金额或日期）时，再交给 LLM 补全
    if (!local || !local.amount || !local.nextDueAt) {
      setBusy(true);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const enriched = await recognizeSubscriptionFromVoice(spoken, today);
        if (enriched?.name) {
          await applyRecognized(enriched);
          toast('已识别，请确认信息');
        } else if (local?.name) {
          toast('已按口述初步填写，请补全');
        } else {
          toast('没听清订阅信息，请再说一次或手动填写', 3000);
        }
      } catch {
        if (local?.name) toast('已按口述初步填写，请补全');
        else toast('语音识别失败，请手动填写', 3000);
      } finally {
        setBusy(false);
      }
    } else {
      toast('已识别，请确认信息');
    }
  };

  const startNativeVoice = async () => {
    setVoiceStarting(true);
    setTranscript('');
    try {
      const session = await startNativeSpeechRecognition({
        language: 'zh-CN',
        contextualStrings: VOICE_CONTEXTUAL_STRINGS,
        onTranscript: setTranscript,
        onError: (message) => toast(message, 3000),
        onEnd: (spoken) => {
          setListening(false);
          setVoiceStarting(false);
          recognitionRef.current = null;
          if (spoken) void handleVoiceText(spoken);
        },
      });
      recognitionRef.current = session;
      setListening(true);
      return true;
    } catch (err: any) {
      toast(err?.message || '语音启动失败', 3000);
      return true;
    } finally {
      setVoiceStarting(false);
    }
  };

  const submitVoiceText = () => {
    const spoken = voiceText.trim();
    if (!spoken) {
      toast('请先输入订阅描述');
      return;
    }
    void handleVoiceText(spoken);
  };

  const toggleVoice = async () => {
    if (listening) {
      void recognitionRef.current?.stop();
      return;
    }
    if (voiceStarting) return;
    if (nativeSpeechPlatform) {
      const started = await startNativeVoice();
      if (started) return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      toast('当前环境不支持实时语音转写，请用图片或手动添加', 3000);
      return;
    }
    const rec = new Ctor();
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (event: any) => {
      let spoken = '';
      for (let i = 0; i < event.results.length; i += 1) spoken += event.results[i]?.[0]?.transcript || '';
      finalText = spoken.trim();
      setTranscript(finalText);
    };
    rec.onerror = (event: any) => {
      const msg = event.error === 'not-allowed' ? '请允许麦克风权限' : event.message || event.error || '语音识别失败';
      toast(msg, 3000);
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (finalText) void handleVoiceText(finalText);
    };
    try {
      recognitionRef.current = rec;
      setListening(true);
      setTranscript('');
      rec.start();
    } catch (err: any) {
      setListening(false);
      recognitionRef.current = null;
      toast(err?.message || '语音启动失败', 3000);
    }
  };

  /* ---------------- 共用：把识别结果灌进草稿 ---------------- */
  const applyRecognized = async (fields: SubscriptionDraftFields) => {
    let iconUrl: string | undefined;
    let appStoreId: number | undefined;
    // 识别到名字后顺手去 App Store 拿真实图标
    try {
      const apps = await searchAppStoreApps(fields.name || '', { limit: 1 });
      if (apps[0]) {
        appStoreId = apps[0].trackId;
        const inline = await fetchIconAsDataUrl(apps[0].iconUrl).catch(() => null);
        iconUrl = inline || apps[0].iconUrl;
      }
    } catch {
      // 拿不到图标不影响识别结果
    }
    setDraft({
      name: fields.name || '',
      iconUrl,
      appStoreId,
      category: fields.category || inferSubCategory(fields.name || ''),
      amount: fields.amount ? String(fields.amount) : '',
      cycle: fields.cycle || 'monthly',
      nextDueAt: fields.nextDueAt || '',
      autoRenew: fields.autoRenew ?? true,
      planName: fields.planName || '',
      paymentMethod: fields.paymentMethod || '',
      source: fields.source || 'manual',
      evidenceText: fields.evidenceText,
      confidence: fields.confidence,
    });
    setHasDraft(true);
  };

  /* ---------------- 保存 ---------------- */
  const buildSub = (): Subscription | null => {
    const name = draft.name.trim();
    if (!name) {
      toast('请填写订阅名称');
      return null;
    }
    const amount = +draft.amount || 0;
    const today = new Date().toISOString().slice(0, 10);
    return {
      id: uid(),
      name,
      iconUrl: draft.iconUrl,
      appStoreId: draft.appStoreId,
      category: draft.category,
      amount,
      cycle: draft.cycle,
      nextDueAt: draft.nextDueAt || undefined,
      planName: draft.planName.trim() || undefined,
      paymentMethod: draft.paymentMethod.trim() || undefined,
      autoRenew: draft.autoRenew,
      source: draft.source,
      confidence: draft.confidence,
      evidenceText: draft.evidenceText,
      priceHistory: amount ? [{ amount, date: draft.nextDueAt || today, note: '初始记录' }] : undefined,
      status: 'active',
      createdAt: Date.now(),
    };
  };

  const save = async () => {
    const sub = buildSub();
    if (!sub) return;
    setBusy(true);
    try {
      await put('subscriptions', advanceSubDue(sub));
      toast('已添加订阅');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setHasDraft(false);
    setTranscript('');
    setVoiceText('');
  };

  /* ---------------- UI ---------------- */
  const TABS: Array<{ id: Tab; label: string; glyph: 'search' | 'image' | 'sparkle' }> = [
    { id: 'search', label: '搜索', glyph: 'search' },
    { id: 'image', label: '截图', glyph: 'image' },
    { id: 'voice', label: '语音', glyph: 'sparkle' },
  ];

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">新增订阅</h3>
        <button onClick={onClose} className="text-ink-500 text-xl">×</button>
      </div>

      {/* Tab 切换 */}
      <div className="grid grid-cols-3 gap-1.5 bg-paper-100 rounded-xl p-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-2 rounded-lg text-[12.5px] font-medium inline-flex items-center justify-center gap-1 ${
              tab === t.id ? 'bg-white shadow-soft text-brand-600' : 'text-ink-500'
            }`}
          >
            <Glyph name={t.glyph} size={15} strokeWidth={1.7} />
            {t.label}
          </button>
        ))}
      </div>

      {/* === 搜索 tab === */}
      {tab === 'search' && !hasDraft && (
        <div className="space-y-3">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索应用名，如 Netflix、爱奇艺、iCloud"
              className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-[14px]"
              autoFocus
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
              <Glyph name="search" size={16} />
            </span>
          </div>

          {searching && <div className="text-[12px] text-ink-400 px-1">搜索中…</div>}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <div className="text-[12px] text-ink-400 px-1">没找到应用，可直接手动填写 ↓</div>
          )}

          <ul className="space-y-1 max-h-[280px] overflow-y-auto">
            {results.map((app) => (
              <li key={app.trackId}>
                <button
                  onClick={() => pickApp(app)}
                  className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-paper-100 text-left"
                >
                  <SubIcon iconUrl={app.iconUrl} name={app.name} size={40} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] text-ink-900 truncate">{app.name}</span>
                    <span className="block text-[11.5px] text-ink-400 truncate">
                      {[app.genre, app.seller].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Glyph name="arrow-right" size={16} className="text-ink-300" />
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setHasDraft(true);
            }}
            className="w-full py-2.5 rounded-lg border border-dashed border-slate-300 text-[13px] text-ink-500 hover:border-brand-400 hover:text-brand-600"
          >
            找不到？手动填写订阅信息
          </button>
        </div>
      )}

      {/* === 图片 tab === */}
      {tab === 'image' && !hasDraft && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-500 leading-relaxed">拍扣款短信、邮件、账单或 App 订阅页。</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => startImagePick('camera')}
              disabled={busy}
              className="flex flex-col items-center gap-2 py-6 rounded-2xl border border-slate-200 hover:border-brand-400 disabled:opacity-50"
            >
              <Glyph name="camera" size={26} className="text-brand-500" />
              <span className="text-[13px] text-ink-700">拍照</span>
            </button>
            <button
              onClick={() => startImagePick('gallery')}
              disabled={busy}
              className="flex flex-col items-center gap-2 py-6 rounded-2xl border border-slate-200 hover:border-brand-400 disabled:opacity-50"
            >
              <Glyph name="image" size={26} className="text-brand-500" />
              <span className="text-[13px] text-ink-700">从相册选</span>
            </button>
          </div>
          {busy && <div className="text-center text-[12.5px] text-brand-600">AI 识别中…</div>}
        </div>
      )}

      {/* === 语音 tab === */}
      {tab === 'voice' && !hasDraft && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-500 leading-relaxed">说出名称、金额、周期和下次扣款日即可。</p>
          <button
            onClick={toggleVoice}
            disabled={busy || voiceStarting}
            className={`w-full py-8 rounded-2xl flex flex-col items-center gap-2 transition-colors disabled:opacity-50 ${
              listening ? 'bg-clay-500 text-white' : 'bg-brand-50 text-brand-700 border border-brand-100'
            }`}
          >
            <span className="text-3xl">{listening ? '⏹' : '🎙'}</span>
            <span className="text-[13px] font-medium">
              {voiceStarting ? '启动中…' : listening ? '正在听，点此停止' : '开始语音描述'}
            </span>
          </button>
          {transcript && (
            <div className="bg-paper-100 rounded-xl px-3 py-2.5 text-[13px] text-ink-700">识别：{transcript}</div>
          )}
          <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
            <textarea
              value={voiceText}
              onChange={(e) => setVoiceText(e.target.value)}
              rows={3}
              placeholder="Netflix 每月 68 元，下个月 8 号扣，支付宝付款"
              className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-ink-800 outline-none placeholder:text-ink-300"
            />
            <button
              type="button"
              onClick={submitVoiceText}
              disabled={busy || !voiceText.trim()}
              className="w-full py-2 rounded-lg bg-paper-100 text-[13px] font-medium text-ink-700 disabled:opacity-50"
            >
              解析描述
            </button>
          </div>
          {busy && <div className="text-center text-[12.5px] text-brand-600">AI 解析中…</div>}
          {!speechSupported && (
            <div className="text-[12px] text-amber-600 px-1">当前环境不支持实时语音转写，建议改用图片或手动添加。</div>
          )}
        </div>
      )}

      {/* === 确认 / 编辑草稿（三入口共用） === */}
      {hasDraft && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-paper-100 rounded-2xl p-3">
            <SubIcon iconUrl={draft.iconUrl} name={draft.name} size={52} />
            <div className="flex-1 min-w-0">
              <input
                value={draft.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="订阅名称"
                className="w-full bg-transparent text-[15px] font-display text-ink-900 outline-none border-b border-transparent focus:border-brand-300 pb-0.5"
              />
              {draft.evidenceText && (
                <div className="text-[11px] text-ink-400 mt-1 truncate">{draft.evidenceText}</div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-ink-500 mb-1.5">类型</label>
            <div className="grid grid-cols-4 gap-1.5">
              {SUB_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setField('category', c.id)}
                  className={`py-1.5 rounded-lg border text-[11.5px] ${
                    draft.category === c.id ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-slate-200 text-ink-600'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-medium text-ink-500">
              金额 ¥
              <input
                type="number"
                step="0.01"
                value={draft.amount}
                onChange={(e) => setField('amount', e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-ink-900"
              />
            </label>
            <label className="block text-[12px] font-medium text-ink-500">
              周期
              <select
                value={draft.cycle}
                onChange={(e) => setField('cycle', e.target.value as SubCycle)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white text-ink-900"
              >
                {SUB_CYCLES.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-[12px] font-medium text-ink-500">
            下次扣款日
            <input
              type="date"
              value={draft.nextDueAt}
              onChange={(e) => setField('nextDueAt', e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-ink-900"
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-paper-100 px-3 py-2.5">
            <span className="text-[13px] font-medium text-ink-700">自动续期</span>
            <input
              type="checkbox"
              checked={draft.autoRenew}
              onChange={(e) => setField('autoRenew', e.target.checked)}
              className="h-4 w-4 accent-brand-500"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <input
              value={draft.planName}
              onChange={(e) => setField('planName', e.target.value)}
              placeholder="套餐名（可选）"
              className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]"
            />
            <input
              value={draft.paymentMethod}
              onChange={(e) => setField('paymentMethod', e.target.value)}
              placeholder="支付方式（可选）"
              className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={resetDraft} className="px-4 py-2.5 rounded-lg border border-slate-200 text-ink-700 text-[13px]">
              重选
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium text-[14px] disabled:opacity-50"
            >
              {busy ? '保存中…' : '保存订阅'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
