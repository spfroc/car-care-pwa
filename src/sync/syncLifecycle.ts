/**
 * M3-B: wire Background Sync messages + stale status recovery into app lifecycle.
 *
 * Important: Background Sync does NOT guarantee upload when the page is closed.
 * The SW only postMessages open clients; without an open page, outbox stays in IDB
 * until the next manual sync or app start (+ optional online register).
 *
 * The sync engine and Supabase client are dynamic imports. Listeners stay light
 * so the home shell does not parse them.
 */

import { afterFirstInteraction } from '../lib/firstInteraction';
import { listenBackgroundSyncMessages, registerBackgroundOutboxSync } from './backgroundSync';

export type SyncLifecycleHandles = {
  stop: () => void;
};

let installed = false;
let unsubMessage: (() => void) | null = null;
let onlineHandler: (() => void) | null = null;
let stopInteract: (() => void) | null = null;

/**
 * Install once per page:
 * - on first gesture → recover stuck `syncing` (does not load the sync engine)
 * - on BG Sync SW message → engine.bidirectionalSync() (already exclusive; no double-lock)
 * - on `online` → best-effort register BG Sync tag (manual sync remains primary)
 */
export function installSyncLifecycle(): SyncLifecycleHandles {
  if (installed) {
    return { stop: () => uninstallSyncLifecycle() };
  }
  installed = true;

  stopInteract = afterFirstInteraction(() => {
    void import('./recoverStale').then((m) => m.recoverStaleSyncingStatus());
  });

  unsubMessage = listenBackgroundSyncMessages(() => {
    // Entry is already wrapped with withSyncLock — do not nest another lock.
    void import('./engine').then((engine) => engine.bidirectionalSync());
  });

  onlineHandler = () => {
    void registerBackgroundOutboxSync();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onlineHandler);
  }

  return { stop: () => uninstallSyncLifecycle() };
}

export function uninstallSyncLifecycle(): void {
  stopInteract?.();
  stopInteract = null;
  unsubMessage?.();
  unsubMessage = null;
  if (onlineHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineHandler);
  }
  onlineHandler = null;
  installed = false;
}

/** Test helper */
export function resetSyncLifecycleForTests(): void {
  uninstallSyncLifecycle();
}
