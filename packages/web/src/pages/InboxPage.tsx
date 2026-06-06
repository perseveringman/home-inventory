import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GLOBAL_ROOM_ID,
  REMINDER_KIND_LABEL,
  applyPlacementPlan,
  computeItemEvents,
  computeSubscriptionEvents,
  renewSubDue,
  resetRecognitionTask,
  suggestPlacementPlan,
  type PlacementPlan,
  type ReminderEvent,
  type ReminderKind,
  type Subscription,
} from '@home-inventory/core';
import { BlobImage } from '../components/BlobImage';
import { ItemThumb } from '../components/ItemThumb';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { openModal } from '../components/Modal';
import { getStorage, useStore } from '../stores/useStore';
import ItemDialog from './modals/ItemDialog';
import SubscriptionDialog from './modals/SubscriptionDialog';
import { PinIcon } from '../components/PinIcon';
import { toast } from '../components/Toast';

const LEVEL_STYLE: Record<string, string> = {
  critical: 'bg-red-50 border-red-200 text-red-700',
  warn: 'bg-amber-50 border-amber-200 text-amber-700',
  info: 'bg-slate-50 border-slate-200 text-slate-700',
};

const KIND_ORDER: ReminderKind[] = ['expiry', 'opened', 'warranty', 'lowstock', 'seasonal', 'dust', 'subscription'];

const TASK_STATUS_LABEL = {
  queued: '排队中',
  processing: '识别中',
  failed: '失败',
  completed: '已完成',
} as const;

