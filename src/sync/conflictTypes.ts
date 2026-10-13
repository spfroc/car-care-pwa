import type { ISODateTime, UUID } from '../types';
import type { SyncEntity } from './types';

/** Entities that escalate to manual open conflict (frozen M3-C MVP). */
export const MANUAL_CONFLICT_ENTITIES: ReadonlySet<SyncEntity> = new Set(['vehicles', 'records']);

export type ConflictKind = 'edit_edit' | 'edit_vs_delete' | 'push_rejected';
export type ConflictStatus = 'open' | 'resolved';
export type ConflictResolutionChoice = 'keep_local' | 'take_cloud' | 'dismiss';

export type ConflictSnapshot = {
  op: 'upsert' | 'delete';
  payload?: unknown;
  deletedAt?: ISODateTime | null;
};

export interface SyncConflictRecord {
  id: UUID;
  entity: SyncEntity;
  entityId: string;
  kind: ConflictKind;
  status: ConflictStatus;
  localUpdatedAt?: ISODateTime;
  cloudUpdatedAt?: ISODateTime;
  localSnapshot?: ConflictSnapshot;
  cloudSnapshot?: ConflictSnapshot;
  blockedOpIds?: UUID[];
  createdAt: ISODateTime;
  resolvedAt?: ISODateTime;
  resolution?: ConflictResolutionChoice;
  /** Compatible with legacy audit "notedAt" semantics. */
  notedAt: ISODateTime;
}

export const MAX_OPEN_CONFLICTS = 30;
export const MAX_RESOLVED_CONFLICTS = 50;

export function isManualConflictEntity(entity: SyncEntity | string): entity is 'vehicles' | 'records' {
  return entity === 'vehicles' || entity === 'records';
}
