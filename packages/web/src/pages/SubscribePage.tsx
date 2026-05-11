import { useMemo } from 'react';
import {
  SUB_CATEGORIES,
  advanceSubDue,
  subscriptionMonthlyCost,
  type Subscription,
} from '@home-inventory/core';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { openModal } from '../components/Modal';
import { toast } from '../components/Toast';
import { useStore } from '../stores/useStore';
import SubscriptionDialog from './modals/SubscriptionDialog';
import { PinIcon } from '../components/PinIcon';

const CAT_MAP = Object.fromEntries(SUB_CATEGORIES.map((c) => [c.id, c]));

function daysLeft(dateStr?: string) {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T23:59:59').getTime();
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 3600 * 1000));
}

function subColorBg(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 75%, 96%), hsl(${(hue + 24) % 360}, 70%, 91%))`;
}

function SubCard({ sub, onEdit, onPaid, onPause, onDelete }: {
  sub: Subscription;
  onEdit: (s: Subscription) => void;
  onPaid: (s: Subscription) => void;
  onPause: (s: Subscription) => void;
  onDelete: (s: Subscription) => void;
}) {
  const cat = CAT_MAP[sub.category] || { name: '其他' };
  const dLeft = daysLeft(sub.nextDueAt);
  const dueLabel = dLeft == null ? '未设定' : dLeft < 0 ? `逾期 ${-dLeft} 天` : dLeft === 0 ? '今天扣款' : `${dLeft} 天后`;
  const dueCls = dLeft == null ? 'text-ink-400' : dLeft <= 3 ? 'text-red-600' : dLeft <= 7 ? 'text-amber-600' : 'text-ink-500';
  const isPaused = sub.status !== 'active';
  return (
    <li className={`rounded-2xl shadow-soft p-4 flex items-center gap-3 ${isPaused ? 'opacity-75' : ''}`} style={{ background: subColorBg(sub.id) }}>
      <PinIcon name="subscribe" size={54} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{sub.name}</span>
          {isPaused && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/70 text-slate-500">{sub.status === 'paused' ? '暂停' : '已取消'}</span>}
          {sub.autoRenew === false && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/70 text-slate-500">不续费</span>}
        </div>
        <div className="text-xs text-ink-500 mt-0.5">{cat.name} · ¥{sub.amount.toFixed(2)} / {sub.cycle}</div>
        <div className={`text-xs mt-0.5 ${dueCls}`}>{dueLabel}</div>
      </div>
      <div className="flex flex-col gap-1">
        <button onClick={() => onEdit(sub)} className="text-xs px-2 py-1 rounded bg-white/70 hover:bg-white">编辑</button>
        {sub.status === 'active' && <button onClick={() => onPaid(sub)} className="text-xs px-2 py-1 rounded bg-brand-500 text-white">已付</button>}
        <button onClick={() => onPause(sub)} className="text-xs px-2 py-1 rounded bg-white/70 hover:bg-white">{sub.status === 'active' ? '暂停' : '恢复'}</button>
        <button onClick={() => onDelete(sub)} className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50">删除</button>
      </div>
    </li>
  );
}

export default function SubscribePage() {
  const subs = useStore((s) => s.subscriptions);
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const active = subs.filter((s) => s.status === 'active');
  const paused = subs.filter((s) => s.status !== 'active');
  const monthTotal = useMemo(() => active.reduce((sum, s) => sum + subscriptionMonthlyCost(s), 0), [active]);
  const categoryDist = useMemo(() => {
    const map = new Map<string, number>();
    for (const sub of active) map.set(sub.category, (map.get(sub.category) || 0) + subscriptionMonthlyCost(sub));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [active]);
  const sortedActive = useMemo(() => active.slice().sort((a, b) => (new Date(a.nextDueAt || '2999-01-01').getTime() - new Date(b.nextDueAt || '2999-01-01').getTime())), [active]);

  const addSub = () => openModal((close) => <SubscriptionDialog onClose={close} />);
  const editSub = (s: Subscription) => openModal((close) => <SubscriptionDialog sub={s} onClose={close} />);
  const markPaid = async (s: Subscription) => {
    const advanced = advanceSubDue(s);
    advanced.lastPaidAt = new Date().toISOString().slice(0, 10);
    await put('subscriptions', advanced);
    toast(`已标记付款，下次：${advanced.nextDueAt || '未定'}`);
  };
  const togglePause = async (s: Subscription) => {
    const next: Subscription = { ...s, status: s.status === 'active' ? 'paused' : 'active' };
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
      <Header title="订阅管理" subtitle="软件 · 贷款 · 水电 · 会员" actions={<button onClick={addSub} className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm inline-flex items-center gap-1"><PinIcon name="add" size={24} tile={false} />新增</button>} />
      <div className="px-4 md:px-6 py-4">
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="rounded-2xl p-4 text-white shadow-soft bg-gradient-to-br from-indigo-500 to-purple-500"><div className="text-xs opacity-90">月均支出</div><div className="text-xl font-bold mt-1">¥{monthTotal.toFixed(0)}</div></div>
          <div className="rounded-2xl p-4 text-white shadow-soft bg-gradient-to-br from-emerald-500 to-teal-500"><div className="text-xs opacity-90">年均支出</div><div className="text-xl font-bold mt-1">¥{(monthTotal * 12).toFixed(0)}</div></div>
          <div className="rounded-2xl p-4 text-white shadow-soft bg-gradient-to-br from-amber-500 to-orange-500"><div className="text-xs opacity-90">生效数</div><div className="text-xl font-bold mt-1">{active.length}</div></div>
        </div>

        {categoryDist.length > 0 && (
          <section className="bg-white rounded-2xl shadow-soft p-4 mb-5">
            <h2 className="font-semibold mb-3">分类月均支出</h2>
            <div className="space-y-2">
              {categoryDist.map(([catId, cost]) => {
                const cat = CAT_MAP[catId] || { name: '其他' };
                const pct = monthTotal ? Math.round((cost / monthTotal) * 100) : 0;
                return (
                  <div key={catId}>
                    <div className="flex justify-between text-sm"><span className="inline-flex items-center gap-2"><PinIcon name="tag" size={24} tile={false} />{cat.name}</span><span className="text-ink-500">¥{cost.toFixed(0)} · {pct}%</span></div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1"><div className="h-full bg-gradient-to-r from-brand-500 to-purple-500" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {subs.length === 0 ? (
          <EmptyState icon="subscribe" title="还没有订阅" description="点右上「新增」记录你的定期账单" />
        ) : (
          <>
            <section className="mb-5">
              <h2 className="font-semibold mb-2">生效中</h2>
              <ul className="space-y-2">{sortedActive.map((s) => <SubCard key={s.id} sub={s} onEdit={editSub} onPaid={markPaid} onPause={togglePause} onDelete={remove} />)}</ul>
            </section>
            {paused.length > 0 && (
              <section>
                <h2 className="font-semibold mb-2 text-ink-500">已暂停 / 已取消</h2>
                <ul className="space-y-2">{paused.map((s) => <SubCard key={s.id} sub={s} onEdit={editSub} onPaid={markPaid} onPause={togglePause} onDelete={remove} />)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
