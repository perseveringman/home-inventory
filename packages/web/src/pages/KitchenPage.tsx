import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GLOBAL_ROOM_ID,
  compressImage,
  cropItemFromPhoto,
  ensureGlobalLooseCabinet,
  ensureLooseCabinet,
  expiryInfo,
  generateItemThumb,
  isKitchenInventoryItem,
  rankKitchenItem,
  rankKitchenItems,
  suggestKitchenImportFromImage,
  suggestKitchenToday,
  uid,
  type Cabinet,
  type Item,
  type KitchenImportDraft,
  type KitchenTodaySuggestion,
  type Room,
} from '@home-inventory/core';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { ItemThumb } from '../components/ItemThumb';
import { openModal } from '../components/Modal';
import { PinIcon } from '../components/PinIcon';
import { toast } from '../components/Toast';
import { pickImage } from '../lib/nativeImage';
import { getStorage, useStore } from '../stores/useStore';
import ItemDialog from './modals/ItemDialog';
import QuickAddDialog from './modals/QuickAddDialog';

type KitchenFilter = 'priority' | 'expiring' | 'opened' | 'lowstock' | 'all';

const FILTERS: Array<{ id: KitchenFilter; label: string }> = [
  { id: 'priority', label: '今日优先' },
  { id: 'expiring', label: '临期' },
  { id: 'opened', label: '已开封' },
  { id: 'lowstock', label: '低库存' },
  { id: 'all', label: '全部' },
];

function mergeTags(tags: string[]) {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
}

function useKitchenRoom() {
  const rooms = useStore((s) => s.rooms);
  return rooms.find((room) => room.name.includes('厨房') || room.icon === '🍳') || null;
}

