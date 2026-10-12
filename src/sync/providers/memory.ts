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
    return { rows: all, pulledAt: nowISO() };
  }

  /** Atomic LWW — skipped_cloud_newer is conflict-only (not applied). */
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
        conflicts.push({
          opId: op.opId,
          reason: 'cloud_newer',
          entity: op.entity,
          entityId: op.entityId,
          cloudUpdatedAt: existing.updatedAt,
          attemptedAt: op.mutatedAt,
        });
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

  /** First upload also uses LWW — never unconditional overwrite of cloud-newer. */
  async pushSnapshot(rows: CloudRow[]): Promise<PushResult> {
    if (this.offline) return { applied: [], conflicts: [], error: 'offline' };
    const ops: SyncOutboxItem[] = rows.map((r) => ({
      opId: `${r.entity}:${r.id}`,
      entity: r.entity,
      entityId: r.id,
      op: r.deletedAt ? 'delete' : 'upsert',
      payload: r.payload,
      mutatedAt: r.updatedAt,
      attempts: 0,
      nextRetryAt: r.updatedAt,
    }));
    return this.pushOps(ops);
  }
}
