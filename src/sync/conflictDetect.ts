import { isManualConflictEntity, type ConflictKind, type ConflictSnapshot } from './conflictTypes';
import type { CloudRow, SyncEntity, SyncOutboxItem } from './types';

export type EscalateDecision =
  | { escalate: false; reason?: 'echo' | 'not_manual' | 'no_pending' | 'equal' }
  | {
      escalate: true;
      kind: ConflictKind;
      localUpdatedAt?: string;
      cloudUpdatedAt?: string;
      localSnapshot: ConflictSnapshot;
      cloudSnapshot: ConflictSnapshot;
      blockedOpIds: string[];
    };

function pendingFor(
  pendingOutbox: SyncOutboxItem[],
  entity: SyncEntity,
  entityId: string,
): SyncOutboxItem[] {
  return pendingOutbox.filter((o) => o.entity === entity && o.entityId === entityId);
}

function localSnapshotFromPending(ops: SyncOutboxItem[]): ConflictSnapshot {
  const latest = ops.reduce((a, b) => (a.mutatedAt >= b.mutatedAt ? a : b));
  if (latest.op === 'delete') return { op: 'delete' };
  return { op: 'upsert', payload: latest.payload };
}

function cloudSnapshotFromRow(cloud: CloudRow): ConflictSnapshot {
  if (cloud.deletedAt) {
    return { op: 'delete', deletedAt: cloud.deletedAt, payload: cloud.payload };
  }
  return { op: 'upsert', payload: cloud.payload };
}

/**
 * E1: push rejected (cloud_newer). Escalate for vehicles/records; keep silent LWW elsewhere.
 */
export function detectPushRejected(input: {
  entity: SyncEntity | string;
  entityId: string;
  opId: string;
  localOp: SyncOutboxItem | undefined;
  cloudUpdatedAt?: string;
  cloudRow?: CloudRow | null;
}): EscalateDecision {
  if (!isManualConflictEntity(input.entity)) {
    return { escalate: false, reason: 'not_manual' };
  }
  const localOp = input.localOp;
  const localSnapshot: ConflictSnapshot = localOp
    ? localOp.op === 'delete'
      ? { op: 'delete' }
      : { op: 'upsert', payload: localOp.payload }
    : { op: 'upsert' };
  const cloudSnapshot: ConflictSnapshot = input.cloudRow
    ? cloudSnapshotFromRow(input.cloudRow)
    : { op: 'upsert', deletedAt: null };
  const kind: ConflictKind =
    localSnapshot.op === 'delete' || cloudSnapshot.op === 'delete'
      ? 'edit_vs_delete'
      : 'push_rejected';
  return {
    escalate: true,
    kind,
    localUpdatedAt: localOp?.mutatedAt,
    cloudUpdatedAt: input.cloudUpdatedAt ?? input.cloudRow?.updatedAt,
    localSnapshot,
    cloudSnapshot,
    blockedOpIds: [input.opId],
  };
}

/**
 * E2 / E3 on pull: pending local outbox + cloud fork (not self-push echo).
 */
export function detectPullConflict(input: {
  cloud: CloudRow;
  pendingOutbox: SyncOutboxItem[];
  /** Recently ACK'd push stamps for echo suppression: entity:id → mutatedAt */
  recentAckStamps?: Map<string, string>;
  localDeviceId?: string;
}): EscalateDecision {
  const { cloud, pendingOutbox } = input;
  if (!isManualConflictEntity(cloud.entity)) {
    return { escalate: false, reason: 'not_manual' };
  }
  const pending = pendingFor(pendingOutbox, cloud.entity, cloud.id);
  if (!pending.length) {
    return { escalate: false, reason: 'no_pending' };
  }

  const latest = pending.reduce((a, b) => (a.mutatedAt >= b.mutatedAt ? a : b));

  // Echo: cloud stamp matches our recent successful push for this id
  const ackKey = `${cloud.entity}:${cloud.id}`;
  const ackAt = input.recentAckStamps?.get(ackKey);
  if (ackAt && cloud.updatedAt === ackAt && !cloud.deletedAt) {
    return { escalate: false, reason: 'echo' };
  }
  // Echo: same device + cloud stamp ≤ pending mutatedAt (self-push not yet reflected differently)
  if (
    input.localDeviceId &&
    cloud.deviceId &&
    cloud.deviceId === input.localDeviceId &&
    cloud.updatedAt <= latest.mutatedAt &&
    !cloud.deletedAt &&
    latest.op !== 'delete'
  ) {
    return { escalate: false, reason: 'echo' };
  }

  // No real fork if cloud is not newer / not a crossing delete
  const cloudDeleted = Boolean(cloud.deletedAt);
  const localDeleted = latest.op === 'delete';
  if (!cloudDeleted && !localDeleted && cloud.updatedAt <= latest.mutatedAt) {
    // Cloud older or equal — pending will push; not an open conflict
    return { escalate: false, reason: 'equal' };
  }

  const kind: ConflictKind =
    cloudDeleted || localDeleted ? 'edit_vs_delete' : 'edit_edit';

  return {
    escalate: true,
    kind,
    localUpdatedAt: latest.mutatedAt,
    cloudUpdatedAt: cloud.updatedAt,
    localSnapshot: localSnapshotFromPending(pending),
    cloudSnapshot: cloudSnapshotFromRow(cloud),
    blockedOpIds: pending.map((p) => p.opId),
  };
}

/** Whether resolving a choice implies a delete taking effect. */
export function resolutionImpliesDelete(
  choice: 'keep_local' | 'take_cloud',
  conflict: { localSnapshot?: ConflictSnapshot; cloudSnapshot?: ConflictSnapshot },
): boolean {
  if (choice === 'keep_local') return conflict.localSnapshot?.op === 'delete';
  return conflict.cloudSnapshot?.op === 'delete';
}
