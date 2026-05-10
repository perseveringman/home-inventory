import type { Subscription } from '../models';
import { SUB_CYCLES } from '../models';

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
