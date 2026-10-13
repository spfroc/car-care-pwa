import { getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { CareRecord, Vehicle } from '../types';
import {
  cloudSnapshotFromRow,
  detectPushRejected,
  localSnapshotFromPending,
  resolutionImpliesDelete,
} from './conflictDetect';
import {
  getConflict,
  listResolvedConflicts,
  markConflictResolved,
  openConflict,
  putConflict,
  type SyncConflictRecord,
} from './conflictStore';
import {
  isManualConflictEntity,
  MAX_RESOLVED_CONFLICTS,
  type ConflictKind,
} from './conflictTypes';
import {
  clearOutboxConflictBlock,
  listOutbox,
  makeOutboxItem,
  markOutboxBlockedByConflict,
  putOutboxItem,
  removeOutboxForEntityId,
  removeOutboxItems,
  settleTx,
  stampOutboxOwner,
} from './outbox';
import {
  SyncLeaseLostError,
  throwIfSyncAborted,
  withSyncLock,
} from './tabLock';
import type { CloudRow, SyncEntity, SyncOutboxItem } from './types';

export type ResolveChoice = 'keep_local' | 'take_cloud';

export type ResolveResult = {
  ok: boolean;
  message: string;
  conflict?: SyncConflictRecord;
  lockBusy?: boolean;
  /** keep_local may re-open if push still cloud_newer; take_cloud may keep open for re-prompt */
  reopened?: boolean;
};

async function assertAuthOk(): Promise<{ ok: true } | { ok: false; message: string }> {
  const { resolveProvider, guardUserSwitch } = await import('./engine');
  const provider = await resolveProvider();
  if (!provider) return { ok: false, message: '未配置云存储' };
  let verify;
  try {
    verify = await provider.verify();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (!verify.ok) return { ok: false, message: verify.error ?? '云端身份校验失败' };
  const switchGuard = await guardUserSwitch(verify.userId);
  if (!switchGuard.ok) return { ok: false, message: switchGuard.message };
  return { ok: true };
}

function cloudIdentityMatches(
  conflict: SyncConflictRecord,
  cloudRow: CloudRow | null,
): boolean {
  const expectedAt = conflict.cloudUpdatedAt;
  if (!cloudRow) {
    // Tombstone may disappear after GC; only treat as match when snapshot was already delete
    // and we had no concrete updatedAt to compare — otherwise force refresh.
    return conflict.cloudSnapshot?.op === 'delete' && !expectedAt;
  }
  if (expectedAt && cloudRow.updatedAt !== expectedAt) return false;
  const snapDeleted = conflict.cloudSnapshot?.op === 'delete';
  const rowDeleted = Boolean(cloudRow.deletedAt);
  if (snapDeleted !== rowDeleted) return false;
  // When conflict lacked cloudUpdatedAt, still require snap op agreement (above) and accept row.
  return true;
}

function conflictKindForSides(
  localOp: 'upsert' | 'delete' | undefined,
  cloudOp: 'upsert' | 'delete' | undefined,
  fallback: ConflictKind,
): ConflictKind {
  if (localOp === 'delete' || cloudOp === 'delete') return 'edit_vs_delete';
  if (fallback === 'push_rejected') return 'push_rejected';
  return 'edit_edit';
}

async function refreshConflictCloudChanged(
  conflict: SyncConflictRecord,
  cloudRow: CloudRow | null,
): Promise<SyncConflictRecord> {
  const now = nowISO();
  let cloudSnapshot = conflict.cloudSnapshot;
  let cloudUpdatedAt = conflict.cloudUpdatedAt;
  if (cloudRow) {
    cloudSnapshot = cloudSnapshotFromRow(cloudRow);
    cloudUpdatedAt = cloudRow.updatedAt;
  } else {
    cloudSnapshot = { op: 'delete' };
    cloudUpdatedAt = undefined;
  }
  const next: SyncConflictRecord = {
    ...conflict,
    kind: conflictKindForSides(conflict.localSnapshot?.op, cloudSnapshot?.op, conflict.kind),
    cloudSnapshot,
    cloudUpdatedAt,
    notedAt: now,
    status: 'open',
  };
  await putConflict(next);
  return next;
}

async function refreshConflictPostLocalEdits(
  conflict: SyncConflictRecord,
  entityOps: SyncOutboxItem[],
): Promise<SyncConflictRecord> {
  const now = nowISO();
  const localSnapshot = localSnapshotFromPending(entityOps);
  const latest = entityOps.reduce((a, b) => (a.mutatedAt >= b.mutatedAt ? a : b));
  const blocked = new Set([...(conflict.blockedOpIds ?? []), ...entityOps.map((o) => o.opId)]);
  const next: SyncConflictRecord = {
    ...conflict,
    kind: conflictKindForSides(localSnapshot.op, conflict.cloudSnapshot?.op, conflict.kind),
    localSnapshot,
    localUpdatedAt: latest.mutatedAt,
    blockedOpIds: [...blocked],
    notedAt: now,
    status: 'open',
  };
  await putConflict(next);
  await markOutboxBlockedByConflict(
    entityOps.map((o) => o.opId),
    conflict.id,
  );
  return next;
}

/**
 * Apply verified cloud row + clear only conflict-related outbox + mark resolved
 * in one IndexedDB transaction (vehicles|records + sync_outbox + sync_conflicts).
 */
async function applyTakeCloudInTx(
  conflict: SyncConflictRecord,
  cloudRow: CloudRow | null,
  outboxOpIdsToRemove: string[],
): Promise<SyncConflictRecord> {
  const db = await getDB();
  const entityStore = conflict.entity === 'vehicles' ? 'vehicles' : 'records';
  if (conflict.entity !== 'vehicles' && conflict.entity !== 'records') {
    throw new Error(`不支持采用云端实体 ${conflict.entity}`);
  }
  const now = nowISO();
  const resolved: SyncConflictRecord = {
    ...conflict,
    status: 'resolved',
    resolution: 'take_cloud',
    resolvedAt: now,
    notedAt: now,
  };

  const tx = db.transaction([entityStore, 'sync_outbox', 'sync_conflicts'], 'readwrite');
  await settleTx(tx, async () => {
    const snapOp =
      cloudRow != null
        ? cloudRow.deletedAt
          ? 'delete'
          : 'upsert'
        : conflict.cloudSnapshot?.op ?? 'upsert';

    if (snapOp === 'delete') {
      await tx.objectStore(entityStore).delete(conflict.entityId);
    } else {
      const payload = cloudRow?.payload ?? conflict.cloudSnapshot?.payload;
      if (!payload || typeof payload !== 'object') {
        throw new Error('云端快照缺少 payload，无法恢复本地');
      }
      if (entityStore === 'vehicles') {
        await tx.objectStore('vehicles').put(payload as Vehicle);
      } else {
        await tx.objectStore('records').put(payload as CareRecord);
      }
    }

    for (const opId of outboxOpIdsToRemove) {
      await tx.objectStore('sync_outbox').delete(opId);
    }

    await tx.objectStore('sync_conflicts').put(resolved);
  });

  // Cap resolved history outside the atomic resolve txn (same as markConflictResolved).
  await pruneResolvedConflictsBestEffort();

  return resolved;
}

async function takeCloudUnlocked(
  signal: AbortSignal,
  conflict: SyncConflictRecord,
): Promise<ResolveResult> {
  throwIfSyncAborted(signal);

  // P1: account / auth guard (align with keep_local) — no local mutation on failure
  const auth = await assertAuthOk();
  if (!auth.ok) return { ok: false, message: auth.message };

  throwIfSyncAborted(signal);
  const { resolveProvider } = await import('./engine');
  const provider = await resolveProvider();
  if (!provider) return { ok: false, message: '未配置云存储' };

  // P1: re-read cloud and verify LWW identity vs conflict snapshot
  let cloudRow: CloudRow | null = null;
  try {
    const snap = await provider.pullAll();
    cloudRow =
      snap.rows.find((r) => r.entity === conflict.entity && r.id === conflict.entityId) ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `读取云端失败（已保留本地数据、待同步队列与冲突）：${msg}`,
    };
  }

  throwIfSyncAborted(signal);

  if (!cloudIdentityMatches(conflict, cloudRow)) {
    const refreshed = await refreshConflictCloudChanged(conflict, cloudRow);
    return {
      ok: false,
      message: '云端版本已变化，冲突快照已刷新，请重新选择。',
      conflict: refreshed,
      reopened: true,
    };
  }

  // P0: distinguish blocked-at-conflict ops vs post-conflict local edits
  const allOutbox = await listOutbox();
  const entityOps = allOutbox.filter(
    (o) => o.entity === conflict.entity && o.entityId === conflict.entityId,
  );
  const blockedSet = new Set(conflict.blockedOpIds ?? []);
  const postConflictOps = entityOps.filter((o) => !blockedSet.has(o.opId));

  if (postConflictOps.length > 0) {
    const refreshed = await refreshConflictPostLocalEdits(conflict, entityOps);
    return {
      ok: false,
      message:
        '冲突发生后本地又有新编辑；已保留本地数据与待同步队列，请重新确认后再选择采用云端或保留本地。',
      conflict: refreshed,
      reopened: true,
    };
  }

  throwIfSyncAborted(signal);

  // Only clear ops that belong to this conflict (blocked set). With P0 gate above,
  // entityOps should be a subset of blocked; still never wipe unrelated newer ids.
  const toRemove = entityOps
    .filter((o) => blockedSet.has(o.opId))
    .map((o) => o.opId);
  // Also remove any blockedOpIds that may already be gone from outbox (no-op deletes).
  for (const id of conflict.blockedOpIds ?? []) {
    if (!toRemove.includes(id)) toRemove.push(id);
  }

  try {
    const resolved = await applyTakeCloudInTx(conflict, cloudRow, toRemove);
    return {
      ok: true,
      message: '已采用云端版本；本地已恢复，冲突相关待同步队列已清除。',
      conflict: resolved,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `采用云端失败（冲突保持待处理）：${msg}`,
    };
  }
}


async function pruneResolvedConflictsBestEffort(): Promise<void> {
  const resolvedRows = await listResolvedConflicts(MAX_RESOLVED_CONFLICTS + 20);
  if (resolvedRows.length <= MAX_RESOLVED_CONFLICTS) return;
  const db = await getDB();
  const drop = resolvedRows.slice(MAX_RESOLVED_CONFLICTS);
  const pruneTx = db.transaction('sync_conflicts', 'readwrite');
  for (const r of drop) await pruneTx.store.delete(r.id);
  await pruneTx.done;
}

async function applyLocalSnapshot(
  entity: SyncEntity,
  entityId: string,
  snapshot: SyncConflictRecord['localSnapshot'],
  mutatedAt: string,
): Promise<SyncOutboxItem> {
  const db = await getDB();
  if (!snapshot) throw new Error('缺少本地快照');
  if (snapshot.op === 'delete') {
    if (entity === 'vehicles') await db.delete('vehicles', entityId);
    else if (entity === 'records') await db.delete('records', entityId);
    const item = await stampOutboxOwner(
      makeOutboxItem({ entity, entityId, op: 'delete', mutatedAt }),
    );
    await putOutboxItem(item);
    return item;
  }
  if (!snapshot.payload || typeof snapshot.payload !== 'object') {
    // Fall back to current IDB row
    if (entity === 'vehicles') {
      const row = await db.get('vehicles', entityId);
      if (!row) throw new Error('本地车辆不存在且无快照 payload');
      const next = { ...row, updatedAt: mutatedAt };
      await db.put('vehicles', next);
      const item = await stampOutboxOwner(
        makeOutboxItem({ entity, entityId, op: 'upsert', payload: next, mutatedAt }),
      );
      await putOutboxItem(item);
      return item;
    }
    if (entity === 'records') {
      const row = await db.get('records', entityId);
      if (!row) throw new Error('本地记录不存在且无快照 payload');
      const next = { ...row, updatedAt: mutatedAt };
      await db.put('records', next);
      const item = await stampOutboxOwner(
        makeOutboxItem({ entity, entityId, op: 'upsert', payload: next, mutatedAt }),
      );
      await putOutboxItem(item);
      return item;
    }
    throw new Error(`不支持保留本地实体 ${entity}`);
  }
  if (entity === 'vehicles') {
    const next = { ...(snapshot.payload as Vehicle), updatedAt: mutatedAt };
    await db.put('vehicles', next);
    const item = await stampOutboxOwner(
      makeOutboxItem({ entity, entityId, op: 'upsert', payload: next, mutatedAt }),
    );
    await putOutboxItem(item);
    return item;
  }
  if (entity === 'records') {
    const next = { ...(snapshot.payload as CareRecord), updatedAt: mutatedAt };
    await db.put('records', next);
    const item = await stampOutboxOwner(
      makeOutboxItem({ entity, entityId, op: 'upsert', payload: next, mutatedAt }),
    );
    await putOutboxItem(item);
    return item;
  }
  throw new Error(`不支持保留本地实体 ${entity}`);
}

async function keepLocalUnlocked(
  signal: AbortSignal,
  conflict: SyncConflictRecord,
): Promise<ResolveResult> {
  throwIfSyncAborted(signal);
  const auth = await assertAuthOk();
  if (!auth.ok) return { ok: false, message: auth.message };

  const mutatedAt = nowISO();
  // Clear old blocked ops first so we can enqueue a fresh bumped op
  const blocked = conflict.blockedOpIds ?? [];
  if (blocked.length) {
    await clearOutboxConflictBlock(blocked);
    await removeOutboxItems(blocked);
  }
  await removeOutboxForEntityId(conflict.entity, conflict.entityId);

  throwIfSyncAborted(signal);
  const freshOp = await applyLocalSnapshot(
    conflict.entity,
    conflict.entityId,
    conflict.localSnapshot,
    mutatedAt,
  );

  const resolved = await markConflictResolved(conflict.id, 'keep_local');

  // Normal push / LWW — never force-overwrite cloud
  throwIfSyncAborted(signal);
  const { resolveProvider } = await import('./engine');
  const provider = await resolveProvider();
  if (!provider) {
    return {
      ok: true,
      message: '已保留本地并写入队列；未配置云端，下轮同步时推送。',
      conflict: resolved,
    };
  }
  const push = await provider.pushOps([freshOp]);
  if (signal.aborted) {
    throw new SyncLeaseLostError(
      '同步锁已超时并被其他标签页接管；保留本地的推送结果不确定，队列仍保留，请重试同步。',
    );
  }
  if (push.applied.includes(freshOp.opId)) {
    await removeOutboxItems([freshOp.opId]);
    return {
      ok: true,
      message: '已保留本地并成功推送到云端。',
      conflict: resolved,
    };
  }
  const rejected = push.conflicts.find((c) => c.opId === freshOp.opId);
  if (rejected) {
    // Re-open — do not silently drop local intent
    const all = await listOutbox();
    const localOp = all.find((o) => o.opId === freshOp.opId) ?? freshOp;
    let cloudRow: CloudRow | null = null;
    try {
      const snap = await provider.pullAll();
      cloudRow =
        snap.rows.find((r) => r.entity === conflict.entity && r.id === conflict.entityId) ?? null;
    } catch {
      /* keep null */
    }
    const decision = detectPushRejected({
      entity: conflict.entity,
      entityId: conflict.entityId,
      opId: freshOp.opId,
      localOp,
      cloudUpdatedAt: rejected.cloudUpdatedAt,
      cloudRow,
    });
    if (decision.escalate) {
      const reopened = await openConflict({
        entity: conflict.entity,
        entityId: conflict.entityId,
        kind: decision.kind,
        localUpdatedAt: decision.localUpdatedAt,
        cloudUpdatedAt: decision.cloudUpdatedAt,
        localSnapshot: decision.localSnapshot,
        cloudSnapshot: decision.cloudSnapshot,
        blockedOpIds: decision.blockedOpIds,
      });
      if (reopened) {
        await markOutboxBlockedByConflict(decision.blockedOpIds, reopened.id);
      }
      return {
        ok: false,
        message: '保留本地后推送仍被云端较新拒绝；冲突已重新打开，请再次选择。',
        conflict: reopened ?? resolved,
        reopened: true,
      };
    }
  }
  if (push.error) {
    return {
      ok: true,
      message: `已保留本地并写入队列；推送暂失败（${push.error}），可稍后同步重试。`,
      conflict: resolved,
    };
  }
  return {
    ok: true,
    message: '已保留本地并写入待同步队列。',
    conflict: resolved,
  };
}

/**
 * Resolve one open conflict. Holds withSyncLock; failures keep the conflict open.
 * UI must call requiresDeleteConfirm() for delete-related choices before invoking.
 */
export async function resolveConflict(
  conflictId: string,
  choice: ResolveChoice,
): Promise<ResolveResult> {
  const conflict = await getConflict(conflictId);
  if (!conflict) return { ok: false, message: '冲突不存在' };
  if (conflict.status !== 'open') return { ok: false, message: '该冲突已解决' };
  if (!isManualConflictEntity(conflict.entity)) {
    return { ok: false, message: '该实体不支持手动解决' };
  }

  try {
    const locked = await withSyncLock(async (signal) => {
      // Re-read under lock
      const fresh = await getConflict(conflictId);
      if (!fresh || fresh.status !== 'open') {
        return { ok: false, message: '冲突已不存在或已解决' } satisfies ResolveResult;
      }
      if (choice === 'take_cloud') return takeCloudUnlocked(signal, fresh);
      return keepLocalUnlocked(signal, fresh);
    });
    if (!locked.ok) {
      return {
        ok: false,
        message: locked.message,
        lockBusy: true,
      };
    }
    return locked.value;
  } catch (e) {
    if (e instanceof SyncLeaseLostError) {
      return { ok: false, message: e.message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `解决失败（冲突保持待处理）：${msg}` };
  }
}

export function requiresDeleteConfirm(
  choice: ResolveChoice,
  conflict: SyncConflictRecord,
): boolean {
  return resolutionImpliesDelete(choice, conflict);
}

/** Summarize a conflict side for Chinese UI. */
export function summarizeConflictSide(
  entity: SyncEntity,
  snapshot: SyncConflictRecord['localSnapshot'] | SyncConflictRecord['cloudSnapshot'],
  updatedAt?: string,
): string {
  if (!snapshot) return `（无快照）${updatedAt ? ` · ${updatedAt}` : ''}`;
  if (snapshot.op === 'delete') {
    return `删除${updatedAt ? ` · ${updatedAt}` : ''}`;
  }
  const p = snapshot.payload as Record<string, unknown> | undefined;
  if (!p) return `更新${updatedAt ? ` · ${updatedAt}` : ''}`;
  if (entity === 'vehicles') {
    const name = typeof p.name === 'string' ? p.name : entity;
    const plate = typeof p.plate === 'string' ? ` ${p.plate}` : '';
    return `车辆「${name}${plate}」${updatedAt ? ` · ${updatedAt}` : ''}`;
  }
  const type = typeof p.type === 'string' ? p.type : '记录';
  const amount = typeof p.amountPaid === 'number' ? ` ¥${p.amountPaid}` : '';
  const date = typeof p.date === 'string' ? ` ${p.date}` : '';
  return `${type}${amount}${date}${updatedAt ? ` · ${updatedAt}` : ''}`;
}

