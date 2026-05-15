import type { Item } from '../models';
import type { Storage } from '../storage/types';
import { ensureGlobalLooseCabinet, ensureLooseCabinet } from './cabinet';
import { createLabel } from './labels';
import { logAction } from './actionLog';

export type InventoryAction =
  | { type: 'renameCabinet'; cabinetId: string; newName: string }
  | { type: 'moveItems'; itemIds: string[]; targetCabinetId: string; targetRoomId?: string }
  | { type: 'tagItems'; itemIds: string[]; tags: string[]; mode?: 'replace' | 'append' }
  | { type: 'updateItems'; itemIds: string[]; patch: Partial<Item> }
  | { type: 'createLabels'; targetType: 'room' | 'cabinet' | 'item'; targetIds: string[] };

export interface InventoryActionPlan {
  summary: string;
  actions: InventoryAction[];
}

export function extractInventoryActionPlan(text: string): InventoryActionPlan | null {
  const match = text.match(/```inventory_actions\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!.trim()) as InventoryActionPlan;
    if (!parsed || !Array.isArray(parsed.actions)) return null;
    return {
      summary: String(parsed.summary || `准备执行 ${parsed.actions.length} 项操作`),
      actions: parsed.actions.slice(0, 20),
    };
  } catch {
    return null;
  }
}

export function stripInventoryActionBlock(text: string): string {
  return text.replace(/```inventory_actions\s*[\s\S]*?```/gi, '').trim();
}

export function describeInventoryAction(action: InventoryAction): string {
  switch (action.type) {
    case 'renameCabinet':
      return `重命名柜子为「${action.newName}」`;
    case 'moveItems':
      return `移动 ${action.itemIds.length} 件物品`;
    case 'tagItems':
      return `${action.mode === 'replace' ? '替换' : '追加'} ${action.itemIds.length} 件物品标签：${action.tags.join('、')}`;
    case 'updateItems':
      return `更新 ${action.itemIds.length} 件物品属性`;
    case 'createLabels':
      return `为 ${action.targetIds.length} 个对象创建二维码标签`;
    default:
      return '未知操作';
  }
}

async function resolveTargetCabinet(storage: Storage, cabinetId: string, roomId?: string) {
  if (cabinetId === '__global_loose__') return ensureGlobalLooseCabinet(storage);
  if (cabinetId === '__room_loose__') {
    if (!roomId) throw new Error('移动到房间自由区需要 roomId');
    return ensureLooseCabinet(storage, roomId);
  }
  return storage.get('cabinets', cabinetId);
}

export async function applyInventoryActionPlan(
  storage: Storage,
  plan: InventoryActionPlan
): Promise<number> {
  let applied = 0;
  for (const action of plan.actions) {
    if (action.type === 'renameCabinet') {
      const cabinet = await storage.get('cabinets', action.cabinetId);
      if (!cabinet) continue;
      await storage.put('cabinets', { ...cabinet, name: action.newName });
      applied += 1;
      continue;
    }

    if (action.type === 'moveItems') {
      const cabinet = await resolveTargetCabinet(storage, action.targetCabinetId, action.targetRoomId);
      if (!cabinet) continue;
      if (cabinet.type === 'loose' || cabinet.type === 'loose-global') await storage.put('cabinets', cabinet);
      for (const itemId of action.itemIds) {
        const item = await storage.get('items', itemId);
        if (!item) continue;
        await storage.put('items', {
          ...item,
          cabinetId: cabinet.id,
          roomId: cabinet.roomId,
          status: 'placed',
          reviewStatus: 'accepted',
          lastTouchedAt: Date.now(),
        });
        applied += 1;
      }
      continue;
    }

    if (action.type === 'tagItems') {
      for (const itemId of action.itemIds) {
        const item = await storage.get('items', itemId);
        if (!item) continue;
        const tags =
          action.mode === 'replace'
            ? action.tags
            : Array.from(new Set([...(item.tags || []), ...action.tags]));
        await storage.put('items', { ...item, tags, lastTouchedAt: Date.now() });
        applied += 1;
      }
      continue;
    }

    if (action.type === 'updateItems') {
      for (const itemId of action.itemIds) {
        const item = await storage.get('items', itemId);
        if (!item) continue;
        await storage.put('items', { ...item, ...action.patch, lastTouchedAt: Date.now() });
        applied += 1;
      }
      continue;
    }

    if (action.type === 'createLabels') {
      for (const targetId of action.targetIds) {
        await createLabel(storage, { targetType: action.targetType, targetId });
        applied += 1;
      }
    }
  }

  if (applied) {
    await logAction(storage, {
      source: 'ai',
      type: 'inventory_action_plan_applied',
      summary: `${plan.summary}：已应用 ${applied} 项变更`,
      after: plan,
    });
  }
  return applied;
}
