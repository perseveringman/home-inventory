/**
 * 提醒事件引擎：从 items / subscriptions 派生出待处理事件。
 * 纯函数，输入-输出确定，无副作用。
 */
import type {
  Item,
  ReminderEvent,
  ReminderLevel,
  Subscription,
} from '../models';
import { REMINDER_ICONS } from '../models';
import { daysBetween, expiryInfo } from '../utils/date';

const DUST_DAYS = 180;

const SEASON_MONTHS: Record<string, number[]> = {
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  autumn: [9, 10, 11],
  winter: [12, 1, 2],
};

export function seasonLabel(s: string): string {
  return (
    ({ spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' } as Record<
      string,
      string
    >)[s] || s
  );
}

export function computeItemEvents(items: Item[]): ReminderEvent[] {
  const events: ReminderEvent[] = [];
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const curMonth = today.getMonth() + 1;

  for (const it of items) {
    if (it.status === 'pending') continue;

    // 1. 保质期
    if (it.expiry) {
      const info = expiryInfo(it.expiry);
      if (info && info.level !== 'ok') {
        events.push({
          kind: 'expiry',
          level:
            info.level === 'expired' || info.level === 'soon' ? 'critical' : 'warn',
          itemId: it.id,
          title: it.name,
          subtitle: info.label,
          daysLeft: info.days,
          icon: REMINDER_ICONS.expiry,
        });
      }
    }

    // 2. 开封后超期
    if (it.openedAt && it.openedShelfDays) {
      const openedMs = new Date(it.openedAt + 'T00:00:00').getTime();
      if (!isNaN(openedMs)) {
        const passed = daysBetween(openedMs, now);
        const remain = +it.openedShelfDays - passed;
        if (remain <= 14) {
          events.push({
            kind: 'opened',
            level: remain < 0 ? 'critical' : remain <= 3 ? 'critical' : 'warn',
            itemId: it.id,
            title: it.name,
            subtitle:
              remain < 0
                ? `开封已 ${passed} 天 · 超过建议 ${-remain} 天`
                : `开封已 ${passed} 天 · 还剩 ${remain} 天`,
            daysLeft: remain,
            icon: REMINDER_ICONS.opened,
          });
        }
      }
    }

    // 3. 保修到期
    if (it.purchasedAt && it.warrantyMonths) {
      const pMs = new Date(it.purchasedAt + 'T00:00:00').getTime();
      if (!isNaN(pMs)) {
        const end = new Date(pMs);
        end.setMonth(end.getMonth() + +it.warrantyMonths);
        const remainDays = daysBetween(now, end.getTime());
        if (remainDays <= 60) {
          events.push({
            kind: 'warranty',
            level:
              remainDays < 0 ? 'info' : remainDays <= 30 ? 'critical' : 'warn',
            itemId: it.id,
            title: it.name,
            subtitle:
              remainDays < 0 ? `保修已过 ${-remainDays} 天` : `保修还剩 ${remainDays} 天`,
            daysLeft: remainDays,
            icon: REMINDER_ICONS.warranty,
          });
        }
      }
    }

    // 4. 库存低
    if (it.minStock != null && it.minStock !== null && +it.minStock > 0) {
      const q = +it.qty || 0;
      if (q < +it.minStock) {
        events.push({
          kind: 'lowstock',
          level: q === 0 ? 'critical' : 'warn',
          itemId: it.id,
          title: it.name,
          subtitle:
            q === 0 ? `库存为 0 · 建议补货` : `库存 ${q} 件（低于下限 ${it.minStock}）`,
          daysLeft: -999,
          icon: REMINDER_ICONS.lowstock,
        });
      }
    }

    // 5. 换季
    if (it.season && SEASON_MONTHS[it.season]) {
      const months = SEASON_MONTHS[it.season]!;
      const firstMonth = months[0]!;
      const preMonth = firstMonth === 1 ? 12 : firstMonth - 1;
      if (curMonth === preMonth || curMonth === firstMonth) {
        events.push({
          kind: 'seasonal',
          level: 'info',
          itemId: it.id,
          title: it.name,
          subtitle: `${seasonLabel(it.season)}将至 · 该整理上架了`,
          daysLeft: 9999,
          icon: REMINDER_ICONS.seasonal,
        });
      }
    }

    // 6. 久未动
    const lastMs = it.lastTouchedAt || it.createdAt || 0;
    if (lastMs && daysBetween(lastMs, now) >= DUST_DAYS) {
      events.push({
        kind: 'dust',
        level: 'info',
        itemId: it.id,
        title: it.name,
        subtitle: `已 ${daysBetween(lastMs, now)} 天未动 · 是否还需要？`,
        daysLeft: 99999,
        icon: REMINDER_ICONS.dust,
      });
    }
  }

  return sortEvents(events);
}

export function computeSubscriptionEvents(subs: Subscription[]): ReminderEvent[] {
  const events: ReminderEvent[] = [];
  const now = Date.now();
  for (const sub of subs) {
    if (sub.status === 'cancelled' || sub.status === 'paused') continue;
    if (!sub.nextDueAt) continue;
    const dueMs = new Date(sub.nextDueAt + 'T23:59:59').getTime();
    if (isNaN(dueMs)) continue;
    const remain = Math.ceil((dueMs - now) / (24 * 3600 * 1000));
    if (remain > 14) continue;
    let level: ReminderLevel = 'info';
    if (remain < 0) level = 'critical';
    else if (remain <= 3) level = 'critical';
    else if (remain <= 7) level = 'warn';
    const amount = sub.amount ? `¥${(+sub.amount).toFixed(2)}` : '';
    events.push({
      kind: 'subscription',
      level,
      subId: sub.id,
      title: sub.name,
      subtitle:
        remain < 0
          ? `已逾期 ${-remain} 天${amount ? ` · ${amount}` : ''}`
          : remain === 0
          ? `今天扣款${amount ? ` · ${amount}` : ''}`
          : `${remain} 天后扣款${amount ? ` · ${amount}` : ''}`,
      daysLeft: remain,
      icon: REMINDER_ICONS.subscription,
    });
  }
  return events;
}

export function sortEvents(events: ReminderEvent[]): ReminderEvent[] {
  const order = { critical: 0, warn: 1, info: 2 } as const;
  return events.slice().sort((a, b) => {
    if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
    return a.daysLeft - b.daysLeft;
  });
}
