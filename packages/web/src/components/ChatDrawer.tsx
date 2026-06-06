import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  buildChatSystemPrompt,
  applyInventoryActionPlan,
  applySubscriptionActionPlan,
  describeInventoryAction,
  extractInventoryActionPlan,
  extractNavigateActions,
  extractSubscriptionActionPlan,
  getItemLists,
  previewSubscriptionAction,
  extractRenameSuggestions,
  stripInventoryActionBlock,
  stripNavigateBlock,
  stripSubscriptionActionBlock,
  streamChatWithAI,
  stripRenameBlock,
  type ChatMessage,
  type InventoryActionPlan,
  type ItemList,
  type NavigateAction,
  type RenameSuggestion,
  type SubscriptionActionPlan,
} from '@home-inventory/core';
import { getStorage, useStore } from '../stores/useStore';
import { toast } from './Toast';
import { PinIcon } from './PinIcon';
import { Glyph } from './Glyph';

interface Props {
  open: boolean;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  '待处理里有哪些物品？',
  '审计一下我的订阅：哪些该留，哪些该复核？',
  '本月订阅一共要扣多少？最近哪条要扣？',
  '哪些东西快过期或已过期？',
  '哪些柜子物品偏多，建议怎么分流？',
  '帮我看看哪些柜子名字太笼统，给出更好命名',
];

/** Render `**bold**`, line breaks, and `- ` bullets without bringing in a markdown lib. */
function renderInline(text: string) {
  const parts: (string | JSX.Element)[] = [];
  let i = 0;
  let key = 0;
  const re = /\*\*([^*]+?)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > i) parts.push(text.slice(i, m.index));
    parts.push(
      <strong key={key++} className="font-semibold text-ink-900">
        {m[1]}
      </strong>
    );
    i = m.index + m[0].length;
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

function MessageBody({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, idx) => {
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={idx} className="flex gap-2">
              <span className="text-ink-400 select-none">·</span>
              <span className="flex-1">{renderInline(bullet[1])}</span>
            </div>
          );
        }
        const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <div key={idx} className="flex gap-2">
              <span className="text-ink-400 tabular-nums select-none">
                {numbered[1]}.
              </span>
              <span className="flex-1">{renderInline(numbered[2])}</span>
            </div>
          );
        }
        if (line.trim() === '') return <div key={idx} className="h-2" />;
        return <div key={idx}>{renderInline(line)}</div>;
      })}
    </>
  );
}

function cleanAssistantText(text: string): string {
  return stripNavigateBlock(
    stripSubscriptionActionBlock(stripInventoryActionBlock(stripRenameBlock(text)))
  );
}

