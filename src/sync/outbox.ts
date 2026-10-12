import { getDB } from '../db';
import { nowISO, uid } from '../lib/constants';
import { getCloudStorageConfig } from './config';
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

const META_KEY = 'syncMeta';
const CONFLICTS_KEY = 'syncConflicts';

export function nextRetryDelayMs(attempts: number): number {
  const capped = Math.min(2 ** attempts, 64);
  const base = capped * 30_000;
  const jitter = Math.floor(Math.random() * 5_000);
  return base + jitter;
}

export async function isCloudEnqueueEnabled(): Promise<boolean> {
  const cfg = await getCloudStorageConfig();
  if (cfg.provider !== 'supabase') return false;
  return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
}

export function makeOutboxItem(input: {
  entity: SyncEntity;
  entityId: string;
  op: SyncOpKind;
  payload?: unknown;
  mutatedAt?: string;
}): SyncOutboxItem {
  const mutatedAt = input.mutatedAt ?? nowISO();
  return {
    opId: uid(),
    entity: input.entity,
    entityId: input.entityId,
    op: input.op,
    payload: input.payload,
    mutatedAt,
    attempts: 0,
    nextRetryAt: mutatedAt,
  };
}

/** Put outbox row inside an existing readwrite transaction (same atomic unit as business write). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function putOutboxInTx(tx: any, item: SyncOutboxItem): Promise<void> {
  await tx.objectStore('sync_outbox').put(item);
}

/** Ensure mid-tx throw aborts and rolls back (incl. fake-indexeddb). */
export async function settleTx(
  tx: { abort: () => void; done: Promise<void> },
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
    await tx.done;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* already aborting */
    }
    try {
      await tx.done;
    } catch {
      /* expected after abort */
    }
    throw e;
  }
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

/**
 * After a successful snapshot upload, remove only outbox ops covered by uploaded rows
 * (same entity+id and mutatedAt <= uploaded updatedAt). Newer ops enqueued during upload stay.
 */
export async function ackOutboxCoveredByUpload(
  uploaded: Array<{ entity: SyncEntity | string; id: string; updatedAt: string }>,
): Promise<number> {
  const covered = new Map<string, string>();
  for (const u of uploaded) {
    const key = `${u.entity}:${u.id}`;
    const prev = covered.get(key);
    if (!prev || u.updatedAt > prev) covered.set(key, u.updatedAt);
  }
  const all = await listOutbox();
  const toRemove: string[] = [];
  for (const item of all) {
    const key = `${item.entity}:${item.entityId}`;
    const uploadedAt = covered.get(key);
    if (uploadedAt != null && item.mutatedAt <= uploadedAt) {
      toRemove.push(item.opId);
    }
  }
  await removeOutboxItems(toRemove);
  return toRemove.length;
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

/** Standalone enqueue (prefer transactional putOutboxInTx from repositories). */
export async function enqueueSyncOp(input: {
  entity: SyncEntity;
  entityId: string;
  op: SyncOpKind;
  payload?: unknown;
  mutatedAt?: string;
}): Promise<void> {
  if (!(await isCloudEnqueueEnabled())) return;
  await putOutboxItem(makeOutboxItem(input));
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

