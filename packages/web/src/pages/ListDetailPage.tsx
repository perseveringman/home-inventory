import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  addItemsToList,
  deleteItemList,
  getItemLists,
  removeItemFromList,
  semanticSearchInventory,
  updateItemList,
  type Item,
  type ItemList,
} from '@home-inventory/core';
import { Header } from '../components/Header';
import { ItemThumb } from '../components/ItemThumb';
import { EmptyState } from '../components/EmptyState';
import { PinIcon } from '../components/PinIcon';
import { Glyph } from '../components/Glyph';
import { openModal } from '../components/Modal';
import { toast } from '../components/Toast';
import { getStorage, useStore } from '../stores/useStore';
import ItemDialog from './modals/ItemDialog';

/* ----------------- 语音识别类型（与 QuickAddDialog 对齐） ----------------- */
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
  results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } };
}
interface SpeechRecognitionErrorLike { error?: string; message?: string }
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

/* ----------------- 语音批量添加确认弹层 ----------------- */
interface VoiceCandidate {
  word: string;
  match: Item | null;
}
function VoiceConfirmDialog({
  transcript,
  candidates,
  existingIds,
  onClose,
  onConfirm,
}: {
  transcript: string;
  candidates: VoiceCandidate[];
  existingIds: Set<string>;
  onClose: () => void;
  onConfirm: (itemIds: string[]) => void;
}) {
  const matched = candidates.filter((c) => c.match && !existingIds.has(c.match!.id));
  const unmatched = candidates.filter((c) => !c.match);
  const alreadyIn = candidates.filter((c) => c.match && existingIds.has(c.match!.id));
  const [picked, setPicked] = useState<Set<string>>(new Set(matched.map((c) => c.match!.id)));

  const togglePick = (id: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    onConfirm(Array.from(picked));
    onClose();
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold inline-flex items-center gap-2">
          <span aria-hidden>🎙</span>语音识别结果
        </h3>
        <button onClick={onClose} className="text-ink-500 text-xl">×</button>
      </div>
      <p className="text-xs text-ink-500 mb-3">识别到：「{transcript}」</p>

      {matched.length > 0 ? (
        <div className="mb-4">
          <div className="text-sm font-medium mb-2">匹配到的物品（默认全选）</div>
          <div className="space-y-1.5">
            {matched.map((c) => (
              <label
                key={c.match!.id}
                className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 cursor-pointer hover:bg-slate-100"
              >
                <input
                  type="checkbox"
                  checked={picked.has(c.match!.id)}
                  onChange={() => togglePick(c.match!.id)}
                />
                <span className="text-sm flex-1 truncate">
                  <span className="text-ink-400 mr-1">「{c.word}」→</span>
                  {c.match!.name}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-sm text-ink-500 mb-4">没有从仓库里匹配到对应的物品。</div>
      )}

      {alreadyIn.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-ink-500 mb-1">已在清单中（跳过）</div>
          <div className="text-xs text-ink-400">
            {alreadyIn.map((c) => `${c.word}→${c.match!.name}`).join('、')}
          </div>
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-ink-500 mb-1">未找到（已忽略）</div>
          <div className="text-xs text-ink-400">{unmatched.map((c) => c.word).join('、')}</div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-ink-700">
          取消
        </button>
        <button
          onClick={submit}
          disabled={picked.size === 0}
          className="flex-1 py-2.5 rounded-lg bg-brand-500 text-white font-medium disabled:opacity-50"
        >
          加入 {picked.size} 件
        </button>
      </div>
    </div>
  );
}

/* ----------------- 主页面 ----------------- */
export default function ListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);
  const rooms = useStore((s) => s.rooms);
  const photos = useStore((s) => s.photos);

  const [list, setList] = useState<ItemList | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported = useMemo(() => !!getSpeechRecognitionCtor(), []);

  const reload = async () => {
    const lists = await getItemLists(getStorage());
    const found = lists.find((l) => l.id === id) || null;
    setList(found);
    setLoaded(true);
  };

  useEffect(() => {
    reload();
  }, [id]);

  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  const listedItems = useMemo(() => {
    if (!list) return [];
    return list.itemIds
      .map((iid) => items.find((it) => it.id === iid))
      .filter((it): it is Item => !!it);
  }, [list, items]);

  const existingIds = useMemo(() => new Set(list?.itemIds || []), [list]);

  const searchResults = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return semanticSearchInventory(q, rooms, cabinets, items, photos, 30);
  }, [query, rooms, cabinets, items, photos]);

  const removeItem = async (itemId: string) => {
    if (!list) return;
    const next = await removeItemFromList(getStorage(), list.id, itemId);
    if (next) setList(next);
  };

  const addOne = async (itemId: string) => {
    if (!list) return;
    const next = await addItemsToList(getStorage(), list.id, [itemId]);
    if (next) {
      setList(next);
      toast('已添加');
    }
  };

  const addMany = async (itemIds: string[]) => {
    if (!list || itemIds.length === 0) return;
    const next = await addItemsToList(getStorage(), list.id, itemIds);
    if (next) {
      setList(next);
      toast(`已添加 ${itemIds.length} 件`);
    }
  };

  const onRename = () => {
    if (!list) return;
    const next = prompt('清单新名称', list.name);
    if (!next || !next.trim() || next.trim() === list.name) return;
    updateItemList(getStorage(), list.id, { name: next.trim() }).then((updated) => {
      if (updated) {
        setList(updated);
        toast('已重命名');
      }
    });
  };

  const onDelete = async () => {
    if (!list) return;
    if (!confirm(`删除清单「${list.name}」？物品本身不会被删除。`)) return;
    await deleteItemList(getStorage(), list.id);
    toast('已删除');
    navigate('/views?tab=lists');
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
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let spoken = '';
      for (let i = 0; i < event.results.length; i += 1) {
        spoken += event.results[i]?.[0]?.transcript || '';
      }
      const trimmed = spoken.trim();
      if (trimmed) handleVoiceTranscript(trimmed);
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
      recognition.start();
    } catch (err: any) {
      setListening(false);
      recognitionRef.current = null;
      toast(err?.message || '语音识别启动失败', 3000);
    }
  };

  const handleVoiceTranscript = (transcript: string) => {
    if (!list) return;
    // 拆词：简单按空白/标点切分；中文连写也尝试整段查找。
    const tokens = Array.from(
      new Set(
        transcript
          .replace(/[，。？！、,.?!;；:："'""''()[\]{}]/g, ' ')
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      )
    );
    // 整段也作为一个 token，便于命中长名字
    if (transcript.trim() && !tokens.includes(transcript.trim())) tokens.unshift(transcript.trim());

    const candidates: VoiceCandidate[] = tokens.map((word) => {
      const results = semanticSearchInventory(word, rooms, cabinets, items, photos, 1);
      const top = results[0];
      // 阈值：score 至少要 ≥3（一次精确命中或两次近义命中）
      const match = top && top.score >= 3 ? top.item : null;
      return { word, match };
    });

    // 去重：同一物品只保留首次
    const seenItem = new Set<string>();
    const dedup: VoiceCandidate[] = [];
    for (const c of candidates) {
      if (c.match) {
        if (seenItem.has(c.match.id)) continue;
        seenItem.add(c.match.id);
      }
      dedup.push(c);
    }

    openModal((close) => (
      <VoiceConfirmDialog
        transcript={transcript}
        candidates={dedup}
        existingIds={existingIds}
        onClose={close}
        onConfirm={(ids) => addMany(ids)}
      />
    ));
  };

  if (!loaded) {
    return (
      <div>
        <Header title="清单" back="/views?tab=lists" />
        <div className="px-4 py-12 text-center text-sm text-ink-400">加载中…</div>
      </div>
    );
  }
  if (!list) {
    return (
      <div>
        <Header title="清单" back="/views?tab=lists" />
        <div className="px-4 md:px-6">
          <EmptyState icon="tag" title="清单不存在或已被删除" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header
        title={`${list.emoji || '🧳'} ${list.name}`}
        subtitle={list.note || `${listedItems.length} 件物品`}
        back="/views?tab=lists"
        actions={
          <div className="flex gap-2">
            <button onClick={onRename} className="px-3 py-1.5 rounded-lg bg-slate-100 text-sm">
              重命名
            </button>
            <button onClick={onDelete} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-sm">
              删除
            </button>
          </div>
        }
      />

      <div className="px-4 md:px-6 space-y-4">
        {/* 搜索 + 语音 */}
        <div className="bg-white rounded-2xl shadow-soft p-3">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索物品名称、标签、品牌…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
                >
                  ×
                </button>
              )}
            </div>
            <button
              onClick={toggleVoice}
              disabled={!speechSupported}
              className={`px-3 rounded-lg text-sm inline-flex items-center gap-1.5 ${
                listening ? 'bg-red-500 text-white' : 'bg-slate-100 text-ink-700'
              } disabled:opacity-50`}
              aria-label="语音添加"
              title={speechSupported ? '语音添加' : '浏览器不支持'}
            >
              <span aria-hidden>🎙</span>
              {listening ? '听…' : '语音'}
            </button>
          </div>

          {query && (
            <div className="mt-3">
              {searchResults.length === 0 ? (
                <div className="text-xs text-ink-400 px-1">没有匹配的物品</div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-auto">
                  {searchResults.map((r) => {
                    const inList = existingIds.has(r.item.id);
                    return (
                      <div
                        key={r.item.id}
                        className={`flex items-center gap-2 p-2 rounded-lg ${
                          inList ? 'bg-slate-50 opacity-60' : 'bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        <ItemThumb item={r.item} className="w-10 h-10 rounded-lg" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{r.item.name}</div>
                          <div className="text-[11px] text-ink-400 truncate">
                            {r.room?.name || '—'} › {r.cabinet?.name || '—'}
                          </div>
                        </div>
                        {inList ? (
                          <span className="text-[11px] text-ink-400">已添加</span>
                        ) : (
                          <button
                            onClick={() => addOne(r.item.id)}
                            className="px-2.5 py-1 rounded-full bg-brand-500 text-white text-[11.5px]"
                          >
                            <Glyph name="plus" size={12} strokeWidth={2.2} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 物品网格 */}
        {listedItems.length === 0 ? (
          <EmptyState
            icon="tag"
            title="清单是空的"
            description="用上面的搜索框或语音按钮，把仓库里的物品加进来"
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {listedItems.map((item) => (
              <div
                key={item.id}
                className="relative bg-white rounded-xl p-2 shadow-soft hover:shadow-md transition group"
              >
                <button
                  onClick={() => removeItem(item.id)}
                  className="absolute -top-1.5 -right-1.5 z-10 w-6 h-6 rounded-full bg-red-500 text-white text-xs shadow flex items-center justify-center hover:bg-red-600"
                  aria-label="移除"
                  title="从清单移除"
                >
                  ×
                </button>
                <button
                  onClick={() => openModal((close) => <ItemDialog item={item} onClose={close} />)}
                  className="w-full text-left"
                >
                  <ItemThumb item={item} className="w-full aspect-square rounded-lg mb-2" />
                  <div className="font-medium text-sm truncate">{item.name}</div>
                  <div className="text-xs text-ink-500">× {item.qty}</div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
