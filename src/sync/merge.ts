import { uid } from '../lib/constants';
import type { CloudRow, MergeResult, SyncConflict, SyncEntity, SyncOutboxItem } from './types';

export type LocalEntityRef = {
  updatedAt: string;
};

/**
 * Decide whether cloud row should apply over local.
 * - pending outbox for same id → skip (caller records conflict / keeps local)
 * - LWW by updatedAt
 * - edit wins over delete when local exists and cloud is tombstone with older/equal stamp
 */
export function shouldApplyCloudRow(
  cloud: CloudRow,
  local: LocalEntityRef | undefined,
  pendingOutbox: SyncOutboxItem[],
): { apply: boolean; conflict?: Omit<SyncConflict, 'id' | 'notedAt'> } {
  const pending = pendingOutbox.filter(
    (o) => o.entity === cloud.entity && o.entityId === cloud.id,
  );
  if (pending.length) {
    return {
      apply: false,
      conflict: {
        entity: cloud.entity,
        entityId: cloud.id,
        localUpdatedAt: local?.updatedAt ?? pending[0]?.mutatedAt,
        cloudUpdatedAt: cloud.updatedAt,
        resolution: 'kept_local',
      },
    };
  }

  const cloudDeleted = Boolean(cloud.deletedAt);

  if (!local) {
    // Nothing local: apply upsert or apply delete (no-op delete)
    return { apply: !cloudDeleted || true };
  }

  if (cloudDeleted) {
    // Edit wins over delete if local is newer or equal
    if (local.updatedAt >= cloud.updatedAt) {
      return {
        apply: false,
        conflict: {
          entity: cloud.entity,
          entityId: cloud.id,
          localUpdatedAt: local.updatedAt,
          cloudUpdatedAt: cloud.updatedAt,
          resolution: 'kept_edit_over_delete',
        },
      };
    }
    return { apply: true };
  }

  if (cloud.updatedAt > local.updatedAt) {
    return { apply: true };
  }
  if (cloud.updatedAt < local.updatedAt) {
    return {
      apply: false,
      conflict: {
        entity: cloud.entity,
        entityId: cloud.id,
        localUpdatedAt: local.updatedAt,
        cloudUpdatedAt: cloud.updatedAt,
        resolution: 'kept_local',
      },
    };
  }
  // Equal timestamps: treat as already in sync (dedup)
  return { apply: false };
}

export function mergeCloudIntoPlan(
  cloudRows: CloudRow[],
  getLocal: (entity: SyncEntity, id: string) => LocalEntityRef | undefined,
  pendingOutbox: SyncOutboxItem[],
  nowISO: string,
): MergeResult & { toUpsert: CloudRow[]; toDelete: CloudRow[] } {
  const toUpsert: CloudRow[] = [];
  const toDelete: CloudRow[] = [];
  const conflicts: SyncConflict[] = [];
  let skippedPendingLocal = 0;

  // Dedup cloud rows by entity+id keeping newest updatedAt
  const newest = new Map<string, CloudRow>();
  for (const row of cloudRows) {
    const key = `${row.entity}:${row.id}`;
    const prev = newest.get(key);
    if (!prev || row.updatedAt > prev.updatedAt) newest.set(key, row);
  }

  for (const cloud of newest.values()) {
    const local = getLocal(cloud.entity, cloud.id);
    const decision = shouldApplyCloudRow(cloud, local, pendingOutbox);
    if (decision.conflict) {
      conflicts.push({ ...decision.conflict, id: uid(), notedAt: nowISO });
      if (decision.conflict.resolution === 'kept_local') skippedPendingLocal += 1;
    }
    if (!decision.apply) continue;
    if (cloud.deletedAt) toDelete.push(cloud);
    else toUpsert.push(cloud);
  }

  return {
    appliedUpserts: toUpsert.length,
    appliedDeletes: toDelete.length,
    skippedPendingLocal,
    conflicts,
    toUpsert,
    toDelete,
  };
}

/** Dedupe outbox: keep latest mutatedAt per entity+id; delete beats older upserts if newer. */
export function dedupeOutbox(items: SyncOutboxItem[]): SyncOutboxItem[] {
  const map = new Map<string, SyncOutboxItem>();
  for (const item of items) {
    const key = `${item.entity}:${item.entityId}`;
    const prev = map.get(key);
    if (!prev || item.mutatedAt >= prev.mutatedAt) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => a.mutatedAt.localeCompare(b.mutatedAt));
}
