import type {
  CloudRow,
  CloudSnapshot,
  PushResult,
  SyncOutboxItem,
  VerifyResult,
} from '../types';
import type { MediaObjectStore } from '../mediaStorage';

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
  /** M3-A: private media object store. Optional for providers without Storage. */
  getMediaObjectStore?(): MediaObjectStore | null;
  /** Current auth user id (for storage path prefix). */
  getAuthUserId?(): Promise<string | null>;
}
