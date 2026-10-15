import { getDB } from '../db';
import { nowISO, uid } from '../lib/constants';
import { getCloudStorageConfig } from './config';
import {
  getNotionRuntimeSession,
  hasAttestedNotionRuntimeSession,
  hasValidNotionRuntimeSession,
} from './notionSession';
import {
  buildNotionTargetId,
  classifyOrphanKind,
  isNotionTargetGuardActive,
  notionTargetsEqual,
  observeTargetGuard,
  setNotionTargetGuardMode,
  targetFromOutboxItem,
  type NotionTarget,
  type OrphanKind,
} from './notionTarget';
import { shouldBlockBlindRecreate } from './notionMap';
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

/** Sync in-memory guard mode from CloudStorageConfig (call on verify / flush paths). */
export async function syncNotionTargetGuardFromConfig(): Promise<void> {
  const cfg = await getCloudStorageConfig();
  if (cfg.notionTargetGuard) {
    setNotionTargetGuardMode(cfg.notionTargetGuard);
  }
}

/**
 * Session-derived active Notion target (ADR §3.2).
 * When a verified session exists, it is authoritative — never fall back to stale sync_meta.
 * Returns null when session lacks workspaceKey + gatewayKeyFp.
 */
export function getSessionDerivedActiveTarget(): NotionTarget | null {
  const s = getNotionRuntimeSession();
  const wk = s?.workspaceKey?.trim();
  const fp = s?.gatewayKeyFp?.trim().toLowerCase();
  if (!wk || !fp) return null;
  return { workspaceKey: wk, gatewayKeyFp: fp };
}


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
    if (!hasValidNotionRuntimeSession()) return false;
    // RR-WK: when target guard is active, require gatewayKeyFp attestation
    if (cfg.notionTargetGuard === 'observe' || cfg.notionTargetGuard === 'enforce') {
      setNotionTargetGuardMode(cfg.notionTargetGuard);
      return hasAttestedNotionRuntimeSession();
    }
    if (isNotionTargetGuardActive()) {
      return hasAttestedNotionRuntimeSession();
    }
    return true;
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
  let next = item;
  if (!next.ownerUserId) {
    const meta = await getSyncMeta();
    next = {
      ...next,
      ownerUserId: meta.cloudUserId ?? OUTBOX_UNBOUND,
    };
  }
  return stampOutboxNotionTarget(next);
}

/**
 * RR-WK: stamp gatewayKeyFp / notionTargetId from attested session when available.
 * Does not silently drop queues; unbound owners stay without notionTargetId.
 */
