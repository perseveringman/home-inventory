import {
  exportPayload,
  importPayload,
  type ExportPayload,
  type Home,
  type Storage,
} from '@home-inventory/core';

const TOKEN_PREFIX = 'home-inventory:cloud-token:';

export interface CloudStatus {
  blobConfigured: boolean;
  mediaSync: boolean;
  snapshotMediaMode: 'none' | 'inline';
}

export interface CloudShareResult {
  homeId: string;
  homeName: string;
  inviteCode?: string;
  accessToken?: string;
  snapshotUpdatedAt?: string;
}

export interface CloudSnapshotResult {
  homeId: string;
  homeName: string;
  accessToken?: string;
  snapshotUpdatedAt?: string;
  snapshot: ExportPayload;
}

function tokenKey(homeId: string) {
  return `${TOKEN_PREFIX}${homeId}`;
}

export function getCloudToken(homeId: string): string {
  return localStorage.getItem(tokenKey(homeId)) || '';
}

export function saveCloudToken(homeId: string, token: string): void {
  if (token) localStorage.setItem(tokenKey(homeId), token);
}

async function cloudFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Cloud request failed: ${response.status}`);
  }
  return data as T;
}

export async function fetchCloudStatus(): Promise<CloudStatus> {
  return cloudFetch<CloudStatus>('/api/cloud/status');
}

export async function buildCloudSnapshot(storage: Storage): Promise<ExportPayload> {
  return exportPayload(storage, { media: 'none' });
}

export async function shareCloudHome(storage: Storage, home: Home): Promise<CloudShareResult> {
  const snapshot = await buildCloudSnapshot(storage);
  const result = await cloudFetch<CloudShareResult>('/api/cloud/share', {
    method: 'POST',
    body: JSON.stringify({
      homeId: home.id,
      homeName: home.name,
      accessToken: getCloudToken(home.id),
      snapshot,
    }),
  });
  if (result.accessToken) saveCloudToken(result.homeId, result.accessToken);
  return result;
}

export async function pushCloudSnapshot(storage: Storage, home: Home): Promise<CloudShareResult> {
  const accessToken = getCloudToken(home.id);
  if (!accessToken) throw new Error('本机还没有这个 home 的云端访问令牌，请先生成或加入邀请码');
  const snapshot = await buildCloudSnapshot(storage);
  return cloudFetch<CloudShareResult>('/api/cloud/snapshot', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      homeId: home.id,
      homeName: home.name,
      snapshot,
    }),
  });
}

export async function pullCloudSnapshot(homeId: string): Promise<CloudSnapshotResult> {
  const accessToken = getCloudToken(homeId);
  if (!accessToken) throw new Error('本机还没有这个 home 的云端访问令牌，请先生成或加入邀请码');
  return cloudFetch<CloudSnapshotResult>(`/api/cloud/snapshot?homeId=${encodeURIComponent(homeId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function joinCloudHome(
  homeId: string,
  inviteCode: string
): Promise<CloudSnapshotResult> {
  const result = await cloudFetch<CloudSnapshotResult>('/api/cloud/join', {
    method: 'POST',
    body: JSON.stringify({ homeId, inviteCode }),
  });
  if (result.accessToken) saveCloudToken(result.homeId, result.accessToken);
  return result;
}

export async function importCloudSnapshot(
  storage: Storage,
  snapshot: ExportPayload,
  preserveMedia: boolean
): Promise<void> {
  await importPayload(storage, {
    ...snapshot,
    version: 3,
  }, {
    replace: true,
    preserveIds: true,
    preserveMedia,
  });
}
