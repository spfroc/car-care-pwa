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

  key(entity: string, id: string): string {
    return `${entity}:${id}`;
  }

  async verify(): Promise<VerifyResult> {
    if (this.offline) return { ok: false, error: 'offline' };
    return { ok: true, userId: this.userId, email: 'test@example.com', cloudRowCount: this.rows.size };
  }

  async pullAll(): Promise<CloudSnapshot> {
    if (this.offline) throw new Error('offline');
    return { rows: [...this.rows.values()], pulledAt: nowISO() };
  }

  async pushOps(ops: SyncOutboxItem[]): Promise<PushResult> {
    if (this.offline) return { applied: [], conflicts: [], error: 'offline' };
    if (this.failNextPush) {
      this.failNextPush = false;
      return { applied: [], conflicts: [], error: 'simulated push failure' };
    }
    const applied: string[] = [];
    for (const op of ops) {
      const k = this.key(op.entity, op.entityId);
      const existing = this.rows.get(k);
      if (op.op === 'delete') {
        if (existing && existing.updatedAt > op.mutatedAt) {
          // cloud newer — skip
        } else {
          this.rows.set(k, {
            entity: op.entity,
            id: op.entityId,
            payload: existing?.payload ?? {},
            updatedAt: op.mutatedAt,
            deletedAt: op.mutatedAt,
          });
        }
      } else {
        if (existing && existing.updatedAt > op.mutatedAt) {
          // LWW keep cloud
        } else {
          this.rows.set(k, {
            entity: op.entity,
            id: op.entityId,
            payload: op.payload ?? {},
            updatedAt: op.mutatedAt,
            deletedAt: null,
          });
        }
      }
      applied.push(op.opId);
    }
    return { applied, conflicts: [] };
  }

  async pushSnapshot(rows: CloudRow[]): Promise<PushResult> {
    if (this.offline) return { applied: [], conflicts: [], error: 'offline' };
    for (const row of rows) {
      this.rows.set(this.key(row.entity, row.id), row);
    }
    return { applied: rows.map((r) => `${r.entity}:${r.id}`), conflicts: [] };
  }
}
