import type { Label, LabelTargetType } from '../models';
import { DEFAULT_HOME_ID } from '../models';
import type { Storage } from '../storage/types';
import { uid } from '../utils/id';
import { logAction } from './actionLog';

const LABEL_URL_PREFIX = 'https://home-inventory.local/l/';
const LABEL_SCHEME_PREFIX = 'home-inventory://label/';

function normalizeCode(raw: string): string {
  return raw.trim().replace(/^.*\/l\//, '').replace(/^home-inventory:\/\/label\//, '');
}

export function makeLabelCode(): string {
  return `hi_${uid().replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
}

export function labelToQrText(label: Pick<Label, 'code'>, mode: 'url' | 'scheme' = 'url'): string {
  return mode === 'scheme' ? `${LABEL_SCHEME_PREFIX}${label.code}` : `${LABEL_URL_PREFIX}${label.code}`;
}

export function parseLabelCode(input: string): string {
  const text = input.trim();
  if (!text) return '';
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return normalizeCode(String(parsed.code || parsed.labelId || parsed.id || ''));
    } catch {
      return '';
    }
  }
  return normalizeCode(text);
}

export async function createLabel(
  storage: Storage,
  input: {
    targetType?: LabelTargetType;
    targetId?: string;
    labelNo?: string;
  } = {}
): Promise<Label> {
  const label: Label = {
    id: uid(),
    homeId: storage.homeId || DEFAULT_HOME_ID,
    code: makeLabelCode(),
    targetType: input.targetType,
    targetId: input.targetId,
    labelNo: input.labelNo,
    status: input.targetId ? 'linked' : 'unclaimed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await storage.put('labels', label);
  await logAction(storage, {
    source: 'user',
    type: 'label_created',
    summary: input.targetId ? '创建并绑定二维码标签' : '创建未绑定二维码标签',
    targetType: 'label',
    targetId: label.id,
    after: label,
  });
  return label;
}

export async function linkLabel(
  storage: Storage,
  labelIdOrCode: string,
  targetType: LabelTargetType,
  targetId: string
): Promise<Label> {
  const labels = await storage.all('labels');
  const code = parseLabelCode(labelIdOrCode);
  const label = labels.find((item) => item.id === labelIdOrCode || item.code === code);
  if (!label) throw new Error('标签不存在');
  const next: Label = {
    ...label,
    targetType,
    targetId,
    status: 'linked',
    updatedAt: Date.now(),
  };
  await storage.put('labels', next);
  await logAction(storage, {
    source: 'user',
    type: 'label_linked',
    summary: '绑定二维码标签',
    targetType,
    targetId,
    before: label,
    after: next,
  });
  return next;
}

export async function resolveLabel(storage: Storage, scannedText: string): Promise<Label | undefined> {
  const code = parseLabelCode(scannedText);
  if (!code) return undefined;
  const labels = await storage.byIndex('labels', 'code', code).catch(async () => []);
  return labels[0] || (await storage.all('labels')).find((label) => label.code === code);
}
