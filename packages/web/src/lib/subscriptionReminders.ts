import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Subscription } from '@home-inventory/core';

const STORAGE_KEY = 'home-inventory:subscription-renewal-reminder-ids';
const REMIND_BEFORE_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

function reminderId(subId: string): number {
  let hash = 0;
  for (let i = 0; i < subId.length; i += 1) {
    hash = (hash * 31 + subId.charCodeAt(i)) | 0;
  }
  return 1_200_000_000 + Math.abs(hash % 900_000_000);
}

function readScheduledIds(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

function writeScheduledIds(ids: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }
}

function notificationDate(sub: Subscription, now = Date.now()): Date | null {
  if (sub.status !== 'active' || sub.autoRenew !== false || !sub.nextDueAt) return null;

  const due = new Date(`${sub.nextDueAt}T09:00:00`);
  if (Number.isNaN(due.getTime()) || due.getTime() <= now) return null;

  const sevenDaysBefore = new Date(due.getTime() - REMIND_BEFORE_DAYS * DAY_MS);
  if (sevenDaysBefore.getTime() > now) return sevenDaysBefore;

  return new Date(now + 10_000);
}

async function ensureNotificationPermission(): Promise<boolean> {
  const checked = (await LocalNotifications.checkPermissions()) as { display?: string; notifications?: string };
  let permission = checked.display || checked.notifications;
  if (permission !== 'granted') {
    const requested = (await LocalNotifications.requestPermissions()) as { display?: string; notifications?: string };
    permission = requested.display || requested.notifications;
  }
  return permission === 'granted';
}

export async function syncSubscriptionRenewalReminders(subscriptions: Subscription[]) {
  if (!Capacitor.isNativePlatform()) return;

  const previousIds = readScheduledIds();
  if (previousIds.length) {
    await LocalNotifications.cancel({
      notifications: previousIds.map((id) => ({ id })),
    });
  }

  const now = Date.now();
  const notifications = subscriptions
    .map((sub) => {
      const at = notificationDate(sub, now);
      if (!at) return null;
      const amount = sub.amount ? `，金额 ¥${(+sub.amount).toFixed(2)}` : '';
      return {
        id: reminderId(sub.id),
        title: '订阅到期提醒',
        body: `${sub.name} 将在 ${REMIND_BEFORE_DAYS} 天内到期${amount}，请确认是否续期。`,
        schedule: { at },
        extra: {
          kind: 'subscription-renewal',
          subId: sub.id,
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);

  if (!notifications.length) {
    writeScheduledIds([]);
    return;
  }

  const granted = await ensureNotificationPermission();
  if (!granted) {
    writeScheduledIds([]);
    return;
  }

  await LocalNotifications.schedule({ notifications });
  writeScheduledIds(notifications.map((item) => item.id));
}
