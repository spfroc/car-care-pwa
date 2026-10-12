/**
 * Test-only hooks to fault-inject mid IndexedDB transaction.
 * Always reset to null in afterEach.
 */
export type SyncTxHookPhase = 'after_business_before_outbox' | 'during_restore_apply';

let syncTxHook: ((phase: SyncTxHookPhase, info?: { store?: string }) => void) | null = null;

export function setSyncTxHookForTests(
  hook: ((phase: SyncTxHookPhase, info?: { store?: string }) => void) | null,
): void {
  syncTxHook = hook;
}

export function runSyncTxHook(
  phase: SyncTxHookPhase,
  info?: { store?: string },
): void {
  syncTxHook?.(phase, info);
}
