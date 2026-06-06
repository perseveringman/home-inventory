import { useMemo, useState } from 'react';
import {
  SUB_CATEGORIES,
  findDuplicateSubscriptions,
  renewSubDue,
  subscriptionMonthlyCost,
  type Subscription,
} from '@home-inventory/core';
import { openModal } from '../components/Modal';
import { toast } from '../components/Toast';
import { useStore } from '../stores/useStore';
import SubscriptionDialog from './modals/SubscriptionDialog';
import AddSubscriptionDialog from './modals/AddSubscriptionDialog';
import { PinIcon } from '../components/PinIcon';
import { SubIcon } from '../components/SubIcon';
import { Glyph } from '../components/Glyph';

const CAT_MAP = Object.fromEntries(
  SUB_CATEGORIES.map((category) => [category.id, category])
) as Record<string, (typeof SUB_CATEGORIES)[number]>;

const CYCLE_SHORT: Record<string, string> = {
  weekly: '周',
  monthly: '月',
  quarterly: '季',
  yearly: '年',
  custom: '期',
};

type ViewFilter = 'all' | 'due' | 'review' | 'paused';
type SortMode = 'due' | 'price' | 'name';

function daysLeft(dateStr?: string) {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T23:59:59').getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 3600 * 1000));
}

function dueTime(sub: Subscription) {
  if (!sub.nextDueAt) return Number.POSITIVE_INFINITY;
  const t = new Date(sub.nextDueAt + 'T00:00:00').getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function money(value: number, digits = 0) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

function moneyExact(value: number) {
  const digits = Number.isInteger(value) ? 0 : 2;
  return money(value, digits);
}

function cycleLabel(sub: Subscription) {
  if (sub.cycle === 'custom') return `${sub.cycleDays || 30}天`;
  return CYCLE_SHORT[sub.cycle] || '月';
}

function dueLabel(sub: Subscription) {
  if (sub.status !== 'active') return sub.status === 'cancelled' ? '已取消' : '已暂停';
  const left = daysLeft(sub.nextDueAt);
  if (left == null) return '未设日';
  if (left < 0) return `逾 ${-left} 天`;
  const suffix = sub.autoRenew === false ? '' : '续';
  if (left === 0) return suffix ? `今天${suffix}` : '今天';
  if (left === 1) return suffix ? `明天${suffix}` : '明天';
  if (left <= 14) return `${left} 天${suffix}`;
  const date = new Date(sub.nextDueAt! + 'T00:00:00');
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function dueTone(sub: Subscription) {
  if (sub.status !== 'active') return 'is-muted';
  const left = daysLeft(sub.nextDueAt);
  if (left == null) return 'is-muted';
  if (sub.autoRenew !== false) return 'is-calm';
  if (left <= 3) return 'is-hot';
  if (left <= 14) return 'is-warm';
  return 'is-calm';
}

function sortSubscriptions(list: Subscription[], mode: SortMode) {
  const next = list.slice();
  if (mode === 'price') {
    return next.sort((a, b) => subscriptionMonthlyCost(b) - subscriptionMonthlyCost(a));
  }
  if (mode === 'name') {
    return next.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  return next.sort((a, b) => dueTime(a) - dueTime(b));
}

function SubCard({
  sub,
  onEdit,
  onActions,
}: {
  sub: Subscription;
  onEdit: (s: Subscription) => void;
  onActions: (s: Subscription) => void;
}) {
  const cat = CAT_MAP[sub.category] || { name: '其他' };
  const isPaused = sub.status !== 'active';

  return (
    <li>
      <article className={`sub-card ${isPaused ? 'is-paused' : ''}`}>
        <button
          type="button"
          className="sub-card-main"
          onClick={() => onEdit(sub)}
          aria-label={`编辑 ${sub.name}`}
        >
          <SubIcon iconUrl={sub.iconUrl} label={sub.icon} name={sub.name} size={46} />
          <span className="sub-card-copy">
            <span className="sub-card-title-row">
              <span className="sub-card-title">{sub.name}</span>
              {sub.autoRenew === false && <span className="sub-dot-label">不续</span>}
              {sub.decision === 'cancel' && <span className="sub-dot-label">取消</span>}
              {sub.decision === 'review' && <span className="sub-dot-label">复核</span>}
            </span>
            <span className="sub-card-meta">
              {cat.name}
              {sub.planName ? ` · ${sub.planName}` : ''}
              {sub.paymentMethod ? ` · ${sub.paymentMethod}` : ''}
            </span>
          </span>
          <span className="sub-card-price">
            <b>¥{moneyExact(sub.amount)}</b>
            <small>/{cycleLabel(sub)}</small>
          </span>
        </button>
        <div className="sub-card-footer">
          <span className={`sub-due-pill ${dueTone(sub)}`}>{dueLabel(sub)}</span>
          <button
            type="button"
            className="sub-more-btn"
            onClick={() => onActions(sub)}
            aria-label={`管理 ${sub.name}`}
          >
            <Glyph name="more" size={18} />
          </button>
        </div>
      </article>
    </li>
  );
}

function SubscriptionActionSheet({
  sub,
  onClose,
  onEdit,
  onPaid,
  onPause,
  onDelete,
}: {
  sub: Subscription;
  onClose: () => void;
  onEdit: (s: Subscription) => void;
  onPaid: (s: Subscription) => Promise<void>;
  onPause: (s: Subscription) => Promise<void>;
  onDelete: (s: Subscription) => Promise<void>;
}) {
  const isActive = sub.status === 'active';
  const cat = CAT_MAP[sub.category] || { name: '其他' };

  return (
    <div className="sub-action-sheet">
      <div className="sub-action-head">
        <SubIcon iconUrl={sub.iconUrl} label={sub.icon} name={sub.name} size={52} />
        <div className="min-w-0">
          <h3>{sub.name}</h3>
          <p>
            {cat.name} · ¥{moneyExact(sub.amount)} / {cycleLabel(sub)}
          </p>
        </div>
        <button type="button" className="sub-action-close" onClick={onClose} aria-label="关闭">
          <Glyph name="close" size={18} />
        </button>
      </div>

      <div className="sub-action-grid">
        <button type="button" onClick={() => onEdit(sub)}>
          <Glyph name="pencil" size={18} />
          编辑
        </button>
        {isActive ? (
          <>
            <button
              type="button"
              onClick={() => {
                void onPaid(sub);
              }}
            >
              <Glyph name="check" size={18} />
              已续期
            </button>
            <button
              type="button"
              onClick={() => {
                void onPause(sub);
              }}
            >
              <Glyph name="minus" size={18} />
              暂停
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              void onPause(sub);
            }}
          >
            <Glyph name="check" size={18} />
            恢复
          </button>
        )}
        <button
          type="button"
          className="is-danger"
          onClick={() => {
            void onDelete(sub);
          }}
        >
          <Glyph name="trash" size={18} />
          删除
        </button>
      </div>
    </div>
  );
}

export default function SubscribePage() {
  const subs = useStore((s) => s.subscriptions);
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [sort, setSort] = useState<SortMode>('due');

  const active = useMemo(() => subs.filter((s) => s.status === 'active'), [subs]);
  const paused = useMemo(() => subs.filter((s) => s.status !== 'active'), [subs]);
  const monthTotal = useMemo(
    () => active.reduce((sum, s) => sum + subscriptionMonthlyCost(s), 0),
    [active]
  );
  const duplicateGroups = useMemo(() => findDuplicateSubscriptions(subs), [subs]);
  const duplicateIds = useMemo(
    () => new Set(duplicateGroups.flatMap((group) => group.subscriptions.map((sub) => sub.id))),
    [duplicateGroups]
  );
  const dueSoon = useMemo(
    () =>
      active
        .filter((sub) => {
          const left = daysLeft(sub.nextDueAt);
          return left != null && left <= 14;
        })
        .sort((a, b) => dueTime(a) - dueTime(b)),
    [active]
  );
  const reviewSubs = useMemo(
    () =>
      sortSubscriptions(
        active.filter(
          (sub) =>
            sub.decision === 'review' ||
            sub.decision === 'cancel' ||
            sub.autoRenew === false ||
            !sub.nextDueAt ||
            !sub.paymentMethod ||
            duplicateIds.has(sub.id)
        ),
        'due'
      ),
    [active, duplicateIds]
  );
  const sortedActive = useMemo(() => sortSubscriptions(active, sort), [active, sort]);

  const visibleSubs = useMemo(() => {
    if (filter === 'due') return dueSoon;
    if (filter === 'review') return reviewSubs;
    if (filter === 'paused') return sortSubscriptions(paused, sort);
    return sortedActive;
  }, [dueSoon, filter, paused, reviewSubs, sort, sortedActive]);

  const filterDefs: Array<{ id: ViewFilter; label: string; count: number }> = [
    { id: 'all', label: '全部', count: active.length },
    { id: 'due', label: '近期', count: dueSoon.length },
    { id: 'review', label: '复核', count: reviewSubs.length },
    { id: 'paused', label: '停用', count: paused.length },
  ];

  const addSub = () => openModal((close) => <AddSubscriptionDialog onClose={close} />);
  const editSub = (s: Subscription) => openModal((close) => <SubscriptionDialog sub={s} onClose={close} />);
  const markPaid = async (s: Subscription) => {
    const advanced = renewSubDue(s);
    advanced.lastPaidAt = new Date().toISOString().slice(0, 10);
    await put('subscriptions', advanced);
    toast(`下次：${advanced.nextDueAt || '未定'}`);
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
  const openActions = (s: Subscription) =>
    openModal((close) => (
      <SubscriptionActionSheet
        sub={s}
        onClose={close}
        onEdit={(target) => {
          close();
          window.setTimeout(() => editSub(target), 0);
        }}
        onPaid={async (target) => {
          await markPaid(target);
          close();
        }}
        onPause={async (target) => {
          await togglePause(target);
          close();
        }}
        onDelete={async (target) => {
          close();
          await remove(target);
        }}
      />
    ));

  const rotateSort = () => {
    setSort((current) => (current === 'due' ? 'price' : current === 'price' ? 'name' : 'due'));
  };

  const sortLabel = sort === 'due' ? '到期' : sort === 'price' ? '金额' : '名称';
  const listEmpty =
    filter === 'due'
      ? '近期没有扣款'
      : filter === 'review'
        ? '没有需要复核的订阅'
        : filter === 'paused'
          ? '没有停用订阅'
          : '没有生效订阅';

  return (
    <main className="subscribe-page">
      <section className="subscribe-hero" aria-label="订阅概览">
        <button type="button" className="subscribe-hero-add" onClick={addSub} aria-label="新增订阅" title="新增订阅">
          <Glyph name="plus" size={22} strokeWidth={1.9} />
        </button>
        <div className="subscribe-total-block">
          <span>订阅</span>
          <strong>
            <small>¥</small>
            {money(monthTotal)}
          </strong>
          <em>月均</em>
        </div>
        <div className="subscribe-metrics" aria-label="订阅统计">
          <div>
            <span>全年</span>
            <b>¥{money(monthTotal * 12)}</b>
          </div>
          <div>
            <span>生效</span>
            <b>{active.length}</b>
          </div>
          <div>
            <span>近期</span>
            <b>{dueSoon.length}</b>
          </div>
        </div>
      </section>

      {dueSoon.length > 0 && (
        <section className="subscribe-due-strip" aria-label="近期扣款">
          {dueSoon.slice(0, 2).map((sub) => (
            <button key={sub.id} type="button" onClick={() => editSub(sub)} className="sub-due-mini">
              <SubIcon iconUrl={sub.iconUrl} label={sub.icon} name={sub.name} size={34} />
              <span>
                <b>{sub.name}</b>
                <small>{dueLabel(sub)}</small>
              </span>
              <em>¥{moneyExact(sub.amount)}</em>
            </button>
          ))}
        </section>
      )}

      {subs.length === 0 ? (
        <section className="subscribe-empty-state">
          <PinIcon name="subscribe" size={82} />
          <h2>还没有订阅</h2>
        </section>
      ) : (
        <>
          <div className="subscribe-toolbar">
            <div className="subscribe-segment" role="tablist" aria-label="订阅筛选">
              {filterDefs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  className={filter === item.id ? 'is-active' : ''}
                  onClick={() => setFilter(item.id)}
                >
                  <span>{item.label}</span>
                  <b>{item.count}</b>
                </button>
              ))}
            </div>
            <button type="button" className="subscribe-sort-btn" onClick={rotateSort}>
              {sortLabel}
            </button>
          </div>

          {visibleSubs.length > 0 ? (
            <ul className="subscribe-list">
              {visibleSubs.map((s) => (
                <SubCard key={s.id} sub={s} onEdit={editSub} onActions={openActions} />
              ))}
            </ul>
          ) : (
            <div className="subscribe-list-empty">{listEmpty}</div>
          )}
        </>
      )}
    </main>
  );
}
