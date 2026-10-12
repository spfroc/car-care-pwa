import { getDB } from '../db';
import { nowISO, uid } from '../lib/constants';
import { dedupeOutbox } from './merge';
import {
  MAX_OUTBOX_ATTEMPTS,
  type SyncConflict,
  type SyncEntity,
  type SyncMetaState,
  type SyncOpKind,
  type SyncOutboxItem,
  type SyncStatus,
} from './types';
import { getCloudStorageConfig } from './config';

const META_KEY = 'syncMeta';
const CONFLICTS_KEY = 'syncConflicts';

export function nextRetryDelayMs(attempts: number): number {
  const capped = Math.min(2 ** attempts, 64);
  const base = capped * 30_000;
  const jitter = Math.floor(Math.random() * 5_000);
  return base + jitter;
}

export async function ensureDeviceId(): Promise<string> {
  const meta = await getSyncMeta();
  if (meta.deviceId) return meta.deviceId;
  const deviceId = uid();
  await putSyncMeta({ ...meta, deviceId });
  return deviceId;
}

export async function getSyncMeta(): Promise<SyncMetaState> {
  const db = await getDB();
  const row = await db.get('sync_meta', META_KEY);
  if (row?.value && typeof row.value === 'object') {
    return row.value as SyncMetaState;
  }
  return {
    deviceId: '',
    status: 'disconnected',
    provider: 'none',
  };
}

export async function putSyncMeta(state: SyncMetaState): Promise<void> {
  const db = await getDB();
  await db.put('sync_meta', { key: META_KEY, value: state });
}

export async function patchSyncMeta(patch: Partial<SyncMetaState>): Promise<SyncMetaState> {
  const cur = await getSyncMeta();
  const next = { ...cur, ...patch };
  if (!next.deviceId) next.deviceId = cur.deviceId || uid();
  await putSyncMeta(next);
  return next;
}

export async function setSyncStatus(status: SyncStatus, lastError?: string): Promise<void> {
  await patchSyncMeta({
    status,
    ...(lastError !== undefined
      ? { lastError }
      : status === 'idle' || status === 'disconnected'
        ? { lastError: undefined }
        : {}),
  });
}

export async function listOutbox(): Promise<SyncOutboxItem[]> {
  const db = await getDB();
  return (await db.getAll('sync_outbox')) as SyncOutboxItem[];
}

export async function listReadyOutbox(now = nowISO()): Promise<SyncOutboxItem[]> {
  const all = await listOutbox();
  return dedupeOutbox(
    all.filter((o) => o.attempts < MAX_OUTBOX_ATTEMPTS && o.nextRetryAt <= now),
  );
}

export async function putOutboxItem(item: SyncOutboxItem): Promise<void> {
  const db = await getDB();
  await db.put('sync_outbox', item as SyncOutboxItem & { entity: string; op: string });
}

export async function removeOutboxItems(opIds: string[]): Promise<void> {
  if (!opIds.length) return;
  const db = await getDB();
  const tx = db.transaction('sync_outbox', 'readwrite');
  for (const id of opIds) await tx.store.delete(id);
  await tx.done;
}

export async function clearOutbox(): Promise<void> {
  const db = await getDB();
  await db.clear('sync_outbox');
}

export async function markOutboxFailure(opId: string, error: string): Promise<void> {
  const db = await getDB();
  const raw = await db.get('sync_outbox', opId);
  if (!raw) return;
  const item = raw as SyncOutboxItem;
  const attempts = item.attempts + 1;
  const next: SyncOutboxItem = {
    ...item,
    attempts,
    lastError: error,
    nextRetryAt: new Date(Date.now() + nextRetryDelayMs(attempts)).toISOString(),
  };
  await db.put('sync_outbox', next);
}

export async function enqueueSyncOp(input: {
  entity: SyncEntity;
  entityId: string;
  op: SyncOpKind;
  payload?: unknown;
  mutatedAt?: string;
}): Promise<void> {
  const cfg = await getCloudStorageConfig();
  if (cfg.provider === 'none' || cfg.provider === 'notion') return;
  // Only enqueue when supabase is configured (connected or credentials saved)
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  const mutatedAt = input.mutatedAt ?? nowISO();
  const item: SyncOutboxItem = {
    opId: uid(),
    entity: input.entity,
    entityId: input.entityId,
    op: input.op,
    payload: input.payload,
    mutatedAt,
    attempts: 0,
    nextRetryAt: mutatedAt,
  };
  await putOutboxItem(item);
}

export async function listConflicts(): Promise<SyncConflict[]> {
  const db = await getDB();
  const row = await db.get('sync_meta', CONFLICTS_KEY);
  if (Array.isArray(row?.value)) return row.value as SyncConflict[];
  return [];
}

export async function appendConflicts(extra: SyncConflict[]): Promise<void> {
  if (!extra.length) return;
  const cur = await listConflicts();
  const next = [...cur, ...extra].slice(-50);
  const db = await getDB();
  await db.put('sync_meta', { key: CONFLICTS_KEY, value: next });
}

export async function clearConflicts(): Promise<void> {
  const db = await getDB();
  await db.put('sync_meta', { key: CONFLICTS_KEY, value: [] });
}
