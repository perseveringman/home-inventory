import { useMemo, useRef, useState } from 'react';
import {
  buildChatSystemPrompt,
  extractRenameSuggestions,
  streamChatWithAI,
  stripRenameBlock,
  type ChatMessage,
  type RenameSuggestion,
} from '@home-inventory/core';
import { getStorage, useStore } from '../stores/useStore';
import { toast } from './Toast';
import { PinIcon } from './PinIcon';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ChatDrawer({ open, onClose }: Props) {
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const put = useStore((s) => s.put);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [renames, setRenames] = useState<RenameSuggestion[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const systemPrompt = useMemo(() => buildChatSystemPrompt(rooms, cabinets, items), [rooms, cabinets, items]);

  if (!open) return null;

  const send = async () => {
    const content = input.trim();
    if (!content || streaming) return;
    const userMessage: ChatMessage = { role: 'user', content };
    const history = [...messages, userMessage];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setRenames([]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const full = await streamChatWithAI(
        getStorage(),
        [{ role: 'system', content: systemPrompt }, ...history],
        (_delta, current) => {
          setMessages([...history, { role: 'assistant', content: stripRenameBlock(current) }]);
          setRenames(extractRenameSuggestions(current));
        },
        controller.signal
      );
      setMessages([...history, { role: 'assistant', content: stripRenameBlock(full) }]);
      setRenames(extractRenameSuggestions(full));
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast('AI 对话失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setStreaming(false);
    }
  };

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

  return (
    <div className="chat-backdrop" onClick={onClose}>
      <div className="chat-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div>
            <h3 className="font-semibold inline-flex items-center gap-2"><PinIcon name="chat" size={30} />AI 收纳助手</h3>
            <p className="text-xs text-ink-500">可问整理建议，也可让它推荐柜子命名</p>
          </div>
          <button
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="text-xl text-ink-500"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-sm text-ink-500 bg-slate-50 rounded-xl p-3">
              试试："帮我看看哪些柜子名字太笼统，给出更好命名。"
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`chat-bubble ${message.role === 'user' ? 'is-user' : 'is-ai'}`}>
              {message.content || (streaming && index === messages.length - 1 ? '思考中…' : '')}
            </div>
          ))}
          {renames.length > 0 && (
            <div className="bg-brand-50 rounded-xl p-3 space-y-2">
              <div className="text-sm font-semibold text-brand-700">可采纳的重命名建议</div>
              {renames.map((suggestion) => (
                <div key={suggestion.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{cabinets.find((c) => c.id === suggestion.id)?.name || suggestion.id} → {suggestion.newName}</span>
                  <button onClick={() => applyRename(suggestion)} className="px-2 py-1 rounded bg-brand-500 text-white text-xs">采纳</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-3 border-t border-slate-100 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="问问收纳建议…"
            className="flex-1 h-10 px-3 rounded-xl border border-slate-200 text-sm"
          />
          <button onClick={send} disabled={streaming} className="px-4 rounded-xl bg-brand-500 text-white text-sm disabled:bg-ink-300">
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
