/**
 * 柜子相关辅助：判断类型、获取/创建自由区柜子。
 */
import type { Storage } from '../storage/types';
import type { Cabinet as CabinetModel } from '../models';
import { GLOBAL_ROOM_ID } from '../models';
import { uid } from '../utils/id';

export function isLooseCabinet(c?: CabinetModel | null): boolean {
  return !!c && (c.type === 'loose' || c.type === 'loose-global');
}

export async function ensureLooseCabinet(
  storage: Storage,
  roomId: string
): Promise<CabinetModel> {
  const list = await storage.byIndex('cabinets', 'roomId', roomId);
  let loose = list.find((c) => c.type === 'loose');
  if (loose) return loose;
  loose = {
    id: uid(),
    photoId: null,
    roomId,
    name: '自由物品收纳处',
    rect: { x: 0, y: 0, w: 0, h: 0 },
    type: 'loose',
    createdAt: Date.now(),
  };
  await storage.add('cabinets', loose);
  return loose;
}

export async function ensureGlobalLooseCabinet(
  storage: Storage
): Promise<CabinetModel> {
  const all = await storage.all('cabinets');
  let loose = all.find((c) => c.type === 'loose-global');
  if (loose) return loose;
  loose = {
    id: uid(),
    photoId: null,
    roomId: GLOBAL_ROOM_ID,
    name: '全屋自由区',
    rect: { x: 0, y: 0, w: 0, h: 0 },
    type: 'loose-global',
    createdAt: Date.now(),
  };
  await storage.add('cabinets', loose);
  return loose;
}
