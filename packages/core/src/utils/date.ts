/** 两个时间戳之间的整天数 */
export function daysBetween(aMs: number, bMs: number): number {
  return Math.floor((bMs - aMs) / (24 * 60 * 60 * 1000));
}

/** yyyy-mm-dd */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export interface ExpiryInfo {
  days: number;
  level: 'expired' | 'soon' | 'warn' | 'ok';
  label: string;
  cls: string;
}

export function expiryInfo(dateStr?: string): ExpiryInfo | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T23:59:59');
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = d.getTime() - today.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return {
      days,
      level: 'expired',
      label: `已过期 ${-days} 天`,
      cls: 'bg-red-100 text-red-700 border-red-200',
    };
  }
  if (days === 0) {
    return {
      days,
      level: 'expired',
      label: '今日到期',
      cls: 'bg-red-100 text-red-700 border-red-200',
    };
  }
  if (days <= 30) {
    return {
      days,
      level: 'soon',
      label: `${days} 天后过期`,
      cls: 'bg-orange-100 text-orange-700 border-orange-200',
    };
  }
  if (days <= 90) {
    return {
      days,
      level: 'warn',
      label: `${days} 天后过期`,
      cls: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  return {
    days,
    level: 'ok',
    label: `保质至 ${dateStr}`,
    cls: 'bg-slate-100 text-slate-600 border-slate-200',
  };
}
