import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../stores/useStore';
import { Header } from '../components/Header';
import { BlobImage } from '../components/BlobImage';
import { computeItemEvents, PRESET_TAGS, subscriptionMonthlyCost } from '@home-inventory/core';
import { PinIcon } from '../components/PinIcon';

interface StatCardProps {
  icon: Parameters<typeof PinIcon>[0]['name'];
  label: string;
  value: number | string;
  from: string;
  to: string;
}

function StatCard({ icon, label, value, from, to }: StatCardProps) {
  return (
    <div
      className="rounded-2xl p-4 text-white shadow-soft"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <PinIcon name={icon} size={54} className="mb-2" />
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-90 mt-0.5">{label}</div>
    </div>
  );
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const rooms = useStore((s) => s.rooms);
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);
  const subscriptions = useStore((s) => s.subscriptions);
  const placedItems = items.filter((item) => item.status !== 'pending');
  const pendingCount = items.length - placedItems.length;
  const urgentCount = computeItemEvents(items).filter((event) => event.level === 'critical').length;
  const monthlySub = subscriptions.filter((sub) => sub.status === 'active').reduce((sum, sub) => sum + subscriptionMonthlyCost(sub), 0);
  const totalQty = placedItems.reduce((sum, item) => sum + (item.qty || 1), 0);

  const tagDist = useMemo(() => {
    const m = new Map<string, number>();
    placedItems.forEach((i) => i.tags?.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [placedItems]);

  const roomDist = useMemo(() => {
    const m = new Map<string, number>();
    placedItems.forEach((i) => m.set(i.roomId, (m.get(i.roomId) || 0) + 1));
    return Array.from(m.entries())
      .map(([rid, n]) => {
        const r = rooms.find((x) => x.id === rid);
        return { room: r, count: n };
      })
      .filter((x) => x.room)
      .sort((a, b) => b.count - a.count);
  }, [placedItems, rooms]);

  const recent = useMemo(
    () =>
      placedItems
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 12),
    [placedItems]
  );

  return (
    <div>
      <Header title="总览" subtitle="一眼看清家中库存" />

      <div className="px-4 md:px-6 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            icon="items"
            label={`物品总数 · ${totalQty} 件`}
            value={placedItems.length}
            from="#6366f1"
            to="#8b5cf6"
          />
          <StatCard
            icon="spark"
            label="紧急提醒"
            value={urgentCount}
            from="#10b981"
            to="#14b8a6"
          />
          <StatCard
            icon="inbox"
            label="待归位"
            value={pendingCount}
            from="#f59e0b"
            to="#f97316"
          />
          <StatCard
            icon="subscribe"
            label="订阅月度 ¥"
            value={monthlySub.toFixed(0)}
            from="#ec4899"
            to="#f43f5e"
          />
        </div>

        {tagDist.length > 0 && (
          <section className="mb-6">
            <h2 className="font-semibold mb-3 inline-flex items-center gap-2"><PinIcon name="tag" size={28} /> 标签分布</h2>
            <div className="bg-white rounded-2xl shadow-soft p-4 space-y-2">
              {tagDist.slice(0, 12).map(([t, n]) => {
                const pct = Math.round((n / Math.max(1, placedItems.length)) * 100);
                return (
                  <div key={t}>
                    <div className="flex justify-between text-sm">
                      <span>
                        {PRESET_TAGS.find((p) => p.name === t)?.name || t}
                      </span>
                      <span className="text-ink-500">
                        {n} · {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                      <div
                        className="h-full bg-gradient-to-r from-brand-500 to-purple-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {roomDist.length > 0 && (
          <section className="mb-6">
            <h2 className="font-semibold mb-3 inline-flex items-center gap-2"><PinIcon name="room" size={28} /> 房间分布</h2>
            <div className="bg-white rounded-2xl shadow-soft p-4 space-y-3">
              {roomDist.map(({ room, count }) => (
                <button key={room!.id} onClick={() => navigate(`/room/${room!.id}`)} className="w-full text-left">
                  <div className="flex justify-between text-sm">
                    <span>{room!.name}</span>
                    <span className="text-ink-500">{count} 件</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${Math.round((count / Math.max(1, placedItems.length)) * 100)}%` }} />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h2 className="font-semibold mb-3 inline-flex items-center gap-2"><PinIcon name="spark" size={28} /> 最近新增</h2>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {recent.map((it) => (
                <div
                  key={it.id}
                  className="bg-white rounded-xl shadow-soft p-2"
                  title={it.name}
                >
                  <BlobImage
                    blob={it.image || null}
                    emoji={it.aiEmoji || 'box'}
                    className="w-full aspect-square rounded-lg object-cover"
                  />
                  <div className="text-xs font-medium truncate mt-1">{it.name}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
