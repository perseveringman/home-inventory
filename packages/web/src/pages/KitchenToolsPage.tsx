import { useMemo, useState } from 'react';
import {
  GLOBAL_ROOM_ID,
  isKitchenInventoryItem,
  type Cabinet,
  type Item,
  type Room,
} from '@home-inventory/core';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { ItemThumb } from '../components/ItemThumb';
import { openModal } from '../components/Modal';
import { PinIcon } from '../components/PinIcon';
import { Glyph } from '../components/Glyph';
import { useStore } from '../stores/useStore';
import ItemDialog from './modals/ItemDialog';

type ToolFilter = 'all' | 'cookware' | 'tableware' | 'cutting' | 'prep' | 'appliance';

const TOOL_GROUPS: Array<{ id: Exclude<ToolFilter, 'all'>; label: string; words: string[] }> = [
  {
    id: 'cookware',
    label: '锅具',
    words: ['锅', '炒锅', '汤锅', '平底锅', '奶锅', '蒸锅', '砂锅', '高压锅', '锅盖', '蒸屉'],
  },
  {
    id: 'tableware',
    label: '餐具',
    words: ['碗', '盘', '碟', '杯', '筷', '勺', '叉', '餐具', '饭盒', '汤匙', '调羹'],
  },
  {
    id: 'cutting',
    label: '刀板',
    words: ['刀', '菜刀', '水果刀', '剪刀', '砧板', '菜板', '削皮器', '刨丝器', '擀面杖'],
  },
  {
    id: 'prep',
    label: '烹饪工具',
    words: ['铲', '锅铲', '汤勺', '漏勺', '瓢', '夹', '打蛋器', '量杯', '滤网', '漏斗', '刷'],
  },
  {
    id: 'appliance',
    label: '小家电',
    words: ['电饭煲', '空气炸锅', '烤箱', '微波炉', '电磁炉', '料理机', '破壁机', '搅拌机', '榨汁机', '豆浆机'],
  },
];

const FILTERS: Array<{ id: ToolFilter; label: string }> = [
  { id: 'all', label: '全部' },
  ...TOOL_GROUPS.map((group) => ({ id: group.id, label: group.label })),
];

const QUICK_PRESETS = [
  { name: '炒锅', group: '锅具', note: '尺寸、材质和适用炉具可补在备注里' },
  { name: '汤锅', group: '锅具', note: '记录容量、材质和锅盖是否齐全' },
  { name: '饭碗', group: '餐具', note: '可记录套数、材质或常用位置' },
  { name: '餐盘', group: '餐具', note: '可记录尺寸、套数或备用位置' },
  { name: '筷子', group: '餐具', note: '记录套数、材质和备用数量' },
  { name: '汤勺', group: '烹饪工具', note: '记录长柄、漏勺或常用锅具' },
  { name: '锅铲', group: '烹饪工具', note: '记录材质和是否适合不粘锅' },
  { name: '菜刀', group: '刀板', note: '记录用途、品牌和保养提醒' },
  { name: '菜板', group: '刀板', note: '记录生熟分区、材质和更换提醒' },
  { name: '保鲜盒', group: '餐具', note: '记录容量、盖子数量和位置' },
];

const FOOD_TAGS = new Set(['食品', '食物', '食材', '生鲜', '蔬菜', '水果', '肉禽蛋奶', '乳制品', '主食', '零食', '饮料', '调料', '调味品', '冷冻', '剩菜']);
const CLEAR_KITCHEN_TOOL_PATTERN =
  /(炒锅|汤锅|平底锅|奶锅|蒸锅|砂锅|高压锅|锅盖|蒸屉|饭碗|餐碗|汤碗|水杯|杯子|马克杯|盘|碟|筷|餐勺|汤匙|调羹|餐具|饭盒|保鲜盒|菜刀|水果刀|厨师刀|刀具|剪刀|砧板|菜板|削皮器|刨丝器|擀面杖|锅铲|汤勺|漏勺|瓢|打蛋器|量杯|滤网|漏斗|电饭煲|空气炸锅|烤箱|微波炉|电磁炉|料理机|破壁机|搅拌机|榨汁机|豆浆机)/;
const NON_KITCHEN_TOOL_PATTERN = /(螺丝刀|美工刀|裁纸刀|工具刀|剃须刀|刮胡刀|指甲刀|扳手|锤|榔头|电钻|锯|钳|螺丝|胶带)/;