export default function InboxPage() {
  const navigate = useNavigate();
  const items = useStore((s) => s.items);
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const photos = useStore((s) => s.photos);
  const recognitionTasks = useStore((s) => s.recognitionTasks);
  const scanSessions = useStore((s) => s.scanSessions);
  const subscriptions = useStore((s) => s.subscriptions);
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const reloadAll = useStore((s) => s.reloadAll);
  const [plan, setPlan] = useState<PlacementPlan | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);

  const pendingReviewSessions = useMemo(
    () =>
      scanSessions
        .filter((session) => session.status === 'reviewing')
        .sort((a, b) => b.createdAt - a.createdAt),
    [scanSessions]
  );

  const activeRecognitionTasks = useMemo(
    () =>
      recognitionTasks
        .filter((task) => task.status === 'queued' || task.status === 'processing' || task.status === 'failed')
        .sort((a, b) => a.createdAt - b.createdAt),
    [recognitionTasks]
  );

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

  const totalCount =
    activeRecognitionTasks.length +
    pendingReviewSessions.length +
    pendingGroups.reduce((sum, [, list]) => sum + list.length, 0) +
    eventsByKind.reduce((sum, [, list]) => sum + list.length, 0);

  const roomLabel = (roomId: string) => {
    if (roomId === GLOBAL_ROOM_ID) return '全屋自由区';
    const room = rooms.find((r) => r.id === roomId);
    return room ? room.name : '未知房间';
  };

  const makePlan = () => {
    const next = suggestPlacementPlan(rooms, cabinets, items);
    setPlan(next);
    setSelected(next.suggestions.filter((s) => s.confidence >= 0.5).map((s) => s.itemId));
    toast(next.suggestions.length ? 'AI 分拣方案已生成' : '当前没有待归位物品');
  };

  const retryTask = async (taskId: string) => {
    try {
      await resetRecognitionTask(getStorage(), taskId);
      await reloadAll();
      toast('已重新加入识别队列');
    } catch (err: any) {
      toast(err?.message || '重试失败', 3000);
    }
  };

  const removeTask = async (taskId: string) => {
    await del('recognitionTasks', taskId);
    toast('已移除识别任务');
  };

  const applyPlan = async () => {
    if (!plan || !selected.length) return;
    setApplying(true);
    try {
      const count = await applyPlacementPlan(getStorage(), plan, selected);
      await reloadAll();
      setPlan(null);
      setSelected([]);
      toast(`已归位 ${count} 件物品`);
    } catch (err: any) {
      toast(err?.message || '归位失败', 3000);
    } finally {
      setApplying(false);
    }
  };

  const locate = (itemId?: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return '';
    const cabinet = cabinets.find((c) => c.id === item.cabinetId);
    const room = rooms.find((r) => r.id === item.roomId);
    return `${room ? room.name : '全屋'} › ${cabinet?.name || '自由区'}`;
  };

  const markSubscriptionRenewed = async (sub: Subscription) => {
    try {
      const advanced = renewSubDue(sub);
      advanced.lastPaidAt = new Date().toISOString().slice(0, 10);
      await put('subscriptions', advanced);
      toast(`已续期，下次：${advanced.nextDueAt || '未定'}`);
    } catch (err: any) {
      toast(err?.message || '更新订阅失败', 3000);
    }
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
        {item ? (
          <ItemThumb item={item} className="w-12 h-12 rounded-lg" />
        ) : (
          <BlobImage blob={null} emoji={event.icon} className="w-12 h-12 rounded-lg object-cover bg-white/60" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{event.title}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/70">{event.level}</span>
          </div>
          <div className="text-xs mt-0.5 opacity-80">{event.subtitle}</div>
          {item && <div className="text-[11px] mt-0.5 opacity-70">{locate(item.id)}</div>}
        </div>
        {sub && sub.status === 'active' && (
          <button
            type="button"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              void markSubscriptionRenewed(sub);
            }}
            className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white/80 text-[12px] font-semibold text-emerald-700 border border-emerald-100 hover:bg-white"
          >
            已续期
          </button>
        )}
      </li>
    );
  };

  return (
    <div>
      <Header
        title="待处理"
        subtitle={totalCount ? `${totalCount} 项待你关注` : '现在没有待办，辛苦了'}
        actions={
          <button
            onClick={makePlan}
            disabled={!items.some((item) => item.status === 'pending')}
            className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm disabled:bg-ink-300 inline-flex items-center gap-1"
          >
            <PinIcon name="spark" size={22} tile={false} />AI 分拣
          </button>
        }
      />

      {plan && (
        <section className="px-4 md:px-6 py-3">
          <div className="bg-white rounded-2xl shadow-soft p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="font-semibold inline-flex items-center gap-2">
                  <PinIcon name="spark" size={30} />AI 分拣方案
                </h2>
                <div className="text-xs text-ink-500 mt-0.5">{plan.summary}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPlan(null)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-sm">
                  关闭
                </button>
                <button
                  onClick={applyPlan}
                  disabled={!selected.length || applying}
                  className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm disabled:bg-ink-300"
                >
                  {applying ? '应用中…' : `应用 ${selected.length} 项`}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {plan.suggestions.map((suggestion) => {
                const item = items.find((x) => x.id === suggestion.itemId);
                if (!item) return null;
                const checked = selected.includes(suggestion.itemId);
                return (
                  <label
                    key={suggestion.itemId}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        setSelected((cur) =>
                          event.target.checked
                            ? [...cur, suggestion.itemId]
                            : cur.filter((id) => id !== suggestion.itemId)
                        )
                      }
                    />
                    <ItemThumb item={item} className="w-11 h-11 rounded-lg" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.name}</div>
                      <div className="text-xs text-ink-500 truncate">→ {suggestion.targetLabel}</div>
                      <div className="text-[11px] text-brand-700 mt-0.5">{suggestion.reason}</div>
                    </div>
                    <span className="text-[11px] px-2 py-1 rounded-full bg-white text-ink-500">
                      {Math.round(suggestion.confidence * 100)}%
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {totalCount === 0 && (
        <div className="px-4 md:px-6 py-4">
          <EmptyState icon="spark" title="待处理列表空空如也" description="拍照入队、收集箱和提醒事件会出现在这里" />
        </div>
      )}

      {activeRecognitionTasks.length > 0 && (
        <section className="px-4 md:px-6 py-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold inline-flex items-center gap-2">
              <PinIcon name="spark" size={30} />识别任务队列
            </h2>
            <span className="text-xs px-2 py-1 rounded-full bg-brand-50 text-brand-700">
              {activeRecognitionTasks.length} 个任务
            </span>
          </div>
          <div className="space-y-2">
            {activeRecognitionTasks.map((task) => {
              const photo = photos.find((item) => item.id === task.photoId);
              const failed = task.status === 'failed';
              return (
                <div
                  key={task.id}
                  className="bg-white rounded-2xl shadow-soft p-3 flex items-center gap-3"
                >
                  <BlobImage blob={photo?.blob || null} emoji="spark" className="w-16 h-16 rounded-xl object-cover bg-brand-50" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate">{roomLabel(task.roomId)}</div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${failed ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'}`}>
                        {TASK_STATUS_LABEL[task.status]}
                      </span>
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      {task.status === 'queued'
                        ? '已拍照，等待 AI 处理'
                        : task.status === 'processing'
                          ? 'AI 正在识别这筐物品'
                          : task.errorMessage || '识别失败，请重试'}
                    </div>
                    <div className="text-[11px] text-ink-400 mt-1">
                      {new Date(task.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {failed && (
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => retryTask(task.id)} className="px-2.5 py-1.5 rounded-lg bg-brand-500 text-white text-xs">
                        重试
                      </button>
                      <button onClick={() => removeTask(task.id)} className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs">
                        移除
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {pendingReviewSessions.length > 0 && (
        <section className="px-4 md:px-6 py-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold inline-flex items-center gap-2">
              <PinIcon name="inbox" size={30} />收集箱
            </h2>
            <span className="text-xs px-2 py-1 rounded-full bg-brand-50 text-brand-700">
              {pendingReviewSessions.length} 批待整理
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingReviewSessions.map((session) => {
              const photo = photos.find((item) => item.id === session.photoId);
              const liveCandidates = session.candidates.filter((candidate) => candidate.reviewStatus !== 'rejected');
              const cabinetCount = liveCandidates.filter((candidate) => candidate.kind === 'cabinet').length;
              const itemCount = liveCandidates.filter((candidate) => candidate.kind === 'item').length;
              return (
                <button
                  key={session.id}
                  onClick={() => navigate(`/scan/${session.id}`)}
                  className="text-left bg-white rounded-2xl shadow-soft p-3 hover:shadow-md transition flex items-center gap-3"
                >
                  <BlobImage blob={photo?.blob || null} emoji="spark" className="w-16 h-16 rounded-xl object-cover bg-brand-50" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{roomLabel(session.roomId)}</div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      {cabinetCount} 个柜子 · {itemCount} 件物品候选
                    </div>
                    <div className="text-[11px] text-brand-700 mt-1">整理这筐</div>
                  </div>
                  <span className="text-ink-400">›</span>
                </button>
              );
            })}
          </div>
        </section>
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
                <ItemThumb item={item} className="w-full aspect-square rounded-lg mb-2" />
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