export function ChatDrawer({ open, onClose }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const subscriptions = useStore((s) => s.subscriptions);
  const put = useStore((s) => s.put);
  const reloadAll = useStore((s) => s.reloadAll);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [renames, setRenames] = useState<RenameSuggestion[]>([]);
  const [actionPlan, setActionPlan] = useState<InventoryActionPlan | null>(null);
  const [subscriptionPlan, setSubscriptionPlan] = useState<SubscriptionActionPlan | null>(null);
  const [navActions, setNavActions] = useState<NavigateAction[]>([]);
  const [itemLists, setItemLists] = useState<ItemList[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // 抽屉打开时拉取最新清单（清单数据存在 config，不在 zustand store）
  useEffect(() => {
    if (!open) return;
    getItemLists(getStorage()).then(setItemLists).catch(() => {});
  }, [open]);

  // Derive current room id from path (e.g. /room/abc, /photo/xyz handled in caller).
  const currentRoomId = useMemo(() => {
    const m = location.pathname.match(/^\/room\/([^/]+)/);
    return m ? m[1] : undefined;
  }, [location.pathname]);

  const systemPrompt = useMemo(
    () =>
      buildChatSystemPrompt(rooms, cabinets, items, subscriptions, {
        currentPath: location.pathname,
        currentRoomId,
        today: new Date().toISOString().slice(0, 10),
      }, itemLists),
    [rooms, cabinets, items, subscriptions, location.pathname, currentRoomId, itemLists]
  );

  if (!open) return null;

  const sendContent = async (content: string) => {
    if (!content || streaming) return;
    const userMessage: ChatMessage = { role: 'user', content };
    const history = [...messages, userMessage];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setRenames([]);
    setActionPlan(null);
    setSubscriptionPlan(null);
    setNavActions([]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const full = await streamChatWithAI(
        getStorage(),
        [{ role: 'system', content: systemPrompt }, ...history],
        (_delta, current) => {
          setMessages([...history, { role: 'assistant', content: cleanAssistantText(current) }]);
          setRenames(extractRenameSuggestions(current));
          setActionPlan(extractInventoryActionPlan(current));
          setSubscriptionPlan(extractSubscriptionActionPlan(current));
          setNavActions(extractNavigateActions(current));
        },
        controller.signal
      );
      setMessages([...history, { role: 'assistant', content: cleanAssistantText(full) }]);
      setRenames(extractRenameSuggestions(full));
      setActionPlan(extractInventoryActionPlan(full));
      setSubscriptionPlan(extractSubscriptionActionPlan(full));
      setNavActions(extractNavigateActions(full));
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast('AI 对话失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setStreaming(false);
    }
  };

  const send = () => sendContent(input.trim());

  const applyRename = async (suggestion: RenameSuggestion) => {
    const cabinet = cabinets.find((c) => c.id === suggestion.id);
    if (!cabinet) {
      toast('柜子不存在或已删除');
      return;
    }
    await put('cabinets', { ...cabinet, name: suggestion.newName });
    setRenames((cur) => cur.filter((item) => item.id !== suggestion.id));
    toast('已采纳重命名');
  };

  const applyPlan = async () => {
    if (!actionPlan) return;
    try {
      const count = await applyInventoryActionPlan(getStorage(), actionPlan);
      await reloadAll();
      setActionPlan(null);
      toast(count ? `已应用 ${count} 项变更` : '没有可应用的变更');
    } catch (err: any) {
      toast('应用失败：' + (err?.message || 'unknown'), 3000);
    }
  };

  const applySubPlan = async () => {
    if (!subscriptionPlan) return;
    try {
      const count = await applySubscriptionActionPlan(getStorage(), subscriptionPlan);
      await reloadAll();
      setSubscriptionPlan(null);
      toast(count ? `已应用 ${count} 项订阅变更` : '没有可应用的订阅变更');
    } catch (err: any) {
      toast('应用失败：' + (err?.message || 'unknown'), 3000);
    }
  };

  const goNavigate = (action: NavigateAction) => {
    navigate(action.path);
    setNavActions([]);
    abortRef.current?.abort();
    onClose();
  };

  return (
    <div className="chat-backdrop" onClick={onClose}>
      <div className="chat-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200/60">
          <div>
            <h3 className="font-display text-[17px] inline-flex items-center gap-2 text-ink-900">
              <PinIcon name="chat" size={26} />AI 家务管家
            </h3>
            <p className="text-[11.5px] text-ink-500 mt-0.5">
              已知晓房间、柜子、待处理物品、提醒与订阅
            </p>
          </div>
          <button
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="enamel-icon-btn flex items-center justify-center"
            aria-label="关闭"
          >
            <Glyph name="close" size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="text-[13px] text-ink-500 leading-relaxed">
                试试这些问题：
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendContent(q)}
                    className="text-[12.5px] text-ink-700 px-3 py-1.5 rounded-full bg-paper-200 hover:bg-paper-300 border border-ink-200/60 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className={`chat-bubble ${message.role === 'user' ? 'is-user' : 'is-ai'}`}
            >
              {message.content ? (
                <MessageBody text={message.content} />
              ) : (
                streaming && index === messages.length - 1 && (
                  <span className="inline-flex items-center gap-1.5 text-ink-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    思考中…
                  </span>
                )
              )}
            </div>
          ))}
          {renames.length > 0 && (
            <div className="bg-clay-50 border border-clay-100 rounded-xl p-3 space-y-2">
              <div className="text-[12.5px] font-semibold text-clay-700">
                可采纳的重命名建议
              </div>
              {renames.map((suggestion) => (
                <div key={suggestion.id} className="flex items-center gap-2 text-[13px]">
                  <span className="flex-1 truncate">
                    {cabinets.find((c) => c.id === suggestion.id)?.name || suggestion.id}
                    <span className="text-ink-400 mx-1.5">→</span>
                    <span className="font-medium">{suggestion.newName}</span>
                  </span>
                  <button
                    onClick={() => applyRename(suggestion)}
                    className="px-2.5 py-1 rounded-full bg-brand-500 text-white text-[11.5px]"
                  >
                    采纳
                  </button>
                </div>
              ))}
            </div>
          )}
          {actionPlan && (
            <div className="bg-brand-50 border border-brand-100 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[12.5px] font-semibold text-brand-700">
                    可执行方案
                  </div>
                  <div className="text-[11.5px] text-brand-700/80 mt-0.5">
                    {actionPlan.summary}
                  </div>
                </div>
                <button
                  onClick={applyPlan}
                  className="px-2.5 py-1 rounded-full bg-brand-500 text-white text-[11.5px]"
                >
                  应用
                </button>
              </div>
              <div className="space-y-1">
                {actionPlan.actions.map((action, index) => (
                  <div key={index} className="text-[12.5px] text-ink-700 flex gap-2">
                    <span className="text-brand-600">{index + 1}.</span>
                    <span>{describeInventoryAction(action)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {subscriptionPlan && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[12.5px] font-semibold text-emerald-700">
                    可执行订阅方案
                  </div>
                  <div className="text-[11.5px] text-emerald-700/80 mt-0.5">
                    {subscriptionPlan.summary}
                  </div>
                </div>
                <button
                  onClick={applySubPlan}
                  className="px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[11.5px]"
                >
                  应用
                </button>
              </div>
              <div className="space-y-1">
                {subscriptionPlan.actions.map((action, index) => (
                  <div key={index} className="text-[12.5px] text-ink-700 flex gap-2">
                    <span className="text-emerald-700">{index + 1}.</span>
                    <span className="min-w-0">
                      <span>{previewSubscriptionAction(action, subscriptions).title}</span>
                      <span className="block text-[11.5px] text-ink-500 mt-0.5">
                        {previewSubscriptionAction(action, subscriptions).detail}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {navActions.length > 0 && (
            <div className="bg-paper-200 border border-ink-200/60 rounded-xl p-3 space-y-2">
              <div className="text-[12.5px] font-semibold text-ink-700">建议跳转</div>
              <div className="flex flex-wrap gap-2">
                {navActions.map((a) => (
                  <button
                    key={a.path}
                    onClick={() => goNavigate(a)}
                    className="px-3 py-1.5 rounded-full bg-brand-500 text-white text-[12px] inline-flex items-center gap-1.5 hover:bg-brand-600"
                  >
                    <Glyph name="arrow-right" size={12} strokeWidth={2.2} />
                    {a.reason || a.path}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-ink-200/60 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="问问收纳建议、待处理、订阅…"
            className="flex-1 h-10 text-[14px]"
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="px-4 rounded-xl bg-brand-500 text-white text-[13px] font-medium disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