function useKitchenRoom() {
  const rooms = useStore((s) => s.rooms);
  return rooms.find((room) => room.name.includes('厨房') || room.icon === '🍳') || null;
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function matchingGroups(item: Item) {
  const text = `${item.name} ${item.note || ''}`;
  return TOOL_GROUPS.filter((group) => includesAny(text, group.words));
}

function isKitchenToolItem(item: Item, rooms: Room[], cabinets: Cabinet[]) {
  const room = rooms.find((entry) => entry.id === item.roomId);
  const cabinet = cabinets.find((entry) => entry.id === item.cabinetId);
  const inKitchen = room?.name.includes('厨房') || room?.icon === '🍳' || cabinet?.name.includes('厨') || cabinet?.name.includes('餐');
  const tags = item.tags || [];
  if (tags.includes('厨具')) return true;
  if (tags.some((tag) => FOOD_TAGS.has(tag))) return false;
  if (isKitchenInventoryItem(item, rooms, cabinets)) return false;
  const groups = matchingGroups(item);
  if (!groups.length) return false;
  const itemText = `${item.name} ${item.note || ''}`;
  if (NON_KITCHEN_TOOL_PATTERN.test(itemText)) return false;
  return !!inKitchen || tags.includes('日用') || tags.includes('家电') || CLEAR_KITCHEN_TOOL_PATTERN.test(itemText);
}

function locationText(item: Item, rooms: Room[], cabinets: Cabinet[]) {
  const room = rooms.find((entry) => entry.id === item.roomId);
  const cabinet = cabinets.find((entry) => entry.id === item.cabinetId);
  const roomName = item.roomId === GLOBAL_ROOM_ID ? '全屋' : room?.name || '未知房间';
  return cabinet?.name ? `${roomName} / ${cabinet.name}` : roomName;
}

export default function KitchenToolsPage() {
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const kitchenRoom = useKitchenRoom();
  const [filter, setFilter] = useState<ToolFilter>('all');

  const toolItems = useMemo(
    () =>
      items
        .filter((item) => item.status !== 'pending' && isKitchenToolItem(item, rooms, cabinets))
        .sort((a, b) => (b.lastTouchedAt || b.createdAt) - (a.lastTouchedAt || a.createdAt)),
    [cabinets, items, rooms]
  );

  const counts = useMemo(
    () =>
      TOOL_GROUPS.reduce<Record<string, number>>((acc, group) => {
        acc[group.id] = toolItems.filter((item) => matchingGroups(item).some((entry) => entry.id === group.id)).length;
        return acc;
      }, {}),
    [toolItems]
  );

  const filteredItems = useMemo(() => {
    if (filter === 'all') return toolItems;
    return toolItems.filter((item) => matchingGroups(item).some((group) => group.id === filter));
  }, [filter, toolItems]);

  const addTool = (preset?: (typeof QUICK_PRESETS)[number]) =>
    openModal((close) => (
      <ItemDialog
        defaultRoomId={kitchenRoom?.id || GLOBAL_ROOM_ID}
        defaultName={preset?.name}
        defaultNote={preset?.note || ''}
        defaultTags={['厨具', preset?.group].filter(Boolean) as string[]}
        onClose={close}
      />
    ));

  return (
    <div>
      <Header
        title="厨房工具"
        subtitle={`${toolItems.length} 件厨具 · 锅碗瓢盆筷子刀具菜板`}
        actions={
          <button
            onClick={() => addTool()}
            className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm inline-flex items-center gap-1"
          >
            <Glyph name="plus" size={15} strokeWidth={1.8} />
            新增
          </button>
        }
      />

      <section className="py-4 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-soft">
            <div className="text-[11px] text-ink-500">厨具</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{toolItems.length}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-soft">
            <div className="text-[11px] text-ink-500">锅具</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{counts.cookware || 0}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-soft">
            <div className="text-[11px] text-ink-500">餐具</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{counts.tableware || 0}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-100 p-3 shadow-soft">
            <div className="text-[11px] text-ink-500">刀板</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{counts.cutting || 0}</div>
          </div>
        </div>

        <div className="rounded-2xl bg-white shadow-soft border border-slate-100 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">常用厨具</h2>
              <p className="mt-1 text-xs text-ink-500">点一个条目会预填名称、位置和“厨具”标签。</p>
            </div>
            <PinIcon name="room-kitchen" size={34} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => addTool(preset)}
                className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs text-ink-700 hover:bg-white"
              >
                {preset.name}
              </button>
            ))}
          </div>
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
              {entry.id !== 'all' && counts[entry.id] ? ` ${counts[entry.id]}` : ''}
            </button>
          ))}
        </div>

        {filteredItems.length === 0 ? (
          <EmptyState
            icon="room-kitchen"
            title="还没有厨具档案"
            description="先录入炒锅、碗筷、刀具和菜板，也可以从上方常用厨具开始。"
            action={
              <button onClick={() => addTool()} className="px-4 py-2 rounded-xl bg-ink-900 text-white text-sm">
                新增厨具
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredItems.map((item) => {
              const groups = matchingGroups(item);
              return (
                <button
                  key={item.id}
                  onClick={() => openModal((close) => <ItemDialog item={item} onClose={close} />)}
                  className="text-left rounded-2xl bg-white border border-slate-100 shadow-soft p-3 hover:bg-slate-50 transition"
                >
                  <ItemThumb item={item} className="w-full aspect-square rounded-xl object-cover bg-slate-50" />
                  <div className="mt-2 flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{item.name}</span>
                    <span className="text-xs text-ink-500 tabular-nums">× {item.qty}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-500 truncate">{locationText(item, rooms, cabinets)}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(groups.length ? groups : [{ label: '厨具' }]).slice(0, 2).map((group) => (
                      <span key={group.label} className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-ink-500">
                        {group.label}
                      </span>
                    ))}
                    {item.warrantyMonths ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-brand-100 bg-brand-50 text-brand-700">
                        保修 {item.warrantyMonths} 月
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
