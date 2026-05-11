import { useMemo } from 'react';
import {
  GLOBAL_ROOM_ID,
  REMINDER_KIND_LABEL,
  computeItemEvents,
  computeSubscriptionEvents,
  type ReminderEvent,
  type ReminderKind,
} from '@home-inventory/core';
import { BlobImage } from '../components/BlobImage';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { openModal } from '../components/Modal';
import { useStore } from '../stores/useStore';
import ItemDialog from './modals/ItemDialog';
import SubscriptionDialog from './modals/SubscriptionDialog';
import { PinIcon } from '../components/PinIcon';

const LEVEL_STYLE: Record<string, string> = {
  critical: 'bg-red-50 border-red-200 text-red-700',
  warn: 'bg-amber-50 border-amber-200 text-amber-700',
  info: 'bg-slate-50 border-slate-200 text-slate-700',
};

const KIND_ORDER: ReminderKind[] = ['expiry', 'opened', 'warranty', 'lowstock', 'seasonal', 'dust', 'subscription'];

export default function InboxPage() {
  const items = useStore((s) => s.items);
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const subscriptions = useStore((s) => s.subscriptions);

  const pendingGroups = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items.filter((i) => i.status === 'pending')) {
      const key = item.roomId || GLOBAL_ROOM_ID;
      map.set(key, [...(map.get(key) || []), item]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => (a === GLOBAL_ROOM_ID ? -1 : b === GLOBAL_ROOM_ID ? 1 : 0));
  }, [items]);

  const eventsByKind = useMemo(() => {
    const all = [...computeItemEvents(items), ...computeSubscriptionEvents(subscriptions)];
    const map = new Map<ReminderKind, ReminderEvent[]>();
    for (const event of all) map.set(event.kind, [...(map.get(event.kind) || []), event]);
    return KIND_ORDER.map((kind) => [kind, map.get(kind) || []] as const).filter(([, list]) => list.length);
  }, [items, subscriptions]);

  const totalCount = pendingGroups.reduce((sum, [, list]) => sum + list.length, 0) + eventsByKind.reduce((sum, [, list]) => sum + list.length, 0);

  const roomLabel = (roomId: string) => {
    if (roomId === GLOBAL_ROOM_ID) return '全屋自由区';
    const room = rooms.find((r) => r.id === roomId);
    return room ? room.name : '未知房间';
  };

  const locate = (itemId?: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return '';
    const cabinet = cabinets.find((c) => c.id === item.cabinetId);
    const room = rooms.find((r) => r.id === item.roomId);
    return `${room ? room.name : '全屋'} › ${cabinet?.name || '自由区'}`;
  };

  const renderEventRow = (event: ReminderEvent) => {
    const item = items.find((x) => x.id === event.itemId);
    const sub = subscriptions.find((x) => x.id === event.subId);
    return (
      <li
        key={`${event.kind}-${event.itemId || event.subId}-${event.title}`}
        onClick={() => {
          if (item) openModal((close) => <ItemDialog item={item} onClose={close} />);
          else if (sub) openModal((close) => <SubscriptionDialog sub={sub} onClose={close} />);
        }}
        className={`border rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:shadow-soft transition ${LEVEL_STYLE[event.level]}`}
      >
        <BlobImage blob={item?.image || null} emoji={item?.aiEmoji || event.icon} className="w-12 h-12 rounded-lg object-cover bg-white/60" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{event.title}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/70">{event.level}</span>
          </div>
          <div className="text-xs mt-0.5 opacity-80">{event.subtitle}</div>
          {item && <div className="text-[11px] mt-0.5 opacity-70">{locate(item.id)}</div>}
        </div>
      </li>
    );
  };

  return (
    <div>
      <Header title="待处理" subtitle={totalCount ? `${totalCount} 项待你关注` : '现在没有待办，辛苦了'} />

      {totalCount === 0 && (
        <div className="px-4 md:px-6 py-4">
          <EmptyState icon="spark" title="待处理列表空空如也" description="新上传的照片或提醒事件会出现在这里" />
        </div>
      )}

      {pendingGroups.map(([roomId, list]) => (
        <section key={roomId} className="px-4 md:px-6 py-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold inline-flex items-center gap-2"><PinIcon name={roomId === GLOBAL_ROOM_ID ? 'box' : 'room'} size={30} />{roomLabel(roomId)}</h2>
            <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700">{list.length} 待归位</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {list.map((item) => (
              <button key={item.id} onClick={() => openModal((close) => <ItemDialog item={item} onClose={close} />)} className="text-left bg-white rounded-2xl shadow-soft p-3 hover:shadow-md">
                <BlobImage blob={item.image || null} emoji={item.aiEmoji || 'box'} className="w-full aspect-square rounded-lg object-cover mb-2" />
                <div className="font-medium text-sm truncate">{item.name}</div>
                <div className="text-xs text-orange-600 mt-0.5">点击归位</div>
              </button>
            ))}
          </div>
        </section>
      ))}

      {eventsByKind.map(([kind, list]) => {
        const critical = list.filter((event) => event.level === 'critical').length;
        return (
          <section key={kind} className="px-4 md:px-6 py-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold inline-flex items-center gap-2"><PinIcon name={kind === 'subscription' ? 'subscribe' : 'spark'} size={28} />{REMINDER_KIND_LABEL[kind]}</h2>
              <div className="flex gap-1">
                {critical > 0 && <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">{critical} 紧急</span>}
                <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-ink-500">{list.length}</span>
              </div>
            </div>
            <ul className="space-y-2">{list.map(renderEventRow)}</ul>
          </section>
        );
      })}
    </div>
  );
}
