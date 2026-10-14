import { getDB } from '../db';
import { nowISO, uid } from '../lib/constants';
import { getCloudStorageConfig } from './config';
import { hasValidNotionRuntimeSession } from './notionSession';
import { listOpenConflictKeys } from './conflictStore';
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

export const OUTBOX_UNBOUND = 'unbound';

export function nextRetryDelayMs(attempts: number): number {
  const capped = Math.min(2 ** attempts, 64);
  const base = capped * 30_000;
  const jitter = Math.floor(Math.random() * 5_000);
  return base + jitter;
}

/**
 * Whether local writes should enqueue cloud outbox ops.
 * Pass `entity` so Notion can refuse media/stations/settings (D2.1 / §3.5.5).
 */
export async function isCloudEnqueueEnabled(entity?: SyncEntity): Promise<boolean> {
  const cfg = await getCloudStorageConfig();
  if (cfg.provider === 'supabase') {
    return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }
  if (cfg.provider === 'notion') {
    // MVP: vehicles + records only; media never leaves the device via Notion Gateway
    if (entity === 'media' || entity === 'stations' || entity === 'settings') return false;
    if (!cfg.notionGatewayUrl?.trim()) return false;
    // URL alone is insufficient — in-memory session must be valid (§3.5.5 / D2.1)
    return hasValidNotionRuntimeSession();
  }
  return false;
}

export function makeOutboxItem(input: {
  entity: SyncEntity;
  entityId: string;
  op: SyncOpKind;
  payload?: unknown;
  mutatedAt?: string;
  ownerUserId?: string;
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
    ownerUserId: input.ownerUserId,
  };
}

/** Stamp owner from current sync meta (call before putting into a tx). */
export async function stampOutboxOwner(item: SyncOutboxItem): Promise<SyncOutboxItem> {
  if (item.ownerUserId) return item;
  const meta = await getSyncMeta();
  return {
    ...item,
    ownerUserId: meta.cloudUserId ?? OUTBOX_UNBOUND,
  };
}

/** Put outbox row inside an existing readwrite transaction (same atomic unit as business write). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function putOutboxInTx(tx: any, item: SyncOutboxItem): Promise<void> {
  // Caller must stamp BEFORE opening the transaction (no other IDB awaits mid-tx).
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

export function outboxBelongsToUser(item: SyncOutboxItem, cloudUserId: string | undefined): boolean {
  const owner = item.ownerUserId ?? OUTBOX_UNBOUND;
  if (!cloudUserId) return owner === OUTBOX_UNBOUND;
  return owner === cloudUserId || owner === OUTBOX_UNBOUND;
}

export async function listOutboxForUser(cloudUserId: string | undefined): Promise<SyncOutboxItem[]> {
  const all = await listOutbox();
  return all.filter((o) => outboxBelongsToUser(o, cloudUserId));
}

export async function countOutboxForOwner(ownerUserId: string): Promise<number> {
  const all = await listOutbox();
  return all.filter((o) => (o.ownerUserId ?? OUTBOX_UNBOUND) === ownerUserId).length;
}

export async function listReadyOutbox(now = nowISO()): Promise<SyncOutboxItem[]> {
  const meta = await getSyncMeta();
  const mine = await listOutboxForUser(meta.cloudUserId);
  const openKeys = await listOpenConflictKeys();
  return dedupeOutbox(
    mine.filter(
      (o) =>
        o.attempts < MAX_OUTBOX_ATTEMPTS &&
        o.nextRetryAt <= now &&
        !o.blockedByConflictId &&
        !openKeys.has(`${o.entity}:${o.entityId}`),
    ),
  );
}

/** Mark outbox ops as blocked by an open conflict (also filters listReadyOutbox). */
export async function markOutboxBlockedByConflict(
  opIds: string[],
  conflictId: string,
): Promise<void> {
  if (!opIds.length) return;
  const db = await getDB();
  const tx = db.transaction('sync_outbox', 'readwrite');
  for (const id of opIds) {
    const raw = await tx.store.get(id);
    if (!raw) continue;
    const item = raw as SyncOutboxItem;
    await tx.store.put({ ...item, blockedByConflictId: conflictId });
  }
  await tx.done;
}

