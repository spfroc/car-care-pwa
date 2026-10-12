import { nowISO } from '../../lib/constants';
import type { CloudProvider } from './types';
import type { CloudRow, CloudSnapshot, PushResult, SyncOutboxItem, VerifyResult } from '../types';

/** In-memory fake provider for unit tests. */
export class MemoryCloudProvider implements CloudProvider {
  readonly id = 'memory' as const;
  rows = new Map<string, CloudRow>();
  userId = 'test-user';
  failNextPush = false;
  offline = false;
  /** Simulate PostgREST page size for pullAll integrity tests */
  pageSize = 1000;
  pushCallCount = 0;

  key(entity: string, id: string): string {
    return `${entity}:${id}`;
  }

  async verify(): Promise<VerifyResult> {
    if (this.offline) return { ok: false, error: 'offline' };
    return { ok: true, userId: this.userId, email: 'test@example.com', cloudRowCount: this.rows.size };
  }

  async pullAll(): Promise<CloudSnapshot> {
    if (this.offline) throw new Error('offline');
    const all = [...this.rows.values()].sort((a, b) =>
      a.entity === b.entity ? a.id.localeCompare(b.id) : a.entity.localeCompare(b.entity),
    );
    // Integrity: always return full set (pagination is SupabaseProvider concern);
    // tests that need page integrity use SupabaseProvider with a mock client.
    return { rows: all, pulledAt: nowISO() };
  }

  /** Atomic LWW — single map write, no TOCTOU window. */
  async pushOps(ops: SyncOutboxItem[]): Promise<PushResult> {
    this.pushCallCount += 1;
    if (this.offline) return { applied: [], conflicts: [], error: 'offline' };
    if (this.failNextPush) {
      this.failNextPush = false;
      return { applied: [], conflicts: [], error: 'simulated push failure' };
    }
    const applied: string[] = [];
    const conflicts: PushResult['conflicts'] = [];
    for (const op of ops) {
      const k = this.key(op.entity, op.entityId);
      const existing = this.rows.get(k);
      if (existing && existing.updatedAt > op.mutatedAt) {
        conflicts.push({ opId: op.opId, reason: 'cloud_newer' });
        applied.push(op.opId);
        continue;
      }
      this.rows.set(k, {
        entity: op.entity,
        id: op.entityId,
        payload: op.op === 'delete' ? (existing?.payload ?? {}) : (op.payload ?? {}),
        updatedAt: op.mutatedAt,
        deletedAt: op.op === 'delete' ? op.mutatedAt : null,
      });
      applied.push(op.opId);
    }
    return { applied, conflicts };
  }

  async pushSnapshot(rows: CloudRow[]): Promise<PushResult> {
    if (this.offline) return { applied: [], conflicts: [], error: 'offline' };
    for (const row of rows) {
      this.rows.set(this.key(row.entity, row.id), row);
    }
    return { applied: rows.map((r) => `${r.entity}:${r.id}`), conflicts: [] };
  }
}
