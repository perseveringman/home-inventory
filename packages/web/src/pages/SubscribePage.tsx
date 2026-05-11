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
import { Glyph } from '../components/Glyph';

const CAT_MAP = Object.fromEntries(SUB_CATEGORIES.map((c) => [c.id, c]));

function daysLeft(dateStr?: string) {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T23:59:59').getTime();
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 3600 * 1000));
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
  const dueCls = dLeft == null ? 'text-ink-400' : dLeft <= 3 ? 'text-clay-600' : dLeft <= 7 ? 'text-amber-600' : 'text-ink-500';
  const isPaused = sub.status !== 'active';
  return (
    <li className={`bg-white rounded-2xl shadow-soft p-4 flex items-center gap-3 ${isPaused ? 'opacity-70' : ''}`}>
      <PinIcon name="subscribe" size={44} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-[15px] text-ink-900 truncate">{sub.name}</span>
          {isPaused && <span className="chip">{sub.status === 'paused' ? '暂停' : '已取消'}</span>}
          {sub.autoRenew === false && <span className="chip">不续费</span>}
        </div>
        <div className="text-[11.5px] text-ink-500 mt-1 tabular-nums">{cat.name} · ¥{sub.amount.toFixed(2)} / {sub.cycle}</div>
        <div className={`text-[11.5px] mt-0.5 tabular-nums ${dueCls}`}>{dueLabel}</div>
      </div>
      <div className="flex flex-col gap-1.5">
        {sub.status === 'active' && (
          <button onClick={() => onPaid(sub)} className="bg-brand-500 hover:bg-brand-600 text-white text-[11.5px] px-2.5 py-1 rounded-full">已付</button>
        )}
        <button onClick={() => onEdit(sub)} className="text-[11.5px] text-ink-500 hover:text-ink-900 px-2 py-0.5">编辑</button>
        <button onClick={() => onPause(sub)} className="text-[11.5px] text-ink-500 hover:text-ink-900 px-2 py-0.5">{sub.status === 'active' ? '暂停' : '恢复'}</button>
        <button onClick={() => onDelete(sub)} className="text-[11.5px] text-clay-600 hover:text-clay-700 px-2 py-0.5">删除</button>
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
      <Header title="订阅管理" subtitle="软件 · 贷款 · 水电 · 会员" actions={<button onClick={addSub} className="px-3.5 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5"><Glyph name="plus" size={15} strokeWidth={1.8} />新增</button>} />
      <div className="py-4 md:py-5">
        <div className="grid grid-cols-3 gap-2.5 md:gap-3 mb-5">
          <div className="bg-white rounded-2xl shadow-soft p-4">
            <div className="eyebrow text-[9.5px]">月均支出</div>
            <div className="font-display text-2xl text-ink-900 mt-2 tabular-nums leading-none">
              <span className="text-ink-400 mr-0.5 text-xl">¥</span>{monthTotal.toFixed(0)}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-soft p-4">
            <div className="eyebrow text-[9.5px]">年均支出</div>
            <div className="font-display text-2xl text-ink-900 mt-2 tabular-nums leading-none">
              <span className="text-ink-400 mr-0.5 text-xl">¥</span>{(monthTotal * 12).toFixed(0)}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-soft p-4">
            <div className="eyebrow text-[9.5px]">生效数</div>
            <div className="font-display text-2xl text-ink-900 mt-2 tabular-nums leading-none">{active.length}</div>
          </div>
        </div>

        {categoryDist.length > 0 && (
          <section className="bg-white rounded-2xl shadow-soft p-4 mb-5">
            <h2 className="font-display text-[15px] mb-3 text-ink-900">分类月均支出</h2>
            <div className="space-y-2.5">
              {categoryDist.map(([catId, cost]) => {
                const cat = CAT_MAP[catId] || { name: '其他' };
                const pct = monthTotal ? Math.round((cost / monthTotal) * 100) : 0;
                return (
                  <div key={catId}>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-ink-700">{cat.name}</span>
                      <span className="text-ink-500 tabular-nums">¥{cost.toFixed(0)} · {pct}%</span>
                    </div>
                    <div className="h-1 bg-paper-200 rounded-full overflow-hidden mt-1.5">
                      <div className="h-full bg-clay-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
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
              <h2 className="font-display text-[15px] mb-2.5 text-ink-900">生效中</h2>
              <ul className="space-y-2">{sortedActive.map((s) => <SubCard key={s.id} sub={s} onEdit={editSub} onPaid={markPaid} onPause={togglePause} onDelete={remove} />)}</ul>
            </section>
            {paused.length > 0 && (
              <section>
                <h2 className="eyebrow mb-2.5">已暂停 / 已取消</h2>
                <ul className="space-y-2">{paused.map((s) => <SubCard key={s.id} sub={s} onEdit={editSub} onPaid={markPaid} onPause={togglePause} onDelete={remove} />)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
