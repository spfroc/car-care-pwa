// SUPERSEDED by runnable *.ts in this directory (D1). Kept for design diff.
/**
 * PSEUDOCODE — Gateway push-side LWW + delete dual-track (architecture §4.0 / §4.7).
 * Client pull LWW stays in PWA merge.ts + M3-C; do not replace it here.
 */

export type PushOp = {
  entity: 'vehicles' | 'records';
  id: string; // AppEntityId
  op: 'upsert' | 'delete';
  mutatedAt: string; // ISO
  payload?: unknown;
};

export type OpResult =
  | { kind: 'applied' }
  | { kind: 'conflict'; reason: 'cloud_newer' | 'skipped_deleted'; cloudUpdatedAt?: string }
  | { kind: 'error'; code: string; message: string };

/**
 * Per op (same AppEntityId serialized within a batch):
 * 1. Query data source by AppEntityId (must see tombstones).
 * 2. Absent + upsert -> create page.
 * 3. Alive + upsert: if cloud AppUpdatedAt > mutatedAt -> cloud_newer (no write).
 * 4. Alive + delete -> in_trash=true AND set AppDeletedAt (dual-track).
 * 5. Tombstone + stale upsert -> reject resurrection / no second create.
 * 6. Tombstone + newer explicit restore -> untrash, clear AppDeletedAt, patch.
 * On Notion write 503: re-read before create (idempotent).
 */
export async function applyPushOp(_op: PushOp): Promise<OpResult> {
  throw new Error('pseudocode only');
}
