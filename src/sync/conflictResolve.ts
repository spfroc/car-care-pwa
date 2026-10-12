import { getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { CareRecord, Vehicle } from '../types';
import { detectPushRejected, resolutionImpliesDelete } from './conflictDetect';
import {
  getConflict,
  markConflictResolved,
  openConflict,
  type SyncConflictRecord,
} from './conflictStore';
import { isManualConflictEntity } from './conflictTypes';
import {
  clearOutboxConflictBlock,
  listOutbox,
  makeOutboxItem,
  markOutboxBlockedByConflict,
  putOutboxItem,
  removeOutboxForEntityId,
  removeOutboxItems,
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
  /** keep_local may re-open if push still cloud_newer */
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

async function applyCloudSnapshotLocally(
  entity: SyncEntity,
  entityId: string,
  snapshot: SyncConflictRecord['cloudSnapshot'],
): Promise<void> {
  if (!snapshot) throw new Error('缺少云端快照');
  const db = await getDB();
  if (snapshot.op === 'delete') {
    if (entity === 'vehicles') await db.delete('vehicles', entityId);
    else if (entity === 'records') await db.delete('records', entityId);
    else throw new Error(`不支持删除实体 ${entity}`);
    return;
  }
  if (!snapshot.payload || typeof snapshot.payload !== 'object') {
    throw new Error('云端快照缺少 payload，无法恢复本地');
  }
  if (entity === 'vehicles') {
    await db.put('vehicles', snapshot.payload as Vehicle);
  } else if (entity === 'records') {
    await db.put('records', snapshot.payload as CareRecord);
  } else {
    throw new Error(`不支持采用云端实体 ${entity}`);
  }
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

async function takeCloudUnlocked(
  signal: AbortSignal,
  conflict: SyncConflictRecord,
): Promise<ResolveResult> {
  throwIfSyncAborted(signal);
  // 1) Apply cloud to local FIRST
  await applyCloudSnapshotLocally(conflict.entity, conflict.entityId, conflict.cloudSnapshot);
  throwIfSyncAborted(signal);

  // 2) Verify local matches cloud intent
  const db = await getDB();
  if (conflict.cloudSnapshot?.op === 'delete') {
    const gone =
      conflict.entity === 'vehicles'
        ? !(await db.get('vehicles', conflict.entityId))
        : !(await db.get('records', conflict.entityId));
    if (!gone) throw new Error('采用云端删除失败：本地行仍存在');
  } else {
    const row =
      conflict.entity === 'vehicles'
        ? await db.get('vehicles', conflict.entityId)
        : await db.get('records', conflict.entityId);
    if (!row) throw new Error('采用云端失败：本地未写入云端快照');
  }

  throwIfSyncAborted(signal);
  // 3) Only then clear blocked + same entity+id outbox
  const blocked = conflict.blockedOpIds ?? [];
  if (blocked.length) await removeOutboxItems(blocked);
  await removeOutboxForEntityId(conflict.entity, conflict.entityId);

  const resolved = await markConflictResolved(conflict.id, 'take_cloud');
  return {
    ok: true,
    message: '已采用云端版本；本地已恢复，待同步队列已清除。',
    conflict: resolved,
  };
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

