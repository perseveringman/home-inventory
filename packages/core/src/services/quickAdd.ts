import type { Cabinet, Item, Photo } from '../models';
import { GLOBAL_ROOM_ID } from '../models';
import type { Storage } from '../storage/types';
import { cropItemFromPhoto, generateItemThumb } from '../utils/image';
import { uid } from '../utils/id';
import { detectCabinetsAndItems, type DetectConfig } from './ai';
import { ensureGlobalLooseCabinet, ensureLooseCabinet } from './cabinet';

export interface ParsedQuickAddLine {
  name: string;
  qty: number;
  note: string;
}

export function parseQuickAddLine(line: string): ParsedQuickAddLine | null {
  let name = line.trim();
  if (!name) return null;
  let note = '';
  let qty = 1;
  const commaIdx = name.search(/[,，]/);
  if (commaIdx >= 0) {
    note = name.slice(commaIdx + 1).trim();
    name = name.slice(0, commaIdx).trim();
  }
  const qtyMatch = name.match(/^(.+?)\s*[×xX*]\s*(\d+)\s*$/);
  if (qtyMatch) {
    name = qtyMatch[1]!.trim();
    qty = Math.max(1, Number.parseInt(qtyMatch[2]!, 10) || 1);
  }
  return name ? { name, qty, note } : null;
}

export function parseQuickAddText(text: string): ParsedQuickAddLine[] {
  return text
    .split('\n')
    .map(parseQuickAddLine)
    .filter((line): line is ParsedQuickAddLine => !!line);
}

export async function resolveTargetCabinet(
  storage: Storage,
  choice: string,
  roomId?: string
): Promise<Cabinet | undefined> {
  if (choice === '__global_loose__' || roomId === GLOBAL_ROOM_ID) {
    return ensureGlobalLooseCabinet(storage);
  }
  if (choice === '__room_loose__' && roomId) {
    return ensureLooseCabinet(storage, roomId);
  }
  return choice ? storage.get('cabinets', choice) : undefined;
}

export async function addQuickItems(
  storage: Storage,
  lines: ParsedQuickAddLine[],
  targetCabinet: Cabinet,
  expiry = ''
): Promise<Item[]> {
  const added: Item[] = [];
  for (const line of lines) {
    const image = await generateItemThumb(line.name);
    const item: Item = {
      id: uid(),
      cabinetId: targetCabinet.id,
      roomId: targetCabinet.roomId,
      name: line.name,
      qty: line.qty,
      note: line.note,
      tags: [],
      image,
      expiry: expiry || undefined,
      status: 'placed',
      source: 'manual',
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
    };
    await storage.add('items', item);
    added.push(item);
  }
  return added;
}

export async function scanLooseItemsFromPhoto(
  storage: Storage,
  photoBlob: Blob,
  size: { width: number; height: number },
  cfg: DetectConfig,
  targetRoomId?: string | null,
  sourcePhoto?: Photo | null
): Promise<Item[]> {
  const targetCabinet = targetRoomId
    ? await ensureLooseCabinet(storage, targetRoomId)
    : await ensureGlobalLooseCabinet(storage);
  const result = await detectCabinetsAndItems(photoBlob, size, cfg);
  const added: Item[] = [];
  for (const box of result.items) {
    const crop = await cropItemFromPhoto(photoBlob, box.rect);
    const image = crop || (await generateItemThumb(box.name, box.emoji || 'box'));
    const item: Item = {
      id: uid(),
      cabinetId: targetCabinet.id,
      roomId: targetCabinet.roomId,
      name: box.name,
      qty: 1,
      note: '',
      tags: [],
      image,
      status: 'pending',
      source: 'ai',
      sourcePhotoId: sourcePhoto?.id || null,
      aiEmoji: box.emoji,
      aiRect: box.rect,
      createdAt: Date.now(),
    };
    await storage.add('items', item);
    added.push(item);
  }
  return added;
}
