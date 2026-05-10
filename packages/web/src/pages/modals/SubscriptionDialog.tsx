import { useState } from 'react';
import {
  SUB_CATEGORIES,
  SUB_CYCLES,
  uid,
  type SubCategory,
  type SubCycle,
  type Subscription,
} from '@home-inventory/core';
import { useStore } from '../../stores/useStore';
import { toast } from '../../components/Toast';

interface Props {
  sub?: Subscription;
  onClose: () => void;
}

export default function SubscriptionDialog({ sub, onClose }: Props) {
  const put = useStore((s) => s.put);
  const [name, setName] = useState(sub?.name || '');
  const [category, setCategory] = useState<SubCategory>(sub?.category || 'software');
  const [amount, setAmount] = useState(sub?.amount != null ? String(sub.amount) : '');
  const [cycle, setCycle] = useState<SubCycle>(sub?.cycle || 'monthly');
  const [cycleDays, setCycleDays] = useState(
    sub?.cycleDays ? String(sub.cycleDays) : '30'
  );
  const [nextDueAt, setNextDueAt] = useState(sub?.nextDueAt || '');
  const [paymentMethod, setPaymentMethod] = useState(sub?.paymentMethod || '');
  const [url, setUrl] = useState(sub?.url || '');
  const [note, setNote] = useState(sub?.note || '');

  const save = async () => {
    const n = name.trim();
    if (!n) {
      toast('请输入名称');
      return;
    }
    const obj: Subscription = {
      id: sub?.id || uid(),
      name: n,
      category,
      amount: +amount || 0,
      cycle,
      cycleDays: cycle === 'custom' ? +cycleDays || 30 : undefined,
      nextDueAt: nextDueAt || undefined,
      paymentMethod: paymentMethod.trim() || undefined,
      url: url.trim() || undefined,
      note: note.trim() || undefined,
      status: sub?.status || 'active',
      createdAt: sub?.createdAt || Date.now(),
      lastPaidAt: sub?.lastPaidAt,
    };
    await put('subscriptions', obj);
    toast(sub ? '已更新' : '已添加');
    onClose();
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{sub ? '编辑订阅' : '新增订阅'}</h3>
        <button onClick={onClose} className="text-ink-500 text-xl">
          ×
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如 Netflix"
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">类型</label>
          <div className="grid grid-cols-4 gap-2">
            {SUB_CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`py-2 rounded-lg border text-xs flex flex-col items-center gap-0.5 ${
                  category === c.id
                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                    : 'border-slate-200 text-ink-700'
                }`}
              >
                <span className="text-lg">{c.emoji}</span>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">金额 ¥</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">周期</label>
            <select
              value={cycle}
              onChange={(e) => setCycle(e.target.value as SubCycle)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              {SUB_CYCLES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {cycle === 'custom' && (
          <div>
            <label className="block text-sm font-medium mb-1">自定义周期（天）</label>
            <input
              type="number"
              value={cycleDays}
              onChange={(e) => setCycleDays(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">下次扣款日</label>
          <input
            type="date"
            value={nextDueAt}
            onChange={(e) => setNextDueAt(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">支付方式</label>
          <input
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            placeholder="如 招行信用卡 / 微信"
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">官方入口 URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="退订/管理链接"
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">备注</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />
        </div>
      </div>

      <div className="flex gap-2 mt-5">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 rounded-lg border border-slate-200 text-ink-700"
        >
          取消
        </button>
        <button
          onClick={save}
          className="flex-1 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium"
        >
          保存
        </button>
      </div>
    </div>
  );
}