/** Clear blockedByConflictId for ops (after resolve). */
export async function clearOutboxConflictBlock(opIds: string[]): Promise<void> {
  if (!opIds.length) return;
  const db = await getDB();
  const tx = db.transaction('sync_outbox', 'readwrite');
  for (const id of opIds) {
    const raw = await tx.store.get(id);
    if (!raw) continue;
    const item = raw as SyncOutboxItem;
    if (!item.blockedByConflictId) continue;
    const { blockedByConflictId: _drop, ...rest } = item;
    await tx.store.put(rest);
  }
  await tx.done;
}

/** Remove all outbox ops for entity+id (used after take_cloud succeeds). */
export async function removeOutboxForEntityId(
  entity: string,
  entityId: string,
): Promise<string[]> {
  const all = await listOutbox();
  const ids = all.filter((o) => o.entity === entity && o.entityId === entityId).map((o) => o.opId);
  await removeOutboxItems(ids);
  return ids;
}

/** Rebind unbound ops to the verified user (does not touch other owners' queues). */
export async function rebindUnboundOutbox(userId: string): Promise<number> {
  const all = await listOutbox();
  let n = 0;
  for (const item of all) {
    const owner = item.ownerUserId ?? OUTBOX_UNBOUND;
    if (owner === OUTBOX_UNBOUND) {
      await putOutboxItem({ ...item, ownerUserId: userId });
      n += 1;
    }
  }
  return n;
}

export async function putOutboxItem(item: SyncOutboxItem): Promise<void> {
  const db = await getDB();
  const stamped = await stampOutboxOwner(item);
  await db.put('sync_outbox', stamped as SyncOutboxItem & { entity: string; op: string });
}

export async function removeOutboxItems(opIds: string[]): Promise<void> {
  if (!opIds.length) return;
  const db = await getDB();
  const tx = db.transaction('sync_outbox', 'readwrite');
  for (const id of opIds) await tx.store.delete(id);
  await tx.done;
}

/**
 * Remove conflicted (stale) outbox ops, but never remove a newer op
 * for the same entity+id that was enqueued mid-sync.
 * Matches by opId, or by entity+entityId when snapshot uses composite opIds.
 */
export async function removeStaleConflictOps(
  conflicts: Array<{
    opId: string;
    entity?: string;
    entityId?: string;
    attemptedAt?: string;
  }>,
): Promise<{ removed: string[]; keptNewer: string[] }> {
  const all = await listOutbox();
  const removed: string[] = [];
  const keptNewer: string[] = [];
  const seen = new Set<string>();
  for (const c of conflicts) {
    const ceiling = c.attemptedAt;
    const candidates = all.filter((o) => {
      if (o.opId === c.opId) return true;
      if (c.entity && c.entityId && o.entity === c.entity && o.entityId === c.entityId) {
        return true;
      }
      return false;
    });
    for (const item of candidates) {
      if (seen.has(item.opId)) continue;
      if (ceiling && item.mutatedAt > ceiling) {
        keptNewer.push(item.opId);
        continue;
      }
      const hasNewerSibling = all.some(
        (o) =>
          o.opId !== item.opId &&
          o.entity === item.entity &&
          o.entityId === item.entityId &&
          o.mutatedAt > item.mutatedAt,
      );
      if (hasNewerSibling) {
        removed.push(item.opId);
        keptNewer.push(item.opId);
        seen.add(item.opId);
        continue;
      }
      // Stale intent: cloud won LWW
      if (!ceiling || item.mutatedAt <= ceiling || item.opId === c.opId) {
        removed.push(item.opId);
        seen.add(item.opId);
      }
    }
  }
  await removeOutboxItems(removed);
  return { removed, keptNewer };
}

/**
 * Wipe entire outbox — prefer clearOutboxForUser to avoid cross-account data loss.
 * Kept for tests / explicit full reset only.
 */
export async function clearOutbox(): Promise<void> {
  const db = await getDB();
  await db.clear('sync_outbox');
}

/** Delete only ops belonging to the given cloud user (incl. unbound when that user is active). */
export async function clearOutboxForUser(cloudUserId: string | undefined): Promise<number> {
  const mine = await listOutboxForUser(cloudUserId);
  await removeOutboxItems(mine.map((o) => o.opId));
  return mine.length;
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
  const meta = await getSyncMeta();
  const all = await listOutboxForUser(meta.cloudUserId);
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
  if (!(await isCloudEnqueueEnabled(input.entity))) return;
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
