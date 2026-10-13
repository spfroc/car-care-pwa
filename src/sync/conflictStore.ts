import { getDB } from '../db';
import { nowISO, uid } from '../lib/constants';
import {
  MAX_OPEN_CONFLICTS,
  MAX_RESOLVED_CONFLICTS,
  type ConflictKind,
  type ConflictResolutionChoice,
  type ConflictSnapshot,
  type SyncConflictRecord,
} from './conflictTypes';

export type { SyncConflictRecord } from './conflictTypes';
import type { SyncEntity } from './types';

export async function putConflict(record: SyncConflictRecord): Promise<void> {
  const db = await getDB();
  await db.put('sync_conflicts', record);
}

export async function getConflict(id: string): Promise<SyncConflictRecord | undefined> {
  const db = await getDB();
  return (await db.get('sync_conflicts', id)) as SyncConflictRecord | undefined;
}

export async function listOpenConflicts(): Promise<SyncConflictRecord[]> {
  const db = await getDB();
  const rows = (await db.getAllFromIndex('sync_conflicts', 'byStatus', 'open')) as SyncConflictRecord[];
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listResolvedConflicts(limit = MAX_RESOLVED_CONFLICTS): Promise<SyncConflictRecord[]> {
  const db = await getDB();
  const rows = (await db.getAllFromIndex('sync_conflicts', 'byStatus', 'resolved')) as SyncConflictRecord[];
  return rows.sort((a, b) => (b.resolvedAt ?? b.notedAt).localeCompare(a.resolvedAt ?? a.notedAt)).slice(0, limit);
}

export async function countOpenConflicts(): Promise<number> {
  const open = await listOpenConflicts();
  return open.length;
}

export async function findOpenConflict(
  entity: SyncEntity,
  entityId: string,
): Promise<SyncConflictRecord | undefined> {
  const db = await getDB();
  const rows = (await db.getAllFromIndex('sync_conflicts', 'byEntityId', [entity, entityId])) as SyncConflictRecord[];
  return rows.find((r) => r.status === 'open');
}

export async function listOpenConflictKeys(): Promise<Set<string>> {
  const open = await listOpenConflicts();
  return new Set(open.map((c) => `${c.entity}:${c.entityId}`));
}

export type OpenConflictInput = {
  entity: SyncEntity;
  entityId: string;
  kind: ConflictKind;
  localUpdatedAt?: string;
  cloudUpdatedAt?: string;
  localSnapshot?: ConflictSnapshot;
  cloudSnapshot?: ConflictSnapshot;
  blockedOpIds?: string[];
};

/**
 * Upsert an open conflict for entity+id. Caps open count; returns null if at cap
 * and no existing open row for this id (caller should surface "先处理冲突").
 */
export async function openConflict(input: OpenConflictInput): Promise<SyncConflictRecord | null> {
  const existing = await findOpenConflict(input.entity, input.entityId);
  const now = nowISO();
  if (existing) {
    const blocked = new Set([...(existing.blockedOpIds ?? []), ...(input.blockedOpIds ?? [])]);
    const next: SyncConflictRecord = {
      ...existing,
      kind: input.kind,
      localUpdatedAt: input.localUpdatedAt ?? existing.localUpdatedAt,
      cloudUpdatedAt: input.cloudUpdatedAt ?? existing.cloudUpdatedAt,
      localSnapshot: input.localSnapshot ?? existing.localSnapshot,
      cloudSnapshot: input.cloudSnapshot ?? existing.cloudSnapshot,
      blockedOpIds: [...blocked],
      notedAt: now,
    };
    await putConflict(next);
    return next;
  }

  const openCount = await countOpenConflicts();
  if (openCount >= MAX_OPEN_CONFLICTS) return null;

  const record: SyncConflictRecord = {
    id: uid(),
    entity: input.entity,
    entityId: input.entityId,
    kind: input.kind,
    status: 'open',
    localUpdatedAt: input.localUpdatedAt,
    cloudUpdatedAt: input.cloudUpdatedAt,
    localSnapshot: input.localSnapshot,
    cloudSnapshot: input.cloudSnapshot,
    blockedOpIds: input.blockedOpIds ? [...input.blockedOpIds] : [],
    createdAt: now,
    notedAt: now,
  };
  await putConflict(record);
  return record;
}

export async function markConflictResolved(
  id: string,
  resolution: ConflictResolutionChoice,
): Promise<SyncConflictRecord | undefined> {
  const cur = await getConflict(id);
  if (!cur) return undefined;
  const now = nowISO();
  const next: SyncConflictRecord = {
    ...cur,
    status: 'resolved',
    resolution,
    resolvedAt: now,
    notedAt: now,
  };
  await putConflict(next);
  await pruneResolvedConflicts();
  return next;
}

async function pruneResolvedConflicts(): Promise<void> {
  const resolved = await listResolvedConflicts(MAX_RESOLVED_CONFLICTS + 20);
  if (resolved.length <= MAX_RESOLVED_CONFLICTS) return;
  const db = await getDB();
  const drop = resolved.slice(MAX_RESOLVED_CONFLICTS);
  const tx = db.transaction('sync_conflicts', 'readwrite');
  for (const r of drop) await tx.store.delete(r.id);
  await tx.done;
}

export async function clearAllConflictsForTests(): Promise<void> {
  const db = await getDB();
  await db.clear('sync_conflicts');
}
