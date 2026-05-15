import type { ActionLog, ActionLogSource, ID } from '../models';
import type { Storage } from '../storage/types';
import { uid } from '../utils/id';

interface LogInput {
  source: ActionLogSource;
  type: string;
  summary: string;
  targetType?: string;
  targetId?: ID;
  before?: unknown;
  after?: unknown;
}

export async function logAction(storage: Storage, input: LogInput): Promise<ActionLog> {
  const entry: ActionLog = {
    id: uid(),
    createdAt: Date.now(),
    ...input,
  };
  await storage.put('actionLogs', entry);
  return entry;
}