function freshnessBadge(item: Item) {
  const info = expiryInfo(item.expiry);
  if (info && info.level !== 'ok') return info;
  const rank = rankKitchenItem(item);
  if (rank.openedDaysLeft != null && rank.openedDaysLeft <= 14) {
    return {
      label: rank.openedDaysLeft < 0 ? `开封超 ${-rank.openedDaysLeft} 天` : `开封还剩 ${rank.openedDaysLeft} 天`,
      cls: rank.openedDaysLeft <= 3 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  return null;
}

function locationText(item: Item, rooms: Room[], cabinets: Cabinet[]) {
  const room = rooms.find((entry) => entry.id === item.roomId);
  const cabinet = cabinets.find((entry) => entry.id === item.cabinetId);
  const roomName = item.roomId === GLOBAL_ROOM_ID ? '全屋' : room?.name || '未知房间';
  return cabinet?.name ? `${roomName} / ${cabinet.name}` : roomName;
}

function buildImportedNote(draft: KitchenImportDraft) {
  return [
    draft.note,
    draft.spec ? `规格：${draft.spec}` : '',
    draft.unit ? `单位：${draft.unit}` : '',
    draft.paidPrice != null ? `实付：¥${draft.paidPrice}` : '',
    draft.unitPrice != null ? `单价：¥${draft.unitPrice}` : '',
    draft.productionDate ? `生产日期：${draft.productionDate}` : '',
    draft.expiry ? '' : '保质期待确认',
    `截图导入${draft.confidence ? ` · ${Math.round(draft.confidence * 100)}%` : ''}`,
  ]
    .filter(Boolean)
    .join('；');
}

export default function KitchenPage() {
  const navigate = useNavigate();
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const put = useStore((s) => s.put);
  const reloadAll = useStore((s) => s.reloadAll);
  const kitchenRoom = useKitchenRoom();
  const [filter, setFilter] = useState<KitchenFilter>('priority');
  const [suggesting, setSuggesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preferences, setPreferences] = useState('');
  const [suggestion, setSuggestion] = useState<KitchenTodaySuggestion | null>(null);

  const kitchenItems = useMemo(
    () => items.filter((item) => isKitchenInventoryItem(item, rooms, cabinets)),
    [cabinets, items, rooms]
  );
  const availableItems = useMemo(
    () => kitchenItems.filter((item) => item.status !== 'pending' && Number(item.qty || 0) > 0),
    [kitchenItems]
  );
  const ranked = useMemo(() => rankKitchenItems(availableItems), [availableItems]);
  const priorityItems = useMemo(() => {
    const urgent = ranked.filter((rank) => rank.score > 0).slice(0, 8).map((rank) => rank.item);
    return urgent.length ? urgent : availableItems.slice(0, 8);
  }, [availableItems, ranked]);
  const expiringItems = useMemo(
    () =>
      availableItems
        .filter((item) => {
          const info = expiryInfo(item.expiry);
          return !!info && info.level !== 'ok';
        })
        .sort((a, b) => (expiryInfo(a.expiry)?.days || 9999) - (expiryInfo(b.expiry)?.days || 9999)),
    [availableItems]
  );
  const openedItems = useMemo(
    () => availableItems.filter((item) => item.openedAt).sort((a, b) => (b.lastTouchedAt || b.createdAt) - (a.lastTouchedAt || a.createdAt)),
    [availableItems]
  );
  const lowStockItems = useMemo(
    () => kitchenItems.filter((item) => item.minStock != null && Number(item.qty || 0) < Number(item.minStock)),
    [kitchenItems]
  );
  const pendingCount = kitchenItems.filter((item) => item.status === 'pending').length;

  const filteredItems = useMemo(() => {
    if (filter === 'priority') return priorityItems;
    if (filter === 'expiring') return expiringItems;
    if (filter === 'opened') return openedItems;
    if (filter === 'lowstock') return lowStockItems;
    return kitchenItems
      .filter((item) => item.status !== 'pending')
      .sort((a, b) => (b.lastTouchedAt || b.createdAt) - (a.lastTouchedAt || a.createdAt));
  }, [expiringItems, filter, kitchenItems, lowStockItems, openedItems, priorityItems]);

  const quickAdd = () => openModal((close) => <QuickAddDialog defaultRoomId={kitchenRoom?.id || GLOBAL_ROOM_ID} onClose={close} />);

  const importImage = async () => {
    if (importing) return;
    try {
      const file = await pickImage({ source: 'gallery' });
      if (!file) return;
      setImporting(true);
      toast('AI 正在读取订单截图…', 2500);
      const compressed = await compressImage(file, 1800, 0.86);
      const storage = getStorage();
      const drafts = await suggestKitchenImportFromImage(storage, compressed.blob);
      if (!drafts.length) {
        toast('没有识别到可导入的食材');
        return;
      }
      const target =
        kitchenRoom?.id ? await ensureLooseCabinet(storage, kitchenRoom.id) : await ensureGlobalLooseCabinet(storage);
      for (const draft of drafts) {
        const productImage = draft.imageRect
          ? await cropItemFromPhoto(compressed.blob, draft.imageRect, 320)
          : null;
        const image = productImage || (await generateItemThumb(draft.name));
        const item: Item = {
          id: uid(),
          cabinetId: target.id,
          roomId: target.roomId,
          name: draft.name,
          qty: draft.qty,
          note: buildImportedNote(draft),
          tags: mergeTags(draft.tags.length ? draft.tags : ['食品']),
          image,
          expiry: draft.expiry,
          status: 'placed',
          source: 'ai',
          openedShelfDays: draft.openedShelfDays ?? null,
          purchasedAt: new Date().toISOString().slice(0, 10),
          purchasePrice: draft.paidPrice ?? null,
          minStock: draft.minStock ?? null,
          receiptNote: [
            draft.spec ? `规格 ${draft.spec}` : '',
            draft.unitPrice != null ? `单价 ¥${draft.unitPrice}` : '',
            draft.productionDate ? `生产日期 ${draft.productionDate}` : '',
          ]
            .filter(Boolean)
            .join('；') || undefined,
          createdAt: Date.now(),
          lastTouchedAt: Date.now(),
          confidence: draft.confidence,
          reviewStatus: 'edited',
          aiReason: '厨房截图导入',
        };
        await storage.add('items', item);
      }
      await reloadAll();
      toast(`已导入 ${drafts.length} 项厨房物品`);
    } catch (err: any) {
      console.error(err);
      toast(err?.message || '厨房截图导入失败', 3200);
    } finally {
      setImporting(false);
    }
  };

  const askAI = async () => {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const result = await suggestKitchenToday(getStorage(), {
        items: availableItems,
        rooms,
        cabinets,
        preferences,
        today: new Date().toISOString().slice(0, 10),
      });
      setSuggestion(result);
      toast(result.mode === 'ai' ? '今日建议已生成' : '已用本地规则生成建议');
    } catch (err: any) {
      toast(err?.message || '今日建议生成失败', 3200);
    } finally {
      setSuggesting(false);
    }
  };

  const consumeOne = async (item: Item) => {
    const nextQty = Math.max(0, Number(item.qty || 0) - 1);
    await put('items', { ...item, qty: nextQty, lastTouchedAt: Date.now() });
    toast(nextQty > 0 ? `已用掉 1 份，还剩 ${nextQty}` : '已标记用完');
  };

  const markOpened = async (item: Item) => {
    await put('items', {
      ...item,
      openedAt: item.openedAt || new Date().toISOString().slice(0, 10),
      openedShelfDays: item.openedShelfDays || 7,
      lastTouchedAt: Date.now(),
    });
    toast('已标记开封');
  };

  const openItem = (item: Item) => openModal((close) => <ItemDialog item={item} onClose={close} />);

  return (
    <div>
      <Header
        title="厨房食材"
        subtitle={`${availableItems.length} 项可用食材${pendingCount ? ` · ${pendingCount} 项待完善` : ''}`}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/kitchen/tools')}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-100 text-ink-700 text-sm inline-flex items-center gap-1"
            >
              <PinIcon name="cabinet" size={18} tile={false} />
              厨具
            </button>
            <button
              onClick={importImage}
              disabled={importing}
              className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm inline-flex items-center gap-1 disabled:bg-ink-300"
            >
              <PinIcon name="gallery" size={18} tile={false} />
              {importing ? '识别中' : '相册'}
            </button>
            <button
              onClick={quickAdd}
              className="px-3 py-1.5 rounded-lg bg-slate-100 text-ink-700 text-sm inline-flex items-center gap-1"
            >
              <PinIcon name="edit" size={18} tile={false} />
              手动填
            </button>
          </div>
        }
      />

      <section className="py-4 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-soft">
            <div className="text-[11px] text-ink-500">临期</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{expiringItems.length}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-soft">
            <div className="text-[11px] text-ink-500">已开封</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{openedItems.length}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-soft">
            <div className="text-[11px] text-ink-500">低库存</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{lowStockItems.length}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-soft">
            <div className="text-[11px] text-ink-500">可用</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{availableItems.length}</div>
          </div>
        </div>

        <div className="rounded-2xl bg-white shadow-soft border border-slate-100 p-4">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1">
              <h2 className="text-base font-semibold">今日吃什么</h2>
              <p className="mt-1 text-xs text-ink-500">基于当前库存、保质期和开封状态，只推荐今日食材和菜名。</p>
              <input
                value={preferences}
                onChange={(event) => setPreferences(event.target.value)}
                placeholder="可选：想吃清淡、10 分钟内、不要辣..."
                className="mt-3 w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:bg-white focus:border-brand-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={askAI}
                disabled={suggesting || availableItems.length === 0}
                className="px-4 py-2 rounded-xl bg-ink-900 text-white text-sm inline-flex items-center gap-1.5 disabled:bg-ink-300"
              >
                <PinIcon name="spark" size={18} tile={false} />
                {suggesting ? '生成中' : 'AI 推荐'}
              </button>
            </div>
          </div>

          {suggestion && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="text-sm font-medium">{suggestion.summary}</div>
              {suggestion.ingredientNames.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {suggestion.ingredientNames.map((name) => (
                    <span key={name} className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 text-xs">
                      {name}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 grid md:grid-cols-2 gap-2.5">
                {suggestion.dishes.map((dish) => (
                  <button
                    key={dish.name}
                    onClick={() => {
                      const item = availableItems.find((entry) => dish.focusItemIds.includes(entry.id));
                      if (item) openItem(item);
                    }}
                    className="text-left rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-white hover:shadow-soft transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold truncate">{dish.name}</div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-ink-500">{Math.round(dish.confidence * 100)}%</span>
                    </div>
                    <div className="mt-1 text-xs text-ink-500">{dish.reason}</div>
                    <div className="mt-2 text-[11px] text-ink-500">
                      用：{dish.focusItems.join('、') || '当前库存'}
                      {dish.missingItems.length > 0 ? ` · 缺：${dish.missingItems.join('、')}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="pb-6">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setFilter(entry.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                filter === entry.id ? 'bg-brand-500 text-white' : 'bg-white text-ink-600 border border-slate-100'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {filteredItems.length === 0 ? (
          <EmptyState icon="room-kitchen" title="还没有厨房库存" description="先用截图、拍照或手动录入几样食材。" />
        ) : (
          <div className="space-y-2.5">
            {filteredItems.map((item) => {
              const badge = freshnessBadge(item);
              const rank = rankKitchenItem(item);
              return (
                <div key={item.id} className="rounded-2xl bg-white border border-slate-100 shadow-soft p-3 flex gap-3">
                  <button onClick={() => openItem(item)} className="shrink-0">
                    <ItemThumb item={item} className="w-16 h-16 rounded-xl object-cover" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <button onClick={() => openItem(item)} className="block w-full text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold truncate">{item.name}</span>
                        <span className="text-xs text-ink-500 tabular-nums">× {item.qty}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-500 truncate">{locationText(item, rooms, cabinets)}</div>
                    </button>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>}
                      {rank.signals.slice(0, 2).map((signal) => (
                        <span key={signal} className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-ink-500">
                          {signal}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => consumeOne(item)} className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs">
                        用掉一份
                      </button>
                      {!item.openedAt && (
                        <button onClick={() => markOpened(item)} className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs">
                          标记开封
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
