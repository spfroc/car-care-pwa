import type {
  CloudRow,
  CloudSnapshot,
  PushResult,
  SyncOutboxItem,
  VerifyResult,
} from '../types';

export interface CloudProvider {
  readonly id: 'supabase' | 'notion' | 'memory';
  verify(): Promise<VerifyResult>;
  /** Full snapshot for restore / first pull (includes tombstones). */
  pullAll(): Promise<CloudSnapshot>;
  /** Apply outbox ops (upsert/delete). Caller supplies user/device context via provider session. */
  pushOps(ops: SyncOutboxItem[]): Promise<PushResult>;
  /** Replace-all style bootstrap upload (first upload). */
  pushSnapshot(rows: CloudRow[]): Promise<PushResult>;
  signOut?(): Promise<void>;
}
