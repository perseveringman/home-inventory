import { useMemo } from 'react';
import { useStore } from '../stores/useStore';
import { Header } from '../components/Header';
import { EmptyState } from '../components/EmptyState';
import { BlobImage } from '../components/BlobImage';
import { openModal } from '../components/Modal';
import ItemDialog from './modals/ItemDialog';
import {
  computeItemEvents,
  computeSubscriptionEvents,
  REMINDER_KIND_LABEL,
  type ReminderEvent,
} from '@home-inventory/core';

const LEVEL_STYLE: Record<string, string> = {
  critical: 'bg-red-50 border-red-200 text-red-700',
  warn: 'bg-amber-50 border-amber-200 text-amber-700',
  info: 'bg-slate-50 border-slate-200 text-slate-700',
};

export default function InboxPage() {
  const items = useStore((s) => s.items);
  const subscriptions = useStore((s) => s.subscriptions);

  const pendingItems = useMemo(
    () => items.filter((i) => i.status === 'pending'),
    [items]
  );
  const itemEvents = useMemo(() => computeItemEvents(items), [items]);
  const subEvents = useMemo(() => computeSubscriptionEvents(subscriptions), [subscriptions]);

  const totalCount = pendingItems.length + itemEvents.length + subEvents.length;

  const getItem = (id?: string) => items.find((x) => x.id === id);

  const renderEventRow = (e: ReminderEvent) => {
    const it = getItem(e.itemId);
    return (
      <li
        key={`${e.kind}-${e.itemId || e.subId}-${e.title}`}
        onClick={() => it && openModal((close) => <ItemDialog item={it} onClose={close} />)}
        className={`border rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:shadow-soft transition ${
          LEVEL_STYLE[e.level]
        }`}
      >
        <div className="text-2xl">{e.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{e.title}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/60">
              {REMINDER_KIND_LABEL[e.kind]}
            </span>
          </div>
          <div className="text-xs mt-0.5 opacity-80">{e.subtitle}</div>
        </div>
      </li>
    );
  };

  return (
    <div>
      <Header
        title="📥 待处理"
        subtitle={
          totalCount ? `${totalCount} 项待你关注` : '现在没有待办，辛苦了'
        }
      />

      {totalCount === 0 && (
        <div className="px-4 md:px-6 py-4">
          <EmptyState icon="✨" title="待处理列表空空如也" description="新上传的照片或提醒事件会出现在这里" />
        </div>
      )}

      {pendingItems.length > 0 && (
        <section className="px-4 md:px-6 py-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">📦 待归位物品</h2>
            <span className="text-xs text-ink-500">{pendingItems.length}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {pendingItems.map((it) => (
              <div
                key={it.id}
                onClick={() => openModal((close) => <ItemDialog item={it} onClose={close} />)}
                className="bg-white rounded-2xl shadow-soft p-3 cursor-pointer hover:shadow-md"
              >
                <BlobImage
                  blob={it.image || null}
                  emoji={it.aiEmoji || '📦'}
                  className="w-full aspect-square rounded-lg object-cover mb-2"
                />
                <div className="font-medium text-sm truncate">{it.name}</div>
                <div className="text-xs text-orange-600 mt-0.5">点击归位</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {itemEvents.length > 0 && (
        <section className="px-4 md:px-6 py-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">⏰ 物品提醒</h2>
            <span className="text-xs text-ink-500">{itemEvents.length}</span>
          </div>
          <ul className="space-y-2">{itemEvents.map(renderEventRow)}</ul>
        </section>
      )}

      {subEvents.length > 0 && (
        <section className="px-4 md:px-6 py-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">💳 订阅扣款</h2>
            <span className="text-xs text-ink-500">{subEvents.length}</span>
          </div>
          <ul className="space-y-2">{subEvents.map(renderEventRow)}</ul>
        </section>
      )}
    </div>
  );
}
