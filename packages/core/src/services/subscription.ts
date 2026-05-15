import type { SubCategory, Subscription } from '../models';
import { SUB_CATEGORIES, SUB_CYCLES } from '../models';

export function subscriptionCycleDays(sub: Subscription): number {
  const preset = SUB_CYCLES.find((c) => c.id === sub.cycle);
  if (preset && sub.cycle !== 'custom') return preset.days;
  if (sub.cycle === 'custom' && sub.cycleDays && +sub.cycleDays > 0) return +sub.cycleDays;
  return 30;
}

/** 月均 = 金额 * 30 / 周期天数 */
export function subscriptionMonthlyCost(sub: Subscription): number {
  const amount = +sub.amount || 0;
  return (amount * 30) / subscriptionCycleDays(sub);
}

/** 按 cycle 推进 nextDueAt 到今天之后 */
export function advanceSubDue(sub: Subscription): Subscription {
  if (!sub.nextDueAt) return sub;
  const days = subscriptionCycleDays(sub);
  let d = new Date(sub.nextDueAt + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  while (d.getTime() <= today.getTime()) {
    d = new Date(d.getTime() + days * 24 * 3600 * 1000);
  }
  return { ...sub, nextDueAt: d.toISOString().slice(0, 10) };
}

export type SubscriptionInsightTone = 'critical' | 'warn' | 'info' | 'good';

export interface SubscriptionInsight {
  id: string;
  tone: SubscriptionInsightTone;
  title: string;
  detail: string;
}

export interface DuplicateSubscriptionGroup {
  key: string;
  score: number;
  subscriptions: Subscription[];
  reason: string;
}

const CAT_NAME = Object.fromEntries(
  SUB_CATEGORIES.map((c) => [c.id, c.name])
) as Record<SubCategory, string>;

function daysUntil(dateStr: string | undefined, now: number): number | null {
  if (!dateStr) return null;
  const due = new Date(dateStr + 'T23:59:59').getTime();
  if (Number.isNaN(due)) return null;
  return Math.ceil((due - now) / (24 * 3600 * 1000));
}

function normalizeSubName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/会员|订阅|套餐|年度|年费|月费|plus|pro|premium|basic|standard|家庭版|个人版/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function similarity(a: string, b: string): number {
  const x = normalizeSubName(a);
  const y = normalizeSubName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.86;
  const xs = new Set(Array.from(x));
  const ys = new Set(Array.from(y));
  const shared = Array.from(xs).filter((ch) => ys.has(ch)).length;
  return shared / Math.max(xs.size, ys.size);
}

export function findDuplicateSubscriptions(subscriptions: Subscription[]): DuplicateSubscriptionGroup[] {
  const activeish = subscriptions.filter((sub) => sub.status !== 'cancelled');
  const groups: DuplicateSubscriptionGroup[] = [];
  const used = new Set<string>();

  for (let i = 0; i < activeish.length; i += 1) {
    const base = activeish[i]!;
    if (used.has(base.id)) continue;
    const matches = [base];
    let bestScore = 0;
    for (let j = i + 1; j < activeish.length; j += 1) {
      const other = activeish[j]!;
      if (used.has(other.id)) continue;
      const nameScore = similarity(base.name, other.name);
      const sameCategory = base.category === other.category;
      const closeAmount = Math.abs(subscriptionMonthlyCost(base) - subscriptionMonthlyCost(other)) <= Math.max(8, subscriptionMonthlyCost(base) * 0.12);
      const score = nameScore + (sameCategory ? 0.08 : 0) + (closeAmount ? 0.06 : 0);
      if (score >= 0.82) {
        matches.push(other);
        bestScore = Math.max(bestScore, Math.min(1, score));
      }
    }
    if (matches.length > 1) {
      matches.forEach((sub) => used.add(sub.id));
      groups.push({
        key: normalizeSubName(base.name) || base.id,
        score: Math.round(bestScore * 100) / 100,
        subscriptions: matches,
        reason: '名称高度相似，且类别或月均金额接近',
      });
    }
  }

  return groups.sort((a, b) => b.score - a.score);
}

export function latestPriceChange(sub: Subscription): { from: number; to: number; pct: number; date?: string } | null {
  const history = (sub.priceHistory || [])
    .filter((point) => Number.isFinite(point.amount))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (history.length < 2) return null;
  const prev = history[history.length - 2]!;
  const cur = history[history.length - 1]!;
  if (!prev.amount || cur.amount <= prev.amount) return null;
  return {
    from: prev.amount,
    to: cur.amount,
    pct: Math.round(((cur.amount - prev.amount) / prev.amount) * 100),
    date: cur.date,
  };
}

export function buildSubscriptionInsights(
  subscriptions: Subscription[],
  now = Date.now()
): SubscriptionInsight[] {
  const active = subscriptions.filter((s) => s.status === 'active');
  const insights: SubscriptionInsight[] = [];
  const monthlyTotal = active.reduce((sum, sub) => sum + subscriptionMonthlyCost(sub), 0);
  const duplicates = findDuplicateSubscriptions(subscriptions);
  if (duplicates.length) {
    const first = duplicates[0]!;
    insights.push({
      id: 'duplicates',
      tone: 'warn',
      title: `发现 ${duplicates.length} 组疑似重复订阅`,
      detail: `${first.subscriptions.map((sub) => sub.name).join('、')} 可能是同一服务，可让 AI 合并或保留一个。`,
    });
  }

  const hikes = active
    .map((sub) => ({ sub, change: latestPriceChange(sub) }))
    .filter((item): item is { sub: Subscription; change: { from: number; to: number; pct: number; date?: string } } => !!item.change && item.change.pct >= 10)
    .sort((a, b) => b.change.pct - a.change.pct);
  if (hikes.length) {
    const top = hikes[0]!;
    insights.push({
      id: 'price-hike',
      tone: 'warn',
      title: `${top.sub.name} 价格上涨 ${top.change.pct}%`,
      detail: `${top.change.from.toFixed(0)} → ${top.change.to.toFixed(0)}，建议续费前复核套餐价值。`,
    });
  }

  const dueSoon = active
    .map((sub) => ({ sub, days: daysUntil(sub.nextDueAt, now) }))
    .filter((item): item is { sub: Subscription; days: number } => item.days != null && item.days <= 7)
    .sort((a, b) => a.days - b.days);
  const overdue = dueSoon.filter((item) => item.days < 0);
  if (overdue.length) {
    insights.push({
      id: 'overdue',
      tone: 'critical',
      title: `${overdue.length} 个订阅已逾期`,
      detail: overdue
        .slice(0, 3)
        .map((item) => `${item.sub.name} 逾期 ${-item.days} 天`)
        .join('，'),
    });
  } else if (dueSoon.length) {
    insights.push({
      id: 'due-soon',
      tone: 'warn',
      title: `7 天内有 ${dueSoon.length} 笔扣款`,
      detail: dueSoon
        .slice(0, 3)
        .map((item) => `${item.sub.name}${item.days === 0 ? '今天' : `${item.days} 天后`}`)
        .join('，'),
    });
  }

  const yearlySoon = active
    .filter((sub) => sub.cycle === 'yearly')
    .map((sub) => ({ sub, days: daysUntil(sub.nextDueAt, now) }))
    .filter((item): item is { sub: Subscription; days: number } => item.days != null && item.days <= 45)
    .sort((a, b) => a.days - b.days);
  if (yearlySoon.length) {
    const total = yearlySoon.reduce((sum, item) => sum + item.sub.amount, 0);
    insights.push({
      id: 'yearly-renewal',
      tone: 'warn',
      title: '年度续费需要提前决策',
      detail: `${yearlySoon[0]!.sub.name} 等 ${yearlySoon.length} 项将在 45 天内续费，合计约 ¥${total.toFixed(0)}`,
    });
  }

  if (monthlyTotal > 0) {
    const byCat = new Map<SubCategory, number>();
    for (const sub of active) {
      byCat.set(sub.category, (byCat.get(sub.category) || 0) + subscriptionMonthlyCost(sub));
    }
    const top = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / monthlyTotal >= 0.5 && active.length >= 3) {
      insights.push({
        id: 'category-concentration',
        tone: 'info',
        title: `${CAT_NAME[top[0]] || top[0]}占订阅支出 ${Math.round((top[1] / monthlyTotal) * 100)}%`,
        detail: `月均约 ¥${top[1].toFixed(0)}。如果这里有同类工具，可以让 AI 帮你做保留/暂停建议。`,
      });
    }
  }

  const missingManagement = active
    .filter((sub) => !sub.url && !sub.cancelUrl && (subscriptionMonthlyCost(sub) >= 30 || daysUntil(sub.nextDueAt, now) != null))
    .sort((a, b) => subscriptionMonthlyCost(b) - subscriptionMonthlyCost(a));
  if (missingManagement.length) {
    insights.push({
      id: 'missing-url',
      tone: 'info',
      title: `${missingManagement.length} 个订阅缺少管理链接`,
      detail: `${missingManagement
        .slice(0, 3)
        .map((sub) => sub.name)
        .join('、')} 退订/改套餐时会更费劲，建议补全。`,
    });
  }

  const cancellationFollowup = subscriptions
    .filter((sub) => sub.status === 'cancelled' && !sub.cancellationCheckedAt && sub.endAt)
    .map((sub) => ({ sub, days: daysUntil(sub.endAt, now) }))
    .filter((item): item is { sub: Subscription; days: number } => item.days != null && item.days <= 14)
    .slice(0, 3);
  if (cancellationFollowup.length) {
    insights.push({
      id: 'cancel-followup',
      tone: 'info',
      title: '有退订需要回查',
      detail: `${cancellationFollowup.map((item) => item.sub.name).join('、')} 已标记取消，建议确认后续是否还扣款。`,
    });
  }

  const inactive = subscriptions.filter((sub) => sub.status !== 'active');
  if (!insights.length) {
    insights.push({
      id: 'healthy',
      tone: 'good',
      title: active.length ? '当前没有明显订阅风险' : '还没有生效订阅',
      detail: active.length
        ? `生效 ${active.length} 项，月均约 ¥${monthlyTotal.toFixed(0)}。可以继续让 AI 做一次保留/取消审计。`
        : inactive.length
        ? `已有 ${inactive.length} 项暂停/取消记录，新增订阅后 AI 会自动纳入审计。`
        : '粘贴账单文本或说一句订阅信息，AI 可以先生成草稿再让你确认。',
    });
  }

  return insights.slice(0, 4);
}