export async function stampOutboxNotionTarget(item: SyncOutboxItem): Promise<SyncOutboxItem> {
  if (item.gatewayKeyFp && item.notionTargetId) return item;
  const cfg = await getCloudStorageConfig();
  if (cfg.provider !== 'notion') return item;
  const session = getNotionRuntimeSession();
  const fp = session?.gatewayKeyFp?.trim().toLowerCase();
  const owner = (item.ownerUserId ?? '').trim();
  if (!fp || !owner || owner === OUTBOX_UNBOUND) return item;
  // Prefer session workspaceKey when it matches owner; else owner ≡ workspaceKey under Notion
  const wk =
    session?.workspaceKey && session.workspaceKey === owner
      ? session.workspaceKey
      : owner;
  try {
    const notionTargetId = buildNotionTargetId(wk, fp);
    return {
      ...item,
      gatewayKeyFp: fp,
      notionTargetId,
    };
  } catch {
    return item;
  }
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

/**
 * Ops whose owner is set and differs from the current workspaceKey / cloudUserId,
 * or (when target guard active) same owner but different gatewayKeyFp / legacy L1.
 * These must never be flushed while bound to another target (SW2 + RR-WK).
 */
export async function listOrphanOutbox(currentOwnerId: string | undefined): Promise<SyncOutboxItem[]> {
  await syncNotionTargetGuardFromConfig();
  const all = await listOutbox();
  const active = getSessionDerivedActiveTarget();
  const currentWk = active?.workspaceKey ?? currentOwnerId;
  const guardOn = isNotionTargetGuardActive();

  return all.filter((o) => {
    const owner = o.ownerUserId ?? OUTBOX_UNBOUND;
    if (owner === OUTBOX_UNBOUND) return false;
    if (!currentWk) return true;
    if (owner !== currentWk) return true;
    if (!guardOn) return false;
    // Same workspace: orphan if legacy (no fp) or different gatewayKeyFp
    const kind = classifyOrphanKind(o, active);
    return kind === 'same_workspace_diff_gateway' || kind === 'legacy_no_fp';
  });
}

export async function countOrphanOutbox(currentOwnerId: string | undefined): Promise<number> {
  return (await listOrphanOutbox(currentOwnerId)).length;
}

export type OrphanOutboxSummaryRow = {
  ownerUserId: string;
  count: number;
  /** RR-WK redundant target id when group is gateway-scoped. */
  notionTargetId?: string;
  gatewayKeyFp?: string;
  /** 异工作区 | 同工作区·异 Gateway | legacy */
  kind: OrphanKind;
};

/** Summarize orphan queues by owner / notionTargetId for the switch panel. */
export async function summarizeOrphanOutbox(
  currentOwnerId: string | undefined,
): Promise<OrphanOutboxSummaryRow[]> {
  const orphans = await listOrphanOutbox(currentOwnerId);
  const active = getSessionDerivedActiveTarget();
  const map = new Map<string, OrphanOutboxSummaryRow>();
  for (const o of orphans) {
    const kind = classifyOrphanKind(o, active) ?? 'cross_workspace';
    const owner = o.ownerUserId ?? OUTBOX_UNBOUND;
    const target = targetFromOutboxItem(o);
    const key =
      kind === 'same_workspace_diff_gateway' && target
        ? `t:${target.workspaceKey}::${target.gatewayKeyFp}`
        : kind === 'legacy_no_fp'
          ? `legacy:${owner}`
          : `wk:${owner}`;
    const row = map.get(key);
    if (row) {
      row.count += 1;
    } else {
      map.set(key, {
        ownerUserId: owner,
        count: 1,
        notionTargetId: target
          ? `${target.workspaceKey}::${target.gatewayKeyFp}`
          : o.notionTargetId,
        gatewayKeyFp: target?.gatewayKeyFp ?? o.gatewayKeyFp,
        kind,
      });
    }
  }
  return [...map.values()];
}

/**
 * Explicit discard of one parked owner's queue (SW3).
 * Exact owner match only — never clears unbound or other owners.
 * Returns 0 if ownerUserId is empty/unbound (refuse accidental wipe).
 */
export async function discardOutboxForExactOwner(ownerUserId: string): Promise<number> {
  const owner = ownerUserId?.trim();
  if (!owner || owner === OUTBOX_UNBOUND) return 0;
  const all = await listOutbox();
  const mine = all.filter((o) => (o.ownerUserId ?? OUTBOX_UNBOUND) === owner);
  await removeOutboxItems(mine.map((o) => o.opId));
  return mine.length;
}

export async function listReadyOutbox(now = nowISO()): Promise<SyncOutboxItem[]> {
  await syncNotionTargetGuardFromConfig();
  const meta = await getSyncMeta();
  const cfg = await getCloudStorageConfig();
  const openKeys = await listOpenConflictKeys();
  const guardOn = isNotionTargetGuardActive() && cfg.provider === 'notion';

  // RR-WK §3.2: when guard active, session-derived target is authoritative.
  // No attested session → refuse all Notion flush (do not fall back to stale meta).
  let mine: SyncOutboxItem[];
  let active: NotionTarget | null = null;
  if (guardOn) {
    active = getSessionDerivedActiveTarget();
    if (!active) {
      observeTargetGuard('flush_refused_no_attested_session', {
        metaCloudUserId: meta.cloudUserId,
        metaTargetId: meta.notionTargetId,
      });
      return [];
    }
    // Prefer session workspace; ignore stale meta for ownership filter
    const all = await listOutbox();
    mine = all.filter((o) => {
      const owner = o.ownerUserId ?? OUTBOX_UNBOUND;
      return owner === active!.workspaceKey || owner === OUTBOX_UNBOUND;
    });
  } else {
    mine = await listOutboxForUser(meta.cloudUserId);
  }

  const wk = guardOn
    ? active!.workspaceKey
    : (meta.cloudUserId ?? cfg.workspaceKey);
  const candidates = mine.filter(
    (o) =>
      o.attempts < MAX_OUTBOX_ATTEMPTS &&
      o.nextRetryAt <= now &&
      !o.blockedByConflictId &&
      !openKeys.has(`${o.entity}:${o.entityId}`),
  );
  // Defense in depth: never flush Notion upserts that hit a same-workspace map tombstone
  const ready: SyncOutboxItem[] = [];
  for (const o of candidates) {
    if (guardOn && cfg.provider === 'notion') {
      const itemTarget = targetFromOutboxItem(o);
      // L1 legacy (no gatewayKeyFp): never auto flush
      if (!itemTarget) {
        observeTargetGuard('flush_skip_legacy_l1', { opId: o.opId, ownerUserId: o.ownerUserId });
        continue;
      }
      // Structured compare — must match session-derived active target
      if (!notionTargetsEqual(itemTarget, active)) {
        observeTargetGuard('flush_skip_target_mismatch', {
          opId: o.opId,
          item: itemTarget,
          active,
        });
        continue;
      }
    }
    if (
      o.op === 'upsert' &&
      cfg.provider === 'notion' &&
      (await shouldBlockBlindRecreate(o.entity, o.entityId, wk))
    ) {
      continue;
    }
    ready.push(o);
  }
  return dedupeOutbox(ready);
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

/**
 * True when Notion map tombstone forbids enqueueing/flushing an upsert (same workspace).
 * Shared by prepareOutboxEnqueue, enqueueSyncOp, and listReadyOutbox.
 */
export async function shouldSkipNotionUpsertEnqueue(
  entity: SyncEntity | string,
  entityId: string,
): Promise<boolean> {
  const cfg = await getCloudStorageConfig();
  if (cfg.provider !== 'notion') return false;
  const meta = await getSyncMeta();
  const wk = meta.cloudUserId ?? cfg.workspaceKey;
  return shouldBlockBlindRecreate(entity, entityId, wk);
}

/**
 * Shared enqueue prep for repositories (putVehicle/putRecord) and enqueueSyncOp.
 * Call BEFORE opening the IDB write transaction (may await map/meta).
 * Returns null when cloud enqueue is disabled or blind-recreate is blocked.
 */
export async function prepareOutboxEnqueue(input: {
  entity: SyncEntity;
  entityId: string;
  op: SyncOpKind;
  payload?: unknown;
  mutatedAt?: string;
}): Promise<SyncOutboxItem | null> {
  if (!(await isCloudEnqueueEnabled(input.entity))) return null;
  if (input.op === 'upsert' && (await shouldSkipNotionUpsertEnqueue(input.entity, input.entityId))) {
    return null;
  }
  return stampOutboxOwner(makeOutboxItem(input));
}

/** Standalone enqueue (prefer transactional putOutboxInTx from repositories). */
export async function enqueueSyncOp(input: {
  entity: SyncEntity;
  entityId: string;
  op: SyncOpKind;
  payload?: unknown;
  mutatedAt?: string;
}): Promise<void> {
  const item = await prepareOutboxEnqueue(input);
  if (!item) return;
  // Already stamped; putOutboxItem is a no-op re-stamp when ownerUserId is set.
  await putOutboxItem(item);
}


/**
 * RR-WK L1 claim: stamp legacy rows (no gatewayKeyFp) onto the current verified target.
 * HARD: confirmToken must be exactly "CLAIM". Forbidden from observe/migration/verify callbacks.
 * Only claims rows whose ownerUserId === session.workspaceKey and that owner has no
 * conflicting stamped target rows with a different gatewayKeyFp.
 */
export async function claimLegacyNotionOutbox(input: {
  confirmToken: string;
}): Promise<{ ok: boolean; claimed: number; message: string }> {
  if (input.confirmToken !== 'CLAIM') {
    return {
      ok: false,
      claimed: 0,
      message: '需要确认令牌 CLAIM 才会认领旧队列（无 Gateway 指纹）。',
    };
  }
  const active = getSessionDerivedActiveTarget();
  if (!active) {
    return {
      ok: false,
      claimed: 0,
      message: '无已验证会话复合身份；请先成功 /verify 后再认领。',
    };
  }
  const all = await listOutbox();
  const stampedOther = all.some((o) => {
    const owner = o.ownerUserId ?? OUTBOX_UNBOUND;
    if (owner !== active.workspaceKey) return false;
    const t = targetFromOutboxItem(o);
    return Boolean(t && t.gatewayKeyFp !== active.gatewayKeyFp);
  });
  if (stampedOther) {
    return {
      ok: false,
      claimed: 0,
      message:
        '同工作区已存在其它 Gateway 指纹的队列，拒绝认领以免混连。请先切回原 Key flush/DISCARD，或丢弃冲突队列。',
    };
  }
  const legacy = all.filter((o) => {
    const owner = o.ownerUserId ?? OUTBOX_UNBOUND;
    if (owner !== active.workspaceKey) return false;
    return !o.gatewayKeyFp && !targetFromOutboxItem(o);
  });
  if (!legacy.length) {
    return { ok: true, claimed: 0, message: '没有可认领的旧队列（无 Gateway 指纹）。' };
  }
  const notionTargetId = buildNotionTargetId(active.workspaceKey, active.gatewayKeyFp);
  let n = 0;
  for (const item of legacy) {
    await putOutboxItem({
      ...item,
      ownerUserId: active.workspaceKey,
      gatewayKeyFp: active.gatewayKeyFp,
      notionTargetId,
    });
    n += 1;
  }
  observeTargetGuard('legacy_claimed', {
    claimed: n,
    workspaceKey: active.workspaceKey,
    gatewayKeyFp: active.gatewayKeyFp,
  });
  return {
    ok: true,
    claimed: n,
    message: `已认领 ${n} 条旧队列到当前 Gateway 指纹 ${active.gatewayKeyFp}。`,
  };
}

/**
 * Explicit discard by redundant notionTargetId (or legacy ownerUserId).
 * confirmToken must be exactly 'DISCARD'. Exact match only.
 */
export async function discardOutboxForNotionTarget(input: {
  notionTargetId?: string;
  ownerUserId?: string;
  confirmToken: string;
}): Promise<number> {
  if (input.confirmToken !== 'DISCARD') return 0;
  const tid = input.notionTargetId?.trim();
  const owner = input.ownerUserId?.trim();
  if (tid) {
    const all = await listOutbox();
    const mine = all.filter((o) => {
      if (o.notionTargetId === tid) return true;
      const t = targetFromOutboxItem(o);
      return t != null && `${t.workspaceKey}::${t.gatewayKeyFp}` === tid;
    });
    await removeOutboxItems(mine.map((o) => o.opId));
    return mine.length;
  }
  if (owner && owner !== OUTBOX_UNBOUND) {
    return discardOutboxForExactOwner(owner);
  }
  return 0;
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
