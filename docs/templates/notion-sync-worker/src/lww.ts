/** Gateway push-side LWW helpers (architecture §4.0 / §4.2 / §4.7). */

export type IsoCompare = -1 | 0 | 1;

/** Compare ISO-8601 timestamps. Invalid → treat as older (-1). */
export function compareIso(a: string | null | undefined, b: string | null | undefined): IsoCompare {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return -1;
  if (Number.isNaN(tb)) return 1;
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return 0;
}

export type CloudPresence =
  | { kind: 'absent' }
  | { kind: 'alive'; updatedAt: string; deletedAt?: null }
  | { kind: 'tombstone'; updatedAt: string; deletedAt: string; pageId: string };

export type PushDecision =
  | { action: 'create' }
  | { action: 'patch' }
  | { action: 'trash' }
  | { action: 'restore_and_patch' }
  | { action: 'conflict'; reason: 'cloud_newer' | 'skipped_deleted' | 'ambiguous_race' }
  | { action: 'noop_deleted' };

/**
 * Decide push action for one op given cloud presence.
 * Dangerous races must NOT silently succeed as create when tombstone/map says deleted.
 */
export function decidePushOp(args: {
  op: 'upsert' | 'delete';
  mutatedAt: string;
  presence: CloudPresence;
  /** Extra pages with same AppEntityId (race / legacy duplicates). */
  duplicateCount?: number;
}): PushDecision {
  const { op, mutatedAt, presence } = args;
  const dups = args.duplicateCount ?? (presence.kind === 'absent' ? 0 : 1);

  if (dups > 1) {
    // Ambiguous multi-page state: never silently invent another create or overwrite arbitrarily.
    return { action: 'conflict', reason: 'ambiguous_race' };
  }

  if (presence.kind === 'absent') {
    if (op === 'delete') return { action: 'noop_deleted' };
    return { action: 'create' };
  }

  if (presence.kind === 'tombstone') {
    if (op === 'delete') return { action: 'noop_deleted' };
    // Stale upsert must not resurrect
    if (compareIso(mutatedAt, presence.deletedAt) <= 0) {
      return { action: 'conflict', reason: 'skipped_deleted' };
    }
    // Newer explicit restore / edit after delete
    return { action: 'restore_and_patch' };
  }

  // alive
  if (op === 'delete') return { action: 'trash' };
  if (compareIso(presence.updatedAt, mutatedAt) > 0) {
    return { action: 'conflict', reason: 'cloud_newer' };
  }
  return { action: 'patch' };
}
