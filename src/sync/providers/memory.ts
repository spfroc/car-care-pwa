import { nowISO } from '../../lib/constants';
import type { CloudProvider } from './types';
import type { CloudRow, CloudSnapshot, PushResult, SyncOutboxItem, VerifyResult } from '../types';
import type { MediaObjectStore, MediaObjectBytes } from '../mediaStorage';

/** In-memory fake Storage for unit tests. */
export class MemoryMediaObjectStore implements MediaObjectStore {
  objects = new Map<string, { body: Uint8Array; contentType: string; createdAtMs: number }>();
  failNextUpload = false;
  failNextDownload = false;
  /** When true, list returns complete=false (simulates truncated/network-partial listing). */
  listIncomplete = false;
  /** When true, list throws (network error). */
  listThrows = false;
  uploadCount = 0;
  /** Injectable clock for createdAt on upload. */
  nowMs = () => Date.now();

  async uploadMediaObject(opts: {
    storageKey: string;
    body: MediaObjectBytes;
    contentType: string;
  }): Promise<void> {
    this.uploadCount += 1;
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error('simulated storage upload failure');
    }
    let bytes: Uint8Array;
    if (opts.body instanceof Blob) {
      bytes = new Uint8Array(await opts.body.arrayBuffer());
    } else if (opts.body instanceof ArrayBuffer) {
      bytes = new Uint8Array(opts.body);
    } else {
      bytes = opts.body;
    }
    const prev = this.objects.get(opts.storageKey);
    this.objects.set(opts.storageKey, {
      body: bytes,
      contentType: opts.contentType,
      createdAtMs: prev?.createdAtMs ?? this.nowMs(),
    });
  }

  async downloadMediaObject(storageKey: string): Promise<Blob> {
    if (this.failNextDownload) {
      this.failNextDownload = false;
      throw new Error('simulated storage download failure');
    }
    const hit = this.objects.get(storageKey);
    if (!hit) throw new Error(`storage download: not found ${storageKey}`);
    const copy = new Uint8Array(hit.body);
    return new Blob([copy], { type: hit.contentType });
  }

  async removeMediaObject(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }

  async listMediaObjectKeys(userId: string) {
    if (this.listThrows) throw new Error('simulated storage list network error');
    if (this.listIncomplete) {
      return { keys: [] as string[], complete: false, error: 'simulated incomplete listing' };
    }
    const prefix = `${userId}/`;
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    const createdAtByKey: Record<string, string> = {};
    for (const k of keys) {
      const o = this.objects.get(k)!;
      createdAtByKey[k] = new Date(o.createdAtMs).toISOString();
    }
    return { keys, complete: true, createdAtByKey };
  }

  async headMediaObject(storageKey: string): Promise<{ exists: boolean; byteSize?: number }> {
    const hit = this.objects.get(storageKey);
    if (!hit) return { exists: false };
    return { exists: true, byteSize: hit.body.byteLength };
  }

  /** Test helper: age an object so grace period allows GC. */
  ageObject(storageKey: string, ageMs: number): void {
    const hit = this.objects.get(storageKey);
    if (!hit) return;
    hit.createdAtMs = this.nowMs() - ageMs;
  }
}

/** In-memory fake provider for unit tests. */
export class MemoryCloudProvider implements CloudProvider {
  readonly id = 'memory' as const;
  rows = new Map<string, CloudRow>();
  userId = 'test-user';
  failNextPush = false;
  offline = false;
  pageSize = 1000;
  pushCallCount = 0;
  /** Test: resolve before pushOps continues (lease-loss mid-flight). */
  pushGate: Promise<void> | null = null;
  mediaStore = new MemoryMediaObjectStore();
  /** When false, getMediaObjectStore returns null (legacy M2 behaviour). */
  enableMediaStore = true;

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
    if (this.pushGate) await this.pushGate;
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

  getMediaObjectStore(): MediaObjectStore | null {
    return this.enableMediaStore ? this.mediaStore : null;
  }

  async getAuthUserId(): Promise<string | null> {
    return this.userId;
  }
}
