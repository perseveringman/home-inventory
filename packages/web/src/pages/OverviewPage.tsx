import { useMemo } from 'react';
import { useStore } from '../stores/useStore';
import { Header } from '../components/Header';
import { BlobImage } from '../components/BlobImage';
import { PRESET_TAGS } from '@home-inventory/core';

interface StatCardProps {
  icon: string;
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
      <div className="text-2xl mb-1 opacity-90">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-90 mt-0.5">{label}</div>
    </div>
  );
}

export default function OverviewPage() {
  const rooms = useStore((s) => s.rooms);
  const items = useStore((s) => s.items);
  const cabinets = useStore((s) => s.cabinets);

  const tagDist = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => i.tags?.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const roomDist = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => m.set(i.roomId, (m.get(i.roomId) || 0) + 1));
    return Array.from(m.entries())
      .map(([rid, n]) => {
        const r = rooms.find((x) => x.id === rid);
        return { room: r, count: n };
      })
      .filter((x) => x.room)
      .sort((a, b) => b.count - a.count);
  }, [items, rooms]);

  const recent = useMemo(
    () =>
      items
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 12),
    [items]
  );

  const tagEmoji = (t: string) =>
    PRESET_TAGS.find((p) => p.name === t)?.emoji || '🏷️';

  return (
    <div>
      <Header title="📊 总览" subtitle="一眼看清家中库存" />

      <div className="px-4 md:px-6 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            icon="📦"
            label="物品总数"
            value={items.length}
            from="#6366f1"
            to="#8b5cf6"
          />
          <StatCard
            icon="🏠"
            label="房间数"
            value={rooms.length}
            from="#10b981"
            to="#14b8a6"
          />
          <StatCard
            icon="🗄️"
            label="柜子数"
            value={cabinets.length}
            from="#f59e0b"
            to="#f97316"
          />
          <StatCard
            icon="🏷️"
            label="标签种类"
            value={tagDist.length}
            from="#ec4899"
            to="#f43f5e"
          />
        </div>

        {tagDist.length > 0 && (
          <section className="mb-6">
            <h2 className="font-semibold mb-3">🏷️ 标签分布</h2>
            <div className="bg-white rounded-2xl shadow-soft p-4 space-y-2">
              {tagDist.slice(0, 12).map(([t, n]) => {
                const pct = Math.round((n / items.length) * 100);
                return (
                  <div key={t}>
                    <div className="flex justify-between text-sm">
                      <span>
                        {tagEmoji(t)} {t}
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
            <h2 className="font-semibold mb-3">🏠 房间分布</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {roomDist.map(({ room, count }) => (
                <div key={room!.id} className="bg-white rounded-2xl shadow-soft p-4">
                  <div className="text-3xl mb-1">{room!.icon}</div>
                  <div className="font-medium">{room!.name}</div>
                  <div className="text-sm text-ink-500">{count} 件物品</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h2 className="font-semibold mb-3">🆕 最近新增</h2>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {recent.map((it) => (
                <div
                  key={it.id}
                  className="bg-white rounded-xl shadow-soft p-2"
                  title={it.name}
                >
                  <BlobImage
                    blob={it.image || null}
                    emoji={it.aiEmoji || '📦'}
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
