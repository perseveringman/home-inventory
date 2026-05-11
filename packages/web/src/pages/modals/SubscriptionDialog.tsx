import { useState } from 'react';
import {
  SUB_CATEGORIES,
  SUB_CYCLES,
  advanceSubDue,
  uid,
  type SubCategory,
  type SubCycle,
  type Subscription,
} from '@home-inventory/core';
import { toast } from '../../components/Toast';
import { useStore } from '../../stores/useStore';
import { PinIcon } from '../../components/PinIcon';

interface Props {
  sub?: Subscription;
  onClose: () => void;
}

export default function SubscriptionDialog({ sub, onClose }: Props) {
  const put = useStore((s) => s.put);
  const [name, setName] = useState(sub?.name || '');
  const [icon, setIcon] = useState(sub?.icon || '');
  const [category, setCategory] = useState<SubCategory>(sub?.category || 'software');
  const [amount, setAmount] = useState(sub?.amount != null ? String(sub.amount) : '');
  const [cycle, setCycle] = useState<SubCycle>(sub?.cycle || 'monthly');
  const [cycleDays, setCycleDays] = useState(sub?.cycleDays ? String(sub.cycleDays) : '30');
  const [nextDueAt, setNextDueAt] = useState(sub?.nextDueAt || '');
  const [startedAt, setStartedAt] = useState(sub?.startedAt || '');
  const [endAt, setEndAt] = useState(sub?.endAt || '');
  const [autoRenew, setAutoRenew] = useState(sub?.autoRenew ?? true);
  const [paymentMethod, setPaymentMethod] = useState(sub?.paymentMethod || '');
  const [url, setUrl] = useState(sub?.url || '');
  const [note, setNote] = useState(sub?.note || '');

  const build = (): Subscription | null => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('请输入名称');
      return null;
    }
    return {
      id: sub?.id || uid(),
      name: trimmed,
      icon: icon.trim() || undefined,
      category,
      amount: +amount || 0,
      cycle,
      cycleDays: cycle === 'custom' ? +cycleDays || 30 : undefined,
      nextDueAt: nextDueAt || undefined,
      startedAt: startedAt || undefined,
      endAt: endAt || undefined,
      autoRenew,
      paymentMethod: paymentMethod.trim() || undefined,
      url: url.trim() || undefined,
      note: note.trim() || undefined,
      status: sub?.status || 'active',
      createdAt: sub?.createdAt || Date.now(),
      lastPaidAt: sub?.lastPaidAt,
    };
  };

  const save = async () => {
    const next = build();
    if (!next) return;
    await put('subscriptions', next);
    toast(sub ? '已更新' : '已添加');
    onClose();
  };

  const markPaid = async () => {
    const next = build();
    if (!next) return;
    const advanced = advanceSubDue(next);
    advanced.lastPaidAt = new Date().toISOString().slice(0, 10);
    await put('subscriptions', advanced);
    toast(`已标记付款，下次：${advanced.nextDueAt || '未定'}`);
    onClose();
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{sub ? '编辑订阅' : '新增订阅'}</h3>
        <button onClick={onClose} className="text-ink-500 text-xl">×</button>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-[72px_1fr] gap-2">
          <div>
            <label className="block text-sm font-medium mb-1">短标识</label>
            <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="NF" maxLength={4} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-center" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 Netflix" className="w-full border border-slate-200 rounded-lg px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">类型</label>
          <div className="grid grid-cols-4 gap-2">
            {SUB_CATEGORIES.map((c) => (
              <button key={c.id} onClick={() => setCategory(c.id)} className={`py-2 rounded-lg border text-xs flex flex-col items-center gap-0.5 ${category === c.id ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-slate-200 text-ink-700'}`}>
                <PinIcon name="tag" size={28} />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            金额 ¥
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2" />
          </label>
          <label className="block text-sm font-medium">
            周期
            <select value={cycle} onChange={(e) => setCycle(e.target.value as SubCycle)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white">
              {SUB_CYCLES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        {cycle === 'custom' && (
          <label className="block text-sm font-medium">
            自定义周期（天）
            <input type="number" value={cycleDays} onChange={(e) => setCycleDays(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2" />
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">开始日期<input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
          <label className="block text-sm font-medium">结束日期<input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
        </div>
        <label className="block text-sm font-medium">下次扣款日<input type="date" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> 自动续费</label>
        <input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="支付方式，如 招行信用卡 / 微信" className="w-full border border-slate-200 rounded-lg px-3 py-2" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="退订/管理链接" className="w-full border border-slate-200 rounded-lg px-3 py-2" />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="备注" className="w-full border border-slate-200 rounded-lg px-3 py-2" />
      </div>

      <div className="flex gap-2 mt-5">
        {sub && <button onClick={markPaid} className="px-4 py-2.5 rounded-lg bg-emerald-500 text-white">本期已付</button>}
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-ink-700">取消</button>
        <button onClick={save} className="flex-1 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium">保存</button>
      </div>
    </div>
  );
}
