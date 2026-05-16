import type { ActionLog, ActionLogSource, ID } from '../models';
import { DEFAULT_HOME_ID } from '../models';
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
    homeId: storage.homeId || DEFAULT_HOME_ID,
    createdAt: Date.now(),
    ...input,
  };
  await storage.put('actionLogs', entry);
  return entry;
}
