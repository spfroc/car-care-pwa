/**
 * Test-only hooks to fault-inject mid IndexedDB transaction / resolve windows.
 * Always reset to null in afterEach.
 */
export type SyncTxHookPhase =
  | 'after_business_before_outbox'
  | 'during_restore_apply'
  /** After outside checks, before take_cloud readwrite tx opens */
  | 'before_take_cloud_tx'
  /** After outside checks, before keep_local readwrite tx opens */
  | 'before_keep_local_tx';

export type SyncTxHook = (
  phase: SyncTxHookPhase,
  info?: { store?: string },
) => void | Promise<void>;

let syncTxHook: SyncTxHook | null = null;

export function setSyncTxHookForTests(hook: SyncTxHook | null): void {
  syncTxHook = hook;
}

export async function runSyncTxHook(
  phase: SyncTxHookPhase,
  info?: { store?: string },
): Promise<void> {
  await syncTxHook?.(phase, info);
}
