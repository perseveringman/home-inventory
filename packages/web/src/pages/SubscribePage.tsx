import { useMemo } from 'react';
import { useStore } from '../stores/useStore';
import { Header } from '../components/Header';
import { EmptyState } from '../components/EmptyState';
import { openModal } from '../components/Modal';
import SubscriptionDialog from './modals/SubscriptionDialog';
import {
  SUB_CATEGORIES,
  subscriptionMonthlyCost,
  advanceSubDue,
  type Subscription,
} from '@home-inventory/core';
import { toast } from '../components/Toast';

const CAT_MAP = Object.fromEntries(SUB_CATEGORIES.map((c) => [c.id, c]));

function daysLeft(dateStr?: string) {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T23:59:59').getTime();
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 3600 * 1000));
}

export default function SubscribePage() {
  const subs = useStore((s) => s.subscriptions);
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);

  const active = subs.filter((s) => s.status === 'active');
  const monthTotal = useMemo(
    () => active.reduce((sum, s) => sum + subscriptionMonthlyCost(s), 0),
    [active]
  );

  const sorted = useMemo(() => {
    return subs.slice().sort((a, b) => {
      const statusOrder = { active: 0, paused: 1, cancelled: 2 } as const;
      if (statusOrder[a.status] !== statusOrder[b.status])
        return statusOrder[a.status] - statusOrder[b.status];
      const ta = a.nextDueAt ? new Date(a.nextDueAt).getTime() : Infinity;
      const tb = b.nextDueAt ? new Date(b.nextDueAt).getTime() : Infinity;
      return ta - tb;
    });
  }, [subs]);

  const addSub = () =>
    openModal((close) => <SubscriptionDialog onClose={close} />);
  const editSub = (s: Subscription) =>
    openModal((close) => <SubscriptionDialog sub={s} onClose={close} />);

  const markPaid = async (s: Subscription) => {
    const advanced = advanceSubDue(s);
    advanced.lastPaidAt = new Date().toISOString().slice(0, 10);
    await put('subscriptions', advanced);
    toast(`已标记付款，下次：${advanced.nextDueAt || '未定'}`);
  };

  const togglePause = async (s: Subscription) => {
    const next: Subscription = {
      ...s,
      status: s.status === 'active' ? 'paused' : 'active',
    };
    await put('subscriptions', next);
    toast(next.status === 'paused' ? '已暂停' : '已恢复');
  };

  const remove = async (s: Subscription) => {
    if (!confirm(`删除订阅「${s.name}」？`)) return;
    await del('subscriptions', s.id);
    toast('已删除');
  };

  return (
    <div>
      <Header
        title="🔔 订阅管理"
        subtitle="软件 · 贷款 · 水电 · 会员"
        actions={
          <button
            onClick={addSub}
            className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm"
          >
            ＋ 新增
          </button>
        }
      />

      <div className="px-4 md:px-6 py-4">
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="rounded-2xl p-4 text-white shadow-soft bg-gradient-to-br from-indigo-500 to-purple-500">
            <div className="text-xs opacity-90">月均支出</div>
            <div className="text-xl font-bold mt-1">
              ¥{monthTotal.toFixed(0)}
            </div>
          </div>
          <div className="rounded-2xl p-4 text-white shadow-soft bg-gradient-to-br from-emerald-500 to-teal-500">
            <div className="text-xs opacity-90">年均支出</div>
            <div className="text-xl font-bold mt-1">
              ¥{(monthTotal * 12).toFixed(0)}
            </div>
          </div>
          <div className="rounded-2xl p-4 text-white shadow-soft bg-gradient-to-br from-amber-500 to-orange-500">
            <div className="text-xs opacity-90">生效数</div>
            <div className="text-xl font-bold mt-1">{active.length}</div>
          </div>
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            icon="🔔"
            title="还没有订阅"
            description="点右上「＋ 新增」记录你的定期账单"
          />
        ) : (
          <ul className="space-y-2">
            {sorted.map((s) => {
              const cat = CAT_MAP[s.category] || { emoji: '📌', name: '其他' };
              const dLeft = daysLeft(s.nextDueAt);
              const dueLabel =
                dLeft == null
                  ? '未设定'
                  : dLeft < 0
                  ? `逾期 ${-dLeft} 天`
                  : dLeft === 0
                  ? '今天扣款'
                  : `${dLeft} 天后`;
              const dueCls =
                dLeft == null
                  ? 'text-ink-400'
                  : dLeft < 0 || dLeft <= 3
                  ? 'text-red-600'
                  : dLeft <= 7
                  ? 'text-amber-600'
                  : 'text-ink-500';
              const isPaused = s.status !== 'active';
              return (
                <li
                  key={s.id}
                  className={`bg-white rounded-2xl shadow-soft p-4 flex items-center gap-3 ${
                    isPaused ? 'opacity-60' : ''
                  }`}
                >
                  <div className="text-3xl">{cat.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{s.name}</span>
                      {isPaused && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          {s.status === 'paused' ? '暂停' : '已取消'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      {cat.name} · ¥{s.amount.toFixed(2)} / {s.cycle}
                    </div>
                    <div className={`text-xs mt-0.5 ${dueCls}`}>{dueLabel}</div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => editSub(s)}
                      className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
                    >
                      编辑
                    </button>
                    {s.status === 'active' && (
                      <button
                        onClick={() => markPaid(s)}
                        className="text-xs px-2 py-1 rounded bg-brand-500 hover:bg-brand-600 text-white"
                      >
                        已付
                      </button>
                    )}
                    <button
                      onClick={() => togglePause(s)}
                      className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
                    >
                      {s.status === 'active' ? '暂停' : '恢复'}
                    </button>
                    <button
                      onClick={() => remove(s)}
                      className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50"
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
